import { cp, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';

/** Webpack can bundle Prisma JS while omitting generated engines from tracing. */
export async function stagePrismaRuntime(root, standalone) {
  const require = createRequire(join(root, 'packages/db/package.json'));
  const client = dirname(require.resolve('@prisma/client/package.json'));
  const generated = resolve(client, '../../.prisma/client');
  await stat(join(generated, 'schema.prisma'));
  for (const source of [client, generated]) {
    const destination = relative(root, source);
    if (destination.startsWith('..') || !destination.startsWith('node_modules/'))
      throw new Error('Prisma runtime source must be inside the installed workspace.');
    await cp(source, join(standalone, destination), {
      recursive: true,
      verbatimSymlinks: true,
    });
  }
}
