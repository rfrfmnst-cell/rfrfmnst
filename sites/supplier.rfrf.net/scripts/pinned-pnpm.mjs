import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

const VERSION = '11.6.0';

async function matchesVersion(command, args, options) {
  return new Promise((resolveVersion) => {
    const child = spawn(command, [...args, '--version'], {
      ...options,
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: false,
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      if (output.length < 4096) output += chunk.toString();
    });
    child.once('error', () => resolveVersion(false));
    child.once('exit', (code) =>
      resolveVersion(code === 0 && output.trim() === VERSION),
    );
  });
}

/** Use the pnpm CLI that started this script, with an exact npm fallback. */
export async function pinnedPnpm(cwd, env) {
  const inherited = env.npm_execpath;
  const options = { cwd, env };
  let launcher;
  if (
    inherited &&
    /(?:^|[\\/])pnpm\.(?:cjs|mjs|js)$/.test(inherited) &&
    (await matchesVersion(process.execPath, [inherited], options))
  ) {
    process.stdout.write(`Using inherited pnpm ${VERSION} CLI.\n`);
    launcher = { command: process.execPath, args: [inherited] };
  } else {
    const args = ['exec', '--yes', `--package=pnpm@${VERSION}`, '--', 'pnpm'];
    if (!(await matchesVersion('npm', args, options))) {
      throw new Error(`Could not launch required pnpm ${VERSION}.`);
    }
    process.stdout.write(`Using exact npm launcher for pnpm ${VERSION}.\n`);
    launcher = { command: 'npm', args };
  }

  // Turbo invokes the package manager again for dependency build tasks. Give
  // those child processes the same pinned launcher instead of a Corepack shim.
  const quote = (value) => `'${value.replace(/'/g, `'"'"'`)}'`;
  const tools = join(cwd, '.hostinger-tools');
  await mkdir(tools, { recursive: true });
  const words = [launcher.command, ...launcher.args].map(quote).join(' ');
  await writeFile(join(tools, 'pnpm'), `#!/bin/sh\nexec ${words} "$@"\n`, {
    mode: 0o755,
  });
  env.PATH = `${tools}${delimiter}${env.PATH ?? ''}`;
  return launcher;
}
