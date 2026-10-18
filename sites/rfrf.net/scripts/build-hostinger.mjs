import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinnedPnpm } from './pinned-pnpm.mjs';
import { verifyNativeRuntime } from './verify-native-runtime.mjs';
import { stagePrismaRuntime } from './stage-prisma-runtime.mjs';
import { stagePublicWebRuntime } from '../deploy/hostinger/runtime-public-web.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (Number(process.versions.node.split('.')[0]) !== 24) {
  throw new Error('Hostinger customer requires Node.js 24.');
}

// These public values must be present while the landing page is prerendered.
const environment = {
  ...process.env,
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'https://api.rfrf.net',
  NEXT_PUBLIC_SUPPLIER_APP_URL:
    process.env.NEXT_PUBLIC_SUPPLIER_APP_URL || 'https://supplier.rfrf.net',
  CUSTOMER_PUBLIC_URL: process.env.CUSTOMER_PUBLIC_URL || 'https://rfrf.net',
  TURBO_TELEMETRY_DISABLED: '1',
  NEXT_TELEMETRY_DISABLED: '1',
};
// VERCEL disables the standalone output in the canonical Next configuration.
delete environment.VERCEL;

await mkdir(join(root, 'apps/customer/public'), { recursive: true });
const pnpm = await pinnedPnpm(root, environment);
await new Promise((resolveBuild, rejectBuild) => {
  const child = spawn(pnpm.command, [...pnpm.args, 'turbo', 'run', 'build', '--filter=customer...'], {
    cwd: root,
    env: environment,
    stdio: 'inherit',
    shell: false,
  });
  child.once('error', rejectBuild);
  child.once('exit', (code, signal) =>
    code === 0
      ? resolveBuild()
      : rejectBuild(new Error(`Customer build failed (${code ?? signal}).`)),
  );
});

async function swcHelpers(store) {
  for (const entry of await readdir(store, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('@swc+helpers@')) {
      const candidate = join(store, entry.name, 'node_modules/@swc/helpers');
      try {
        if ((await stat(join(candidate, 'package.json'))).isFile())
          return candidate;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  throw new Error(`Missing traced @swc/helpers package in ${store}.`);
}

const next = join(root, 'apps/customer/.next');
const standalone = join(next, 'standalone');
const helpersSource = await swcHelpers(join(root, 'node_modules/.pnpm'));
const helpersTarget = await swcHelpers(join(standalone, 'node_modules/.pnpm'));
await cp(helpersSource, helpersTarget, {
  recursive: true,
  verbatimSymlinks: true,
});
await stat(join(helpersTarget, 'esm/_interop_require_default.js'));
await stagePrismaRuntime(root, standalone);
// Stage real source/package files needed by the fixed public-web runtime probe.
// This copies files and validates imports; it makes no network or DB request.
await stagePublicWebRuntime(root, standalone);

const runtime = join(root, 'hostinger-runtime');
await rm(runtime, { recursive: true, force: true });
await cp(standalone, runtime, { recursive: true, verbatimSymlinks: true });
await cp(join(next, 'static'), join(runtime, 'apps/customer/.next/static'), {
  recursive: true,
});
await cp(
  join(root, 'apps/customer/public'),
  join(runtime, 'apps/customer/public'),
  { recursive: true },
);
for (const name of ['runtime-public-web.mjs', 'runtime-qa-identity.mjs'])
  await cp(join(root, 'deploy/hostinger', name), join(runtime, name));
await stat(join(runtime, 'apps/customer/server.js'));
await verifyNativeRuntime(root, 'customer');
// Start the original server synchronously; run fixed storage diagnostics only after listen.
for (const name of ['managed-storage-diagnostic.mjs', 'managed-storage-startup-probe.mjs', 'managed-storage-scheduler.cjs'])
  await cp(join(root, 'scripts', name), join(runtime, name));
await cp(join(root, 'scripts/managed-action-origin.cjs'), join(runtime, 'managed-action-origin.cjs'));
await cp(join(root, 'scripts/managed-web-bootstrap.cjs'), join(runtime, 'bootstrap.cjs'));
await stat(join(runtime, 'bootstrap.cjs'));
process.stdout.write('Hostinger standalone customer runtime is ready.\n');
