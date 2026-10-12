import { randomBytes, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Fixed paths are intentional: no CLI argument or environment value selects a path.
const HOME_ROOT = '/home/u374306905';
const STORAGE_ROOT = `${HOME_ROOT}/.rafraf-storage`;
const DIRECTORIES = Object.freeze({
  storage: STORAGE_ROOT,
  evidence: `${STORAGE_ROOT}/rfq-evidence`,
  supplier: `${STORAGE_ROOT}/supplier-documents`,
});
const CANARY_PATH = `${STORAGE_ROOT}/canary.privateprobe`;
const CANARY_PREFIX = Buffer.from('RAFRAF_SYNTHETIC_STORAGE_PROBE_V1\0');
const CANARY_SIZE = CANARY_PREFIX.length + 32;

function reject(code) {
  const error = new Error(code);
  error.diagnosticCode = code;
  throw error;
}

function assertDirectory(metadata, uid, privateMode) {
  if (metadata.isSymbolicLink()) reject('SYMLINK_REJECTED');
  if (!metadata.isDirectory()) reject('DIRECTORY_REQUIRED');
  if (uid !== undefined && metadata.uid !== uid) reject('OWNER_MISMATCH');
  if (privateMode && (metadata.mode & 0o7777) !== 0o700) {
    reject('PRIVATE_DIRECTORY_MODE_REJECTED');
  }
  if (!privateMode && (metadata.mode & 0o022) !== 0) {
    reject('WRITABLE_ANCESTOR_REJECTED');
  }
}

function assertCanary(metadata, uid) {
  if (metadata.isSymbolicLink()) reject('SYMLINK_REJECTED');
  if (!metadata.isFile()) reject('CANARY_FILE_REQUIRED');
  if (metadata.uid !== uid) reject('OWNER_MISMATCH');
  if ((metadata.mode & 0o7777) !== 0o600) reject('CANARY_MODE_REJECTED');
  if (metadata.nlink !== 1) reject('CANARY_LINK_COUNT_REJECTED');
  if (metadata.size !== CANARY_SIZE) reject('CANARY_CONTENT_REJECTED');
}

async function accessFlags(io, directory) {
  const check = async (mode) => {
    try {
      await io.access(directory, mode);
      return true;
    } catch (error) {
      if (error.code === 'EACCES' || error.code === 'EPERM') return false;
      throw error;
    }
  };
  return {
    readable: await check(constants.R_OK),
    writable: await check(constants.W_OK),
    searchable: await check(constants.X_OK),
  };
}

function identity(metadata) {
  return { dev: String(metadata.dev), ino: String(metadata.ino) };
}

// Dependencies are injectable for in-memory tests. Path selection is not injectable.
export async function diagnoseStorage({
  io = fs,
  uid = typeof process.getuid === 'function' ? process.getuid() : undefined,
  random = randomBytes,
} = {}) {
  if (!Number.isSafeInteger(uid) || uid < 0) reject('UID_UNAVAILABLE');
  if (!Number.isInteger(constants.O_NOFOLLOW) || !Number.isInteger(constants.O_NONBLOCK)) {
    reject('PLATFORM_FLAGS_UNAVAILABLE');
  }
  assertDirectory(await io.lstat('/'), undefined, false);
  assertDirectory(await io.lstat('/home'), undefined, false);
  const home = await io.lstat(HOME_ROOT);
  assertDirectory(home, uid, false);

  const metadata = {};
  for (const [label, directory] of Object.entries(DIRECTORIES)) {
    try {
      metadata[label] = await io.lstat(directory);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // Parents are checked first; do not use recursive mkdir or create the home.
      try {
        await io.mkdir(directory, { mode: 0o700 });
      } catch (mkdirError) {
        if (mkdirError.code !== 'EEXIST') throw mkdirError;
      }
      metadata[label] = await io.lstat(directory);
    }
    assertDirectory(metadata[label], uid, true);
  }

  let canaryExisted = true;
  let handle;
  try {
    assertCanary(await io.lstat(CANARY_PATH), uid);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try {
      handle = await io.open(
        CANARY_PATH,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      canaryExisted = false;
    } catch (openError) {
      if (openError.code !== 'EEXIST') throw openError;
    }
  }
  if (handle) {
    try {
      const created = await handle.stat();
      if (!created.isFile() || created.uid !== uid || created.nlink !== 1 ||
          (created.mode & 0o7777) !== 0o600 || created.size !== 0) {
        reject('NEW_CANARY_METADATA_REJECTED');
      }
      const entropy = random(32);
      if (!Buffer.isBuffer(entropy) || entropy.length !== 32) {
        reject('SYNTHETIC_ENTROPY_REJECTED');
      }
      await handle.writeFile(Buffer.concat([CANARY_PREFIX, entropy]));
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  // Reject replaced ancestors before reading even the reserved synthetic file.
  const currentHome = await io.lstat(HOME_ROOT);
  assertDirectory(currentHome, uid, false);
  if (currentHome.dev !== home.dev || currentHome.ino !== home.ino) {
    reject('DIRECTORY_IDENTITY_CHANGED');
  }
  for (const [label, directory] of Object.entries(DIRECTORIES)) {
    const current = await io.lstat(directory);
    assertDirectory(current, uid, true);
    if (current.dev !== metadata[label].dev || current.ino !== metadata[label].ino) {
      reject('DIRECTORY_IDENTITY_CHANGED');
    }
  }
  const before = await io.lstat(CANARY_PATH);
  assertCanary(before, uid);
  handle = await io.open(
    CANARY_PATH,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  let bytes;
  let canary;
  try {
    canary = await handle.stat();
    assertCanary(canary, uid);
    if (canary.dev !== before.dev || canary.ino !== before.ino) {
      reject('CANARY_IDENTITY_CHANGED');
    }
    bytes = Buffer.alloc(CANARY_SIZE);
    let offset = 0;
    while (offset < CANARY_SIZE) {
      const result = await handle.read(bytes, offset, CANARY_SIZE - offset, offset);
      if (result.bytesRead === 0) reject('CANARY_CONTENT_REJECTED');
      offset += result.bytesRead;
    }
    const after = await handle.stat();
    assertCanary(after, uid);
    if (after.mtimeMs !== canary.mtimeMs || after.ctimeMs !== canary.ctimeMs) {
      reject('CANARY_CHANGED_DURING_READ');
    }
    if (!bytes.subarray(0, CANARY_PREFIX.length).equals(CANARY_PREFIX)) {
      reject('CANARY_CONTENT_REJECTED');
    }
  } finally {
    await handle.close();
  }

  const access = { home: await accessFlags(io, HOME_ROOT) };
  for (const [label, directory] of Object.entries(DIRECTORIES)) {
    access[label] = await accessFlags(io, directory);
  }
  const finalHome = await io.lstat(HOME_ROOT);
  assertDirectory(finalHome, uid, false);
  if (finalHome.dev !== home.dev || finalHome.ino !== home.ino) {
    reject('DIRECTORY_IDENTITY_CHANGED');
  }
  for (const [label, directory] of Object.entries(DIRECTORIES)) {
    const finalDirectory = await io.lstat(directory);
    assertDirectory(finalDirectory, uid, true);
    if (finalDirectory.dev !== metadata[label].dev || finalDirectory.ino !== metadata[label].ino) {
      reject('DIRECTORY_IDENTITY_CHANGED');
    }
  }
  const finalCanary = await io.lstat(CANARY_PATH);
  assertCanary(finalCanary, uid);
  if (finalCanary.dev !== canary.dev || finalCanary.ino !== canary.ino ||
      finalCanary.mtimeMs !== canary.mtimeMs || finalCanary.ctimeMs !== canary.ctimeMs) {
    reject('CANARY_IDENTITY_CHANGED');
  }
  return {
    code: 'OK',
    uid,
    dirModes: Object.fromEntries(Object.entries(metadata).map(([label, value]) => [
      label, (value.mode & 0o7777).toString(8),
    ])),
    access,
    canarySHA256: createHash('sha256').update(bytes).digest('hex'),
    canaryExisted,
    devino: {
      home: identity(home),
      ...Object.fromEntries(Object.entries(metadata).map(([label, value]) => [label, identity(value)])),
      canary: identity(canary),
    },
  };
}

function publicFailure(error) {
  if (typeof error.diagnosticCode === 'string') return error.diagnosticCode;
  const safe = new Set(['ENOENT', 'EACCES', 'EPERM', 'ENOSPC', 'EROFS', 'ELOOP', 'ENOTDIR']);
  return safe.has(error.code) ? `FILESYSTEM_${error.code}` : 'FILESYSTEM_FAILURE';
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    if (process.argv.length !== 2) reject('ARGUMENTS_REJECTED');
    process.stdout.write(`${JSON.stringify(await diagnoseStorage())}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      code: publicFailure(error),
      uid: typeof process.getuid === 'function' ? process.getuid() : null,
    })}\n`);
    process.exitCode = 1;
  }
}
