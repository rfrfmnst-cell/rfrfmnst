// Consume the one-shot private seed before application modules can read its environment.
let privateSeed = process.env.RAFRAF_CLIENT_STORAGE_SEED;
const verifyPrivateSeed = process.env.RAFRAF_CLIENT_STORAGE_VERIFY === 'true';
delete process.env.RAFRAF_CLIENT_STORAGE_SEED;
let seedHelper;
let identityFailure;
try {
  let witness;
  if (privateSeed !== undefined || verifyPrivateSeed) {
    const releaseSha = process.env.RAFRAF_RELEASE_SHA;
    const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
    if (typeof releaseSha !== 'string' || !/^[0-9a-f]{40}$/.test(releaseSha)) {
      identityFailure = 'SEED_RELEASE_IDENTITY_REJECTED';
      throw new Error('Private storage identity rejected');
    }
    if (!Number.isSafeInteger(uid) || uid <= 0) {
      identityFailure = 'SEED_UID_REJECTED';
      throw new Error('Private storage identity rejected');
    }
    seedHelper = require('./managed-storage-seed.cjs');
    witness = privateSeed !== undefined
      ? seedHelper.importPrivateStorageSeed(privateSeed)
      : seedHelper.verifyPrivateStorageSeed();
    witness = { ...witness, release_sha: releaseSha, uid };
  }
  privateSeed = undefined;
  if (witness) process.stdout.write(`${JSON.stringify({
    timestamp: new Date().toISOString(), level: 'info', message: JSON.stringify(witness),
  })}\n`);
} catch (error) {
  privateSeed = undefined;
  const code = identityFailure || seedHelper?.seedFailureCode(error) || 'SEED_HELPER_UNAVAILABLE';
  process.stdout.write(`${JSON.stringify({
    timestamp: new Date().toISOString(), level: 'error',
    message: JSON.stringify({ event: 'rafraf.client_storage_seed_failed', code }),
  })}\n`);
  process.exit(1);
}
// Hostinger may require this entry from its loader; no direct-main guard is used.
require('./dist/main.js');
// Synthetic filesystem diagnostics remain nonblocking and run only after HTTP listen.
require('./managed-storage-scheduler.cjs').scheduleStorageProbe();
