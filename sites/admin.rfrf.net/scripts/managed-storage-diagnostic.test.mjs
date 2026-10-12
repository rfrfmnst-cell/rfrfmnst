import test from 'node:test';
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { diagnoseStorage } from './managed-storage-diagnostic.mjs';

const HOME = '/home/u374306905';
const ROOT = `${HOME}/.rafraf-storage`;
const CANARY = `${ROOT}/canary.privateprobe`;
const PREFIX = Buffer.from('RAFRAF_SYNTHETIC_STORAGE_PROBE_V1\0');
const UID = 1742;

function fixture() {
  let nextInode = 100;
  const calls = { mkdir: 0, writeOpen: 0, readOpen: 0, read: 0, close: 0 };
  const nodes = new Map();
  const node = (kind, mode, uid = UID, data = Buffer.alloc(0)) => ({
    kind, mode, uid, data, size: data.length, dev: 7, ino: nextInode++,
    nlink: 1, mtimeMs: 1, ctimeMs: 1,
    isDirectory() { return this.kind === 'directory'; },
    isFile() { return this.kind === 'file'; },
    isSymbolicLink() { return this.kind === 'symlink'; },
  });
  nodes.set('/', node('directory', 0o755, 0));
  nodes.set('/home', node('directory', 0o755, 0));
  nodes.set(HOME, node('directory', 0o711));
  const error = (code) => Object.assign(new Error('private details must not escape'), { code });
  const readNode = (path) => {
    if (!nodes.has(path)) throw error('ENOENT');
    return nodes.get(path);
  };
  const state = { readonly: false, shortReads: false, onReadOpen: null, onRead: null };
  const io = {
    async lstat(path) { return { ...readNode(path) }; },
    async mkdir(path, options) {
      calls.mkdir++;
      assert.equal(options.recursive, undefined);
      assert.ok([ROOT, `${ROOT}/rfq-evidence`, `${ROOT}/supplier-documents`].includes(path));
      if (nodes.has(path)) throw error('EEXIST');
      if (state.readonly) throw error('EROFS');
      const parent = path.slice(0, path.lastIndexOf('/'));
      assert.ok(readNode(parent).isDirectory());
      nodes.set(path, node('directory', options.mode));
    },
    async access(path, mode) {
      readNode(path);
      if (state.readonly && mode === constants.W_OK) throw error('EACCES');
    },
    async open(path, flags, mode) {
      assert.equal(path, CANARY);
      assert.ok(flags & constants.O_NOFOLLOW);
      const writing = Boolean(flags & constants.O_WRONLY);
      if (writing) {
        calls.writeOpen++;
        assert.ok(flags & constants.O_EXCL);
        assert.ok(flags & constants.O_CREAT);
        if (state.readonly) throw error('EROFS');
        if (nodes.has(path)) throw error('EEXIST');
        nodes.set(path, node('file', mode));
      } else {
        calls.readOpen++;
        if (state.onReadOpen) state.onReadOpen(nodes.get(path));
      }
      const current = readNode(path);
      if (current.kind === 'symlink') throw error('ELOOP');
      return {
        async stat() { return { ...current }; },
        async writeFile(bytes) {
          assert.ok(writing);
          current.data = Buffer.from(bytes);
          current.size = bytes.length;
          current.mtimeMs++;
          current.ctimeMs++;
        },
        async sync() {},
        async read(target, offset, length, position) {
          calls.read++;
          const count = Math.min(length, current.data.length - position, state.shortReads ? 8 : length);
          current.data.copy(target, offset, position, position + count);
          if (state.onRead) state.onRead(current);
          return { bytesRead: count };
        },
        async close() { calls.close++; },
      };
    },
  };
  const run = () => diagnoseStorage({ io, uid: UID, random: () => Buffer.alloc(32, 71) });
  const addRoots = () => {
    for (const path of [ROOT, `${ROOT}/rfq-evidence`, `${ROOT}/supplier-documents`]) {
      nodes.set(path, node('directory', 0o700));
    }
  };
  const addCanary = () => nodes.set(CANARY, node('file', 0o600, UID, Buffer.concat([PREFIX, Buffer.alloc(32, 71)])));
  return { run, nodes, calls, state, node, addRoots, addCanary };
}

const rejected = (promise, code) => assert.rejects(promise, (error) => error.diagnosticCode === code);

test('creates only fixed private directories and synthetic canary', async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.code, 'OK');
  assert.equal(result.uid, UID);
  assert.deepEqual(result.dirModes, { storage: '700', evidence: '700', supplier: '700' });
  assert.equal(result.canaryExisted, false);
  assert.match(result.canarySHA256, /^[a-f0-9]{64}$/);
  assert.equal(f.calls.mkdir, 3);
  assert.equal(f.calls.writeOpen, 1);
  assert.equal(f.nodes.get(CANARY).mode, 0o600);
  const output = JSON.stringify(result);
  assert.ok(!output.includes(HOME) && !output.includes('privateprobe') && !output.includes(PREFIX.toString()));
});

