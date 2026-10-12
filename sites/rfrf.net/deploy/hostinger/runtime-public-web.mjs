import { cp, mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const DRAFT = Object.freeze({
  oemNumber: '27060-0V030',
  partText: 'alternator',
  make: 'Toyota',
  model: 'Camry',
});
const QUERY = '27060-0V030 alternator Toyota Camry';
const LIBRARY = '/app/apps/customer/lib/';
const reject = (code) => {
  throw Object.assign(new Error(code), { safeCode: code });
};

async function loadResearch() {
  const [content, research] = await Promise.all([
    import(`${LIBRARY}public-web-content.ts`),
    import(`${LIBRARY}public-web-research.ts`),
  ]);
  return {
    publicPartQuery: content.publicPartQuery,
    createPublicWebResearch: research.createPublicWebResearch,
  };
}

/** Fixed synthetic GET search; no model, DB, cookies or customer input. */
export async function verifyPublicWeb(sourceSha, dependencies = {}) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha ?? ''))
    reject('public_web_identity_invalid');
  const now = dependencies.now ?? Date.now;
  let result;
  try {
    const library = await (dependencies.loadResearch ?? loadResearch)();
    const query = library.publicPartQuery(DRAFT);
    if (query !== QUERY) reject('public_web_query_invalid');
    result = await library
      .createPublicWebResearch()
      .search(query, AbortSignal.timeout(15_000));
  } catch (error) {
    if (error.safeCode === 'public_web_query_invalid') throw error;
    reject('public_web_search_failed');
  }
  const proof = result?.webResearch;
  if (
    proof?.state !== 'results' ||
    proof.query !== QUERY ||
    !Array.isArray(proof.sources) ||
    proof.sources.length < 1 ||
    proof.sources.length > 5 ||
    !proof.sources.every((source) => source?.verified === false)
  )
    reject('public_web_search_not_verified');
  return {
    contractVersion: 'public-web-search-v1',
    sourceSha,
    observedAt: new Date(now()).toISOString(),
    state: 'results',
    sourceCount: proof.sources.length,
    searchGetVerified: true,
  };
}

async function packageRoot(name, from) {
  const require = createRequire(join(from, 'package.json'));
  let directory = dirname(require.resolve(name));
  for (;;) {
    try {
      const manifest = JSON.parse(
        await readFile(join(directory, 'package.json'), 'utf8'),
      );
      if (manifest.name === name) return { directory, manifest };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) reject('public_web_package_missing');
    directory = parent;
  }
}

async function copyPackage(name, from, destination, ancestors = new Set()) {
  const { directory, manifest } = await packageRoot(name, from);
  if (ancestors.has(directory)) reject('public_web_package_cycle');
  const next = new Set([...ancestors, directory]);
  await cp(directory, destination, {
    recursive: true,
    dereference: true,
    filter: (path) => !relative(directory, path).startsWith('node_modules'),
  });
  for (const dependency of Object.keys(manifest.dependencies ?? {}))
    await copyPackage(
      dependency,
      directory,
      join(destination, 'node_modules', dependency),
      next,
    );
}

/** Builder only: Next bundles these packages, so hydrate their real runtime files. */
export async function stagePublicWebRuntime(root, standalone) {
  const customer = join(root, 'apps/customer');
  const target = join(standalone, 'apps/customer');
  await mkdir(join(target, 'lib'), { recursive: true });
  for (const name of [
    'public-text-reader.ts',
    'public-web-content.ts',
    'public-web-research.ts',
  ])
    await cp(join(customer, 'lib', name), join(target, 'lib', name));
  await cp(join(customer, 'package.json'), join(target, 'package.json'));
  for (const name of ['cheerio', 'ipaddr.js'])
    await copyPackage(name, customer, join(target, 'node_modules', name));
  const shared = join(target, 'node_modules/@rafraf/shared');
  await mkdir(join(shared, 'dist'), { recursive: true });
  await cp(
    join(root, 'packages/shared/package.json'),
    join(shared, 'package.json'),
  );
  await cp(
    join(root, 'packages/shared/dist/part-identifiers.js'),
    join(shared, 'dist/part-identifiers.js'),
  );
  // Fail the Docker build on a missing native import, without sending a request.
  await import(pathToFileURL(join(target, 'lib/public-web-research.ts')));
}
