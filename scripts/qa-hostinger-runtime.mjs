import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { access, readdir, realpath } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const surfaces = {
  'rfrf.net': 'customer',
  'supplier.rfrf.net': 'supplier',
  'admin.rfrf.net': 'admin',
  'api.rfrf.net': 'api',
};
const site = process.argv[2];
assert.ok(Object.hasOwn(surfaces, site ?? ''), 'Pass one Rafraf site domain.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = join(root, 'sites', site, 'hostinger-runtime');
await access(join(runtime, 'bootstrap.cjs'));

// A successful build must not depend on symlinks back to the source install.
const runtimeRealPath = await realpath(runtime);
let linksChecked = 0;
async function verifyLinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const target = await realpath(path);
      const suffix = relative(runtimeRealPath, target);
      assert.ok(suffix !== '..' && !suffix.startsWith(`..${sep}`) && !suffix.startsWith(sep),
        'Runtime symlink escapes the deployable directory.');
      linksChecked++;
    } else if (entry.isDirectory()) {
      await verifyLinks(path);
    }
  }
}
await verifyLinks(runtime);

const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise((done, reject) => reservation.close(error => error ? reject(error) : done()));
const release = '1234567890abcdef1234567890abcdef12345678';
// Deliberately use no inherited credentials, databases or provider configuration.
const child = spawn(process.execPath, ['bootstrap.cjs'], {
  cwd: runtime,
  env: {
    PATH: process.env.PATH,
    NODE_ENV: 'production',
    HOSTNAME: '127.0.0.1',
    PORT: String(port),
    RAFRAF_RELEASE_SHA: release,
    NEXT_TELEMETRY_DISABLED: '1',
  },
  stdio: ['ignore', 'ignore', 'ignore'],
});
const finished = once(child, 'exit');
let spawnError;
child.on('error', error => { spawnError = error; });
// Avoid an unhandled rejection if the executable cannot start.
finished.catch(() => {});
try {
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30000;
  let response;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    assert.equal(child.exitCode, null, 'Runtime exited before serving liveness.');
    try {
      response = await fetch(`${origin}/api/liveness`, { signal: AbortSignal.timeout(2000) });
      break;
    } catch {
      await delay(150);
    }
  }
  assert.ok(response, 'Runtime failed to listen within 30 seconds.');
  assert.equal(response.status, 200, 'Liveness must return HTTP 200.');
  assert.deepEqual(await response.json(), {
    service: `rafraf-${surfaces[site]}`, status: 'alive', release: release.slice(0, 12),
  });
  const page = await fetch(origin, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
  // With no cookies or provider credentials, private surfaces must stay closed.
  const rootStatus = site === 'admin.rfrf.net' ? 503 : site === 'supplier.rfrf.net' ? 401 : 200;
  assert.equal(page.status, rootStatus, 'Root response must match the credential-free access contract.');
  if (site === 'admin.rfrf.net') {
    assert.equal(await page.text(), 'لوحة الإدارة غير مُهيّأة.');
  } else if (site === 'supplier.rfrf.net') {
    assert.equal(await page.text(), 'مطلوب تسجيل الدخول');
    const login = await fetch(`${origin}/login`, { signal: AbortSignal.timeout(10000) });
    assert.equal(login.status, 200, 'Supplier public login must render.');
    assert.ok((await login.text()).includes('بوابة الموردين'));
  } else {
    await page.body?.cancel();
  }
  if (surfaces[site] !== 'api') {
    const staticRoot = join(runtime, 'apps', surfaces[site], '.next', 'static');
    async function findAsset(directory) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isFile() && /\.(js|css)$/.test(entry.name)) return path;
        if (entry.isDirectory()) {
          const found = await findAsset(path);
          if (found) return found;
        }
      }
    }
    const asset = await findAsset(staticRoot);
    assert.ok(asset, 'A web runtime must contain compiled assets.');
    const assetPath = relative(staticRoot, asset).split(sep).map(encodeURIComponent).join('/');
    const assetResponse = await fetch(`${origin}/_next/static/${assetPath}`, { signal: AbortSignal.timeout(10000) });
    assert.equal(assetResponse.status, 200, 'Compiled asset must be served from the packaged runtime.');
    assert.match(assetResponse.headers.get('content-type') ?? '', /javascript|text\/css/);
    await assetResponse.body?.cancel();
  }
  console.log(JSON.stringify({ site, runtimeVerified: true, linksChecked, providerRequests: false }));
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await Promise.race([finished, delay(3000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await finished;
  }
}
