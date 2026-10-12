'use strict';
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const C = fs.constants;
const HOME = '/home/u374306905';
const PRIVATE_ROOT = `${HOME}/.rafraf-storage`;
const MANIFEST = '.client-storage-seed-manifest.json';
const BUCKETS = Object.freeze({ evidence: 'rfq-evidence', supplier_documents: 'supplier-documents' });
const MAX_JSON = 49152;
const MAX_RAW = 32768;
const MAX_FILES = 128;
const evidenceKey = /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(jpg|png|webp)$/;
const documentKey = /^[A-Za-z0-9_-]{8,128}\/(BUSINESS_REGISTRATION|FREELANCE_CERTIFICATE|COMMERCIAL_REGISTRATION|FREELANCE_WORK_CERTIFICATE)\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|jpg|png)$/i;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
function fail(code) { const error = new Error(code); error.seedCode = code; throw error; }
function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) fail('SEED_SCHEMA_REJECTED');
}
function validate(raw, withBytes) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > MAX_JSON) fail('SEED_SIZE_REJECTED');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { fail('SEED_SCHEMA_REJECTED'); }
  exactKeys(parsed, ['version', 'evidence', 'supplier_documents']);
  if (parsed.version !== 1) fail('SEED_VERSION_REJECTED');
  const records = [];
  let total = 0;
  const metadata = { version: 1, evidence: [], supplier_documents: [] };
  for (const bucket of Object.keys(BUCKETS)) {
    if (!Array.isArray(parsed[bucket])) fail('SEED_SCHEMA_REJECTED');
    let previous;
    for (const value of parsed[bucket]) {
      exactKeys(value, withBytes ? ['key', 'base64', 'size', 'sha256'] : ['key', 'size', 'sha256']);
      if (typeof value.key !== 'string' || value.key.length > 512 ||
          !(bucket === 'evidence' ? evidenceKey : documentKey).test(value.key) ||
          (previous !== undefined && previous >= value.key)) fail('SEED_KEY_REJECTED');
      previous = value.key;
      if (!Number.isSafeInteger(value.size) || value.size < 0 || value.size > MAX_RAW ||
          typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256)) fail('SEED_SCHEMA_REJECTED');
      let bytes;
      if (withBytes) {
        if (typeof value.base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.base64)) fail('SEED_ENCODING_REJECTED');
        bytes = Buffer.from(value.base64, 'base64');
        if (bytes.toString('base64') !== value.base64 || bytes.length !== value.size || digest(bytes) !== value.sha256) fail('SEED_CONTENT_REJECTED');
      }
      total += value.size;
      records.push({ bucket, key: value.key, size: value.size, sha256: value.sha256, bytes });
      metadata[bucket].push({ key: value.key, size: value.size, sha256: value.sha256 });
      if (records.length > MAX_FILES || total > MAX_RAW) fail('SEED_SIZE_REJECTED');
    }
  }
  const manifestBytes = Buffer.from(JSON.stringify(metadata) + '\n');
  return { records, total, manifestBytes };
}
function openStorage(io, uid, create) {
  if (!Number.isSafeInteger(uid) || uid < 0 || !Number.isInteger(C.O_NOFOLLOW) || !Number.isInteger(C.O_DIRECTORY)) fail('SEED_PLATFORM_REJECTED');
  const handles = [];
  const anchor = (fd, name) => `/proc/self/fd/${fd}/${name}`;
  function directory(path, owner, privateMode, make) {
    if (make) {
      try { io.mkdirSync(path, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    const fd = io.openSync(path, C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW);
    handles.push(fd);
    const stat = io.fstatSync(fd);
    if (!stat.isDirectory() || (owner && stat.uid !== uid) ||
        (privateMode ? (stat.mode & 0o7777) !== 0o700 : (stat.mode & 0o022) !== 0)) fail('SEED_DIRECTORY_REJECTED');
    return fd;
  }
  try {
    const root = directory('/', false, false, false);
    const homeParent = directory(anchor(root, 'home'), false, false, false);
    const home = directory(anchor(homeParent, 'u374306905'), true, false, false);
    const storage = directory(anchor(home, '.rafraf-storage'), true, true, create);
    const buckets = {};
    for (const [label, name] of Object.entries(BUCKETS)) buckets[label] = directory(anchor(storage, name), true, true, create);
    return {
      storage,
      parent(record) {
        let fd = buckets[record.bucket];
        const parts = record.key.split('/');
        for (const part of parts.slice(0, -1)) fd = directory(anchor(fd, part), true, true, create);
        return { path: anchor(fd, parts.at(-1)) };
      },
      manifestPath: anchor(storage, MANIFEST),
      close() { for (const fd of handles.reverse()) { try { io.closeSync(fd); } catch {} } },
    };
  } catch (error) {
    for (const fd of handles.reverse()) { try { io.closeSync(fd); } catch {} }
    throw error;
  }
}
function safeMetadata(stat, uid, maxSize) {
  if (!stat.isFile() || stat.uid !== uid || stat.nlink !== 1 ||
      (stat.mode & 0o7777) !== 0o600 || stat.size < 0 || stat.size > maxSize) fail('SEED_FILE_REJECTED');
}
function readExisting(io, path, uid, maxSize, missingAllowed) {
  let fd;
  try {
    fd = io.openSync(path, C.O_RDONLY | C.O_NOFOLLOW | C.O_NONBLOCK);
  } catch (error) {
    if (missingAllowed && error.code === 'ENOENT') return null;
    throw error;
  }
  try {
    const before = io.fstatSync(fd); safeMetadata(before, uid, maxSize);
    const bytes = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const count = io.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) break;
      offset += count;
    }
    const after = io.fstatSync(fd); safeMetadata(after, uid, maxSize);
    if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) fail('SEED_FILE_CHANGED');
    return bytes.subarray(0, offset);
  } finally { io.closeSync(fd); }
}
function matchRecord(bytes, record) {
  if (!bytes || bytes.length !== record.size || digest(bytes) !== record.sha256) fail('SEED_CONFLICT');
}
function createFile(io, path, bytes, uid, created) {
  const fd = io.openSync(path, C.O_CREAT | C.O_EXCL | C.O_WRONLY | C.O_NOFOLLOW, 0o600);
  try {
    const stat = io.fstatSync(fd); safeMetadata(stat, uid, 0);
    const item = { path, bytes, dev: stat.dev, ino: stat.ino }; created.push(item);
    let offset = 0;
    while (offset < bytes.length) {
      const count = io.writeSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) fail('SEED_WRITE_FAILED');
      offset += count;
    }
    io.fsyncSync(fd);
  } finally { io.closeSync(fd); }
}
function rollback(io, created, uid) {
  for (const item of created.reverse()) {
    try {
      const current = io.lstatSync(item.path);
      safeMetadata(current, uid, item.bytes.length);
      if (current.dev !== item.dev || current.ino !== item.ino) continue;
      const bytes = readExisting(io, item.path, uid, item.bytes.length, false);
      if (bytes.equals(item.bytes.subarray(0, bytes.length))) io.unlinkSync(item.path);
    } catch { /* Never delete an unexpected, replaced, or modified object. */ }
  }
}
function manifestDigest(records) {
  const normalized = records.map((record) => ({ bytes: record.size, key: record.key, sha256: record.sha256, store: record.bucket }));
  normalized.sort((a, b) => a.store < b.store ? -1 : a.store > b.store ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  return `sha256-v1:${digest(Buffer.from(JSON.stringify(normalized), 'utf8'))}`;
}
function verifyRecords(io, storage, parsed, uid) {
  for (const record of parsed.records) matchRecord(readExisting(io, storage.parent(record).path, uid, MAX_RAW, false), record);
  return { event: 'rafraf.client_storage_seed_verified', files: parsed.records.length, bytes: parsed.total,
    manifest_sha256: manifestDigest(parsed.records), verified: true };
}
// Only I/O and UID are injectable for synthetic local tests; runtime paths stay fixed.
function importPrivateStorageSeed(raw, { io = fs, uid = process.getuid?.() } = {}) {
  const parsed = validate(raw, true);
  const storage = openStorage(io, uid, true);
  const created = [];
  try {
    const existingManifest = readExisting(io, storage.manifestPath, uid, MAX_JSON, true);
    if (existingManifest && !existingManifest.equals(parsed.manifestBytes)) fail('SEED_MANIFEST_CONFLICT');
    const targets = parsed.records.map((record) => ({ record, path: storage.parent(record).path }));
    for (const target of targets) {
      const bytes = readExisting(io, target.path, uid, MAX_RAW, true);
      target.exists = bytes !== null;
      if (target.exists) matchRecord(bytes, target.record);
    }
    for (const target of targets) {
      if (target.exists) continue;
      try { createFile(io, target.path, target.record.bytes, uid, created); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        matchRecord(readExisting(io, target.path, uid, MAX_RAW, false), target.record);
      }
    }
    if (!existingManifest) {
      try { createFile(io, storage.manifestPath, parsed.manifestBytes, uid, created); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const bytes = readExisting(io, storage.manifestPath, uid, MAX_JSON, false);
        if (!bytes.equals(parsed.manifestBytes)) fail('SEED_MANIFEST_CONFLICT');
      }
    }
    return verifyRecords(io, storage, parsed, uid);
  } catch (error) { rollback(io, created, uid); throw error; }
  finally { storage.close(); }
}
function verifyPrivateStorageSeed({ io = fs, uid = process.getuid?.() } = {}) {
  const storage = openStorage(io, uid, false);
  try {
    const bytes = readExisting(io, storage.manifestPath, uid, MAX_JSON, false);
    const parsed = validate(bytes.toString('utf8'), false);
    if (!bytes.equals(parsed.manifestBytes)) fail('SEED_MANIFEST_REJECTED');
    return verifyRecords(io, storage, parsed, uid);
  } finally { storage.close(); }
}
function seedFailureCode(error) {
  const allowed = new Set(['SEED_SCHEMA_REJECTED','SEED_SIZE_REJECTED','SEED_VERSION_REJECTED','SEED_KEY_REJECTED',
    'SEED_ENCODING_REJECTED','SEED_CONTENT_REJECTED','SEED_PLATFORM_REJECTED','SEED_DIRECTORY_REJECTED',
    'SEED_FILE_REJECTED','SEED_FILE_CHANGED','SEED_CONFLICT','SEED_WRITE_FAILED','SEED_MANIFEST_CONFLICT','SEED_MANIFEST_REJECTED']);
  return allowed.has(error?.seedCode) ? error.seedCode : 'SEED_FILESYSTEM_FAILURE';
}
module.exports = { importPrivateStorageSeed, verifyPrivateStorageSeed, seedFailureCode };
