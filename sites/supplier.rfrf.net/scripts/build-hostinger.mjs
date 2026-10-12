import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinnedPnpm } from './pinned-pnpm.mjs';
import { verifyNativeRuntime } from './verify-native-runtime.mjs';
import { stagePrismaRuntime } from './stage-prisma-runtime.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (Number(process.versions.node.split('.')[0]) !== 24) {
  throw new Error('Hostinger supplier requires Node.js 24.');
}

// Bind the public supplier origin while Next compiles its public environment.
const environment = {
  ...process.env,
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'https://api.rfrf.net',
  NEXT_PUBLIC_SUPPLIER_APP_URL:
    process.env.NEXT_PUBLIC_SUPPLIER_APP_URL || 'https://supplier.rfrf.net',
  TURBO_TELEMETRY_DISABLED: '1',
  NEXT_TELEMETRY_DISABLED: '1',
};
// VERCEL disables the standalone output in the canonical Next configuration.
delete environment.VERCEL;

await mkdir(join(root, 'apps/supplier/public'), { recursive: true });
const pnpm = await pinnedPnpm(root, environment);
await new Promise((resolveBuild, rejectBuild) => {
  const child = spawn(pnpm.command, [...pnpm.args, 'turbo', 'run', 'build', '--filter=supplier...'], {
    cwd: root,
    env: environment,
    stdio: 'inherit',
    shell: false,
  });
  child.once('error', rejectBuild);
  child.once('exit', (code, signal) =>
    code === 0
      ? resolveBuild()
      : rejectBuild(new Error(`Supplier build failed (${code ?? signal}).`)),
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

const next = join(root, 'apps/supplier/.next');
const standalone = join(next, 'standalone');
const helpersSource = await swcHelpers(join(root, 'node_modules/.pnpm'));
const helpersTarget = await swcHelpers(join(standalone, 'node_modules/.pnpm'));
await cp(helpersSource, helpersTarget, {
  recursive: true,
  verbatimSymlinks: true,
});
await stat(join(helpersTarget, 'esm/_interop_require_default.js'));
await stagePrismaRuntime(root, standalone);

const runtime = join(root, 'hostinger-runtime');
await rm(runtime, { recursive: true, force: true });
await cp(standalone, runtime, { recursive: true, verbatimSymlinks: true });
await cp(join(next, 'static'), join(runtime, 'apps/supplier/.next/static'), {
  recursive: true,
});
await cp(
  join(root, 'apps/supplier/public'),
  join(runtime, 'apps/supplier/public'),
  { recursive: true },
);
for (const name of ['runtime-public-web.mjs', 'runtime-qa-identity.mjs'])
  await cp(join(root, 'deploy/hostinger', name), join(runtime, name));
await stat(join(runtime, 'apps/supplier/server.js'));
await verifyNativeRuntime(root, 'supplier');
await cp(join(root, 'scripts/managed-storage-diagnostic.mjs'), join(runtime, 'managed-storage-diagnostic.mjs'));
await cp(join(root, 'scripts/managed-storage-scheduler.cjs'), join(runtime, 'managed-storage-scheduler.cjs'));
await cp(join(root, 'scripts/managed-storage-startup-probe.mjs'), join(runtime, 'managed-storage-startup-probe.mjs'));
await cp(join(root, 'scripts/managed-web-bootstrap.cjs'), join(runtime, 'bootstrap.cjs'));
await stat(join(runtime, 'bootstrap.cjs'));
await stat(join(runtime, 'managed-storage-scheduler.cjs'));
await stat(join(runtime, 'managed-storage-startup-probe.mjs'));
await stat(join(runtime, 'managed-storage-diagnostic.mjs'));
process.stdout.write('Hostinger standalone supplier runtime is ready.\n');
