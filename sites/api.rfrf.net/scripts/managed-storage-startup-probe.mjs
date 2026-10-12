import { diagnoseStorage } from './managed-storage-diagnostic.mjs';

const SURFACE = 'api';

const FAILURE_CODES = new Set([
  'UID_UNAVAILABLE', 'PLATFORM_FLAGS_UNAVAILABLE', 'SYMLINK_REJECTED',
  'DIRECTORY_REQUIRED', 'OWNER_MISMATCH', 'PRIVATE_DIRECTORY_MODE_REJECTED',
  'WRITABLE_ANCESTOR_REJECTED', 'CANARY_FILE_REQUIRED', 'CANARY_MODE_REJECTED',
  'CANARY_LINK_COUNT_REJECTED', 'CANARY_CONTENT_REJECTED',
  'NEW_CANARY_METADATA_REJECTED', 'SYNTHETIC_ENTROPY_REJECTED',
  'DIRECTORY_IDENTITY_CHANGED', 'CANARY_IDENTITY_CHANGED',
  'CANARY_CHANGED_DURING_READ', 'STORAGE_DIAGNOSTIC_RESULT_REJECTED',
]);
const FILESYSTEM_CODES = new Set([
  'ENOENT', 'EACCES', 'EPERM', 'ENOSPC', 'EROFS', 'ELOOP', 'ENOTDIR',
]);

function rejectedResult() {
  const error = new Error('Storage diagnostic result rejected');
  error.diagnosticCode = 'STORAGE_DIAGNOSTIC_RESULT_REJECTED';
  throw error;
}

function sanitizeSuccess(value) {
  if (!value || value.code !== 'OK' || !Number.isSafeInteger(value.uid) || value.uid < 0 ||
      typeof value.canaryExisted !== 'boolean' ||
      typeof value.canarySHA256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.canarySHA256)) {
    rejectedResult();
  }
  const dirModes = {};
  const access = {};
  const devino = {};
  for (const label of ['storage', 'evidence', 'supplier']) {
    if (value.dirModes?.[label] !== '700') rejectedResult();
    dirModes[label] = '700';
  }
  for (const label of ['home', 'storage', 'evidence', 'supplier']) {
    access[label] = {};
    for (const flag of ['readable', 'writable', 'searchable']) {
      if (typeof value.access?.[label]?.[flag] !== 'boolean') rejectedResult();
      access[label][flag] = value.access[label][flag];
    }
  }
  for (const label of ['home', 'storage', 'evidence', 'supplier', 'canary']) {
    devino[label] = {};
    for (const field of ['dev', 'ino']) {
      const identity = value.devino?.[label]?.[field];
      if (typeof identity !== 'string' || !/^[0-9]{1,32}$/.test(identity)) rejectedResult();
      devino[label][field] = identity;
    }
  }
  return {
    code: 'OK', uid: value.uid, dirModes, access,
    canarySHA256: value.canarySHA256, canaryExisted: value.canaryExisted, devino,
  };
}

function sanitizedFailure(error, uid) {
  const diagnosticCode = error?.diagnosticCode;
  const code = FAILURE_CODES.has(diagnosticCode)
    ? diagnosticCode
    : FILESYSTEM_CODES.has(error?.code)
      ? `FILESYSTEM_${error.code}`
      : 'STORAGE_DIAGNOSTIC_FAILURE';
  return { code, uid: Number.isSafeInteger(uid) && uid >= 0 ? uid : null };
}

// Injection is only an import-time test seam; CLI/env never choose paths or commands.
export async function reportStorage({
  diagnose = diagnoseStorage,
  output = (line) => process.stdout.write(line),
  now = () => new Date(),
  uid = () => typeof process.getuid === 'function' ? process.getuid() : null,
} = {}) {
  let level = 'info';
  let result;
  try {
    result = sanitizeSuccess(await diagnose());
  } catch (error) {
    level = 'warn';
    result = sanitizedFailure(error, uid());
  }
  // The hosting log contract has exactly these three fields; no raw exception is logged.
  output(`${JSON.stringify({
    timestamp: now().toISOString(),
    level,
    message: JSON.stringify({ event: 'rafraf.managed_storage_probe', surface: SURFACE, ...result }),
  })}\n`);
  return result;
}
