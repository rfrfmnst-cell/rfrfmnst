import { readdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/** Load native libraries without creating a Prisma client or external request. */
export async function verifyNativeRuntime(root, surface) {
  if (!['customer', 'supplier', 'admin'].includes(surface))
    throw new Error('Unknown managed web surface.');
  const sourceRequire = createRequire(join(root, 'packages/db/package.json'));
  const prismaRequire = createRequire(sourceRequire.resolve('prisma/package.json'));
  const { getBinaryTargetForCurrentPlatform } = prismaRequire('@prisma/get-platform');
  const target = await getBinaryTargetForCurrentPlatform();
  const runtime = join(root, 'hostinger-runtime');
  const store = join(runtime, 'node_modules/.pnpm');
  let engine;
  for (const entry of await readdir(store, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('@prisma+client@')) continue;
    const candidate = join(store, entry.name, 'node_modules/.prisma/client',
      `libquery_engine-${target}.so.node`);
    try {
      if ((await stat(candidate)).isFile()) { engine = candidate; break; }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (!engine || typeof sourceRequire(engine).QueryEngine !== 'function')
    throw new Error('Prisma runtime native engine cannot load on this host.');
  const appRequire = createRequire(join(runtime, 'apps', surface, 'server.js'));
  const nextRequire = createRequire(appRequire.resolve('next/package.json'));
  const image = await nextRequire('sharp')({
    create: { width: 1, height: 1, channels: 3, background: '#000' },
  }).png().toBuffer();
  if (!image.length) throw new Error('Sharp runtime native transform failed.');
  const proof = { prismaTarget: target, prismaNativeLoaded: true,
    sharpNativeTransform: true, databaseConnected: false, providerRequests: false };
  process.stdout.write(`Managed native runtime check: ${JSON.stringify(proof)}\n`);
  return proof;
}