test('repeat is read-only with stable synthetic hash and inode even without write access', async () => {
  const f = fixture();
  const first = await f.run();
  f.state.readonly = true;
  const second = await f.run();
  assert.equal(second.canaryExisted, true);
  assert.equal(second.canarySHA256, first.canarySHA256);
  assert.deepEqual(second.devino, first.devino);
  assert.equal(second.access.storage.writable, false);
  assert.equal(f.calls.writeOpen, 1);
  assert.equal(f.calls.mkdir, 3);
});

test('missing fixed home fails without creating it or opening files', async () => {
  const f = fixture();
  f.nodes.delete(HOME);
  await assert.rejects(f.run(), { code: 'ENOENT' });
  assert.equal(f.calls.mkdir + f.calls.writeOpen + f.calls.readOpen, 0);
});

test('foreign home owner is rejected before mutation', async () => {
  const f = fixture();
  f.nodes.get(HOME).uid++;
  await rejected(f.run(), 'OWNER_MISMATCH');
  assert.equal(f.calls.mkdir + f.calls.writeOpen, 0);
});

test('symlink ancestor is rejected before mutation', async () => {
  const f = fixture();
  f.nodes.get(HOME).kind = 'symlink';
  await rejected(f.run(), 'SYMLINK_REJECTED');
  assert.equal(f.calls.mkdir + f.calls.writeOpen, 0);
});

test('group-writable home is rejected', async () => {
  const f = fixture();
  f.nodes.get(HOME).mode = 0o775;
  await rejected(f.run(), 'WRITABLE_ANCESTOR_REJECTED');
});

test('symlink storage root is rejected', async () => {
  const f = fixture();
  f.addRoots();
  f.nodes.get(ROOT).kind = 'symlink';
  await rejected(f.run(), 'SYMLINK_REJECTED');
  assert.equal(f.calls.writeOpen, 0);
});

test('existing broad private-directory permissions are rejected without chmod', async () => {
  const f = fixture();
  f.addRoots();
  f.nodes.get(ROOT).mode = 0o755;
  await rejected(f.run(), 'PRIVATE_DIRECTORY_MODE_REJECTED');
  assert.equal(f.nodes.get(ROOT).mode, 0o755);
  assert.equal(f.calls.writeOpen, 0);
});

test('non-directory fixed child is rejected', async () => {
  const f = fixture();
  f.addRoots();
  f.nodes.get(`${ROOT}/rfq-evidence`).kind = 'file';
  await rejected(f.run(), 'DIRECTORY_REQUIRED');
});

for (const [name, mutate, code] of [
  ['symlink', (n) => { n.kind = 'symlink'; }, 'SYMLINK_REJECTED'],
  ['broad mode', (n) => { n.mode = 0o644; }, 'CANARY_MODE_REJECTED'],
  ['hard link', (n) => { n.nlink = 2; }, 'CANARY_LINK_COUNT_REJECTED'],
  ['foreign owner', (n) => { n.uid++; }, 'OWNER_MISMATCH'],
  ['oversize', (n) => { n.size++; }, 'CANARY_CONTENT_REJECTED'],
]) {
  test(`existing canary ${name} is rejected without reading bytes`, async () => {
    const f = fixture();
    f.addRoots();
    f.addCanary();
    mutate(f.nodes.get(CANARY));
    await rejected(f.run(), code);
    assert.equal(f.calls.readOpen + f.calls.writeOpen + f.calls.read, 0);
  });
}

test('unknown reserved-file content fails without exposing its digest', async () => {
  const f = fixture();
  f.addRoots();
  f.addCanary();
  f.nodes.get(CANARY).data.fill(65);
  await rejected(f.run(), 'CANARY_CONTENT_REJECTED');
  assert.equal(f.calls.writeOpen, 0);
});

test('file replaced before read is rejected', async () => {
  const f = fixture();
  f.addRoots();
  f.addCanary();
  f.state.onReadOpen = (n) => { n.ino++; };
  await rejected(f.run(), 'CANARY_IDENTITY_CHANGED');
  assert.equal(f.calls.read, 0);
});

test('in-place modification during read is rejected', async () => {
  const f = fixture();
  f.addRoots();
  f.addCanary();
  f.state.onRead = (n) => { n.mtimeMs++; };
  await rejected(f.run(), 'CANARY_CHANGED_DURING_READ');
});

test('partial reads are accumulated before validating synthetic payload', async () => {
  const f = fixture();
  f.state.shortReads = true;
  const result = await f.run();
  assert.equal(result.code, 'OK');
  assert.ok(f.calls.read > 1);
});

test('directory replaced after read prevents reporting success', async () => {
  const f = fixture();
  f.addRoots();
  f.addCanary();
  f.state.onRead = () => { f.nodes.get(ROOT).ino++; };
  await rejected(f.run(), 'DIRECTORY_IDENTITY_CHANGED');
});
