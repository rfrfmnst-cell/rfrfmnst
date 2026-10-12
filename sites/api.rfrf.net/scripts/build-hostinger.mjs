import { cp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (Number(process.versions.node.split('.')[0]) !== 24) {
  throw new Error('Hostinger API requires Node.js 24.');
}

// Hostinger runs this script through pnpm; use its exact pinned launcher.
// A direct `node` invocation uses an explicit versioned npm launcher instead.
const pnpmScript = process.env.npm_execpath;
const usePinnedScript = pnpmScript && /^pnpm(?:\.[cm]?js)?$/.test(basename(pnpmScript));
let command = usePinnedScript ? process.execPath : 'npm';
let prefix = usePinnedScript
  ? [pnpmScript]
  : ['exec', '--yes', '--package=pnpm@11.6.0', '--', 'pnpm'];
const environment = { ...process.env, TURBO_TELEMETRY_DISABLED: '1' };
function launcherVersion() {
  const version = spawnSync(command, [...prefix, '--version'], {
    cwd: root,
    env: environment,
    encoding: 'utf8',
    shell: false,
  });
  return version.status === 0 ? version.stdout.trim() : null;
}
if (usePinnedScript && launcherVersion() !== '11.6.0') {
  command = 'npm';
  prefix = ['exec', '--yes', '--package=pnpm@11.6.0', '--', 'pnpm'];
}
if (launcherVersion() !== '11.6.0') {
  throw new Error('Hostinger API build requires exact pnpm 11.6.0.');
}
process.stdout.write('API build is using exact pnpm 11.6.0.\n');

function runPnpm(args) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, [...prefix, ...args], {
      cwd: root,
      env: environment,
      stdio: 'inherit',
      shell: false,
    });
    child.once('error', rejectCommand);
    child.once('exit', (code, signal) =>
      code === 0
        ? resolveCommand()
        : rejectCommand(new Error(`API command failed (${code ?? signal}).`)),
    );
  });
}

// API's two build scripts are plain tsc/Nest and need no task runner. Invoke
// them through this exact launcher so Turbo cannot discover a different pnpm.
await runPnpm(['--filter', '@rafraf/jest-config', 'run', 'build']);
await runPnpm(['--filter', 'api', 'run', 'build']);
const runtime = join(root, 'hostinger-runtime');
await rm(runtime, { recursive: true, force: true });
// The legacy mode needs no injected workspace packages. API runtime has only
// external Nest dependencies; development workspace packages are excluded.
const statePath = join(root, 'node_modules/.pnpm-workspace-state-v1.json');
const sourceState = await readFile(statePath);
try {
  await runPnpm(['--filter', 'api', 'deploy', '--legacy', '--prod', '--frozen-lockfile', runtime]);
} finally {
  // pnpm 11 legacy deploy updates the source workspace state to production-only.
  // Preserve the build workspace state so later builds/tests do not purge it.
  await writeFile(statePath, sourceState);
}
// Legacy deploy hoists the package's own name with a link back to the source.
// Bind that self import to this standalone runtime instead.
const selfLink = join(runtime, 'node_modules/.pnpm/node_modules/api');
await rm(selfLink, { force: true });
await symlink('../../..', selfLink);
// pnpm's packlist can omit ignored build outputs; copy the compiled API explicitly.
await mkdir(join(runtime, 'dist'), { recursive: true });
await cp(join(root, 'apps/api/dist'), join(runtime, 'dist'), {
  recursive: true,
});
await cp(join(root, 'scripts/managed-api-bootstrap.cjs'), join(runtime, 'bootstrap.cjs'));
await cp(join(root, 'scripts/managed-storage-seed.cjs'), join(runtime, 'managed-storage-seed.cjs'));
await stat(join(runtime, 'managed-storage-seed.cjs'));
await cp(join(root, 'scripts/managed-storage-scheduler.cjs'), join(runtime, 'managed-storage-scheduler.cjs'));
await cp(join(root, 'scripts/managed-storage-startup-probe.mjs'), join(runtime, 'managed-storage-startup-probe.mjs'));
await cp(join(root, 'scripts/managed-storage-diagnostic.mjs'), join(runtime, 'managed-storage-diagnostic.mjs'));
await stat(join(runtime, 'dist/main.js'));
await stat(join(runtime, 'bootstrap.cjs'));
await stat(join(runtime, 'node_modules/@nestjs/core/package.json'));
process.stdout.write('Hostinger isolated Nest API runtime is ready.\n');
