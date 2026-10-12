import test from 'node:test';
import assert from 'node:assert/strict';
import { reportStorage } from './managed-storage-startup-probe.mjs';

function success() {
  return {
    code: 'OK', uid: 1742,
    dirModes: { storage: '700', evidence: '700', supplier: '700' },
    access: Object.fromEntries(['home', 'storage', 'evidence', 'supplier'].map((label) => [
      label, { readable: true, writable: true, searchable: true },
    ])),
    canarySHA256: 'a'.repeat(64), canaryExisted: true,
    devino: Object.fromEntries(['home', 'storage', 'evidence', 'supplier', 'canary'].map((label) => [
      label, { dev: '7', ino: '100' },
    ])),
  };
}
async function run(diagnose) {
  let line;
  await reportStorage({ diagnose, output: (value) => { line = value; },
    uid: () => 1742, now: () => new Date('2026-10-09T00:00:00.000Z') });
  const logged = JSON.parse(line);
  assert.deepEqual(Object.keys(logged).sort(), ['level', 'message', 'timestamp']);
  return { logged, payload: JSON.parse(logged.message), line };
}
test('reporter logs only synthetic aggregate fields with fixed surface', async () => {
  const raw = success(); raw.credentials = 'must-never-be-logged';
  const result = await run(async () => raw);
  assert.equal(result.logged.level, 'info');
  assert.equal(result.payload.surface, 'api');
  assert.equal(result.payload.code, 'OK');
  assert.ok(!result.line.includes('must-never-be-logged'));
});
test('known filesystem diagnostic failure remains code-only', async () => {
  const result = await run(async () => { throw Object.assign(new Error('private secret'), { code: 'ENOENT' }); });
  assert.equal(result.payload.code, 'FILESYSTEM_ENOENT');
  assert.ok(!result.line.includes('secret'));
});
test('known diagnostic ownership failure is sanitized', async () => {
  const result = await run(async () => { throw { diagnosticCode: 'OWNER_MISMATCH', message: 'secret' }; });
  assert.equal(result.payload.code, 'OWNER_MISMATCH');
});
test('unknown diagnostic failure cannot inject a log field', async () => {
  const result = await run(async () => { throw { diagnosticCode: 'filename.secret', code: 'TOKEN_VALUE' }; });
  assert.equal(result.payload.code, 'STORAGE_DIAGNOSTIC_FAILURE');
  assert.ok(!result.line.includes('secret') && !result.line.includes('TOKEN_VALUE'));
});
test('malformed purported success is rejected without identity leakage', async () => {
  const raw = success(); raw.devino.home.ino = '/customer/object';
  const result = await run(async () => raw);
  assert.equal(result.payload.code, 'STORAGE_DIAGNOSTIC_RESULT_REJECTED');
  assert.ok(!result.line.includes('/customer'));
});
