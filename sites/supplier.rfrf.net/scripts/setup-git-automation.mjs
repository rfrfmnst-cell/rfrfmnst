import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function git(args, options = {}) {
  return spawnSync('git', args, {
    cwd: options.cwd,
    encoding: 'utf8',
    shell: false,
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
  });
}

if (process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true') {
  process.exit(0);
}

const rootResult = git(['rev-parse', '--show-toplevel']);
if (rootResult.status !== 0) {
  process.exit(0);
}

const root = rootResult.stdout.trim();
if (!root || !existsSync(resolve(root, '.githooks'))) {
  process.exit(0);
}

const current = git(['config', '--local', '--get', 'core.hooksPath'], {
  cwd: root,
});
const configured = current.status === 0 ? current.stdout.trim() : '';

if (configured && configured !== '.githooks') {
  process.stderr.write(
    `[rafraf-git] أبقينا core.hooksPath الحالي (${configured}) ولم نستبدل hooks مخصصة.\n`,
  );
  process.exit(0);
}

const update = git(['config', '--local', 'core.hooksPath', '.githooks'], {
  cwd: root,
  stdio: 'inherit',
});
if (update.status !== 0) {
  process.exit(update.status ?? 1);
}

process.stdout.write('[rafraf-git] فُعّلت بوابات Git المحلية لهذا المستودع.\n');
