import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, '../../..');

async function read(path) {
  return readFile(resolve(repoRoot, path), 'utf8');
}

test('the Rafraf master is a bounded, safe vector asset', async () => {
  const svg = await read('packages/brand/assets/logo/rafraf-mark.svg');

  assert.match(svg, /^<svg\b[^>]*viewBox="0 0 587 657"/);
  assert.equal((svg.match(/<path\b/g) ?? []).length, 4);
  assert.ok((svg.match(/<linearGradient\b/g) ?? []).length >= 3);
  assert.match(svg, /<svg\b[^>]*fill="none"/);
  assert.doesNotMatch(svg, /<(?:image|script|foreignObject|metadata)\b/i);
  assert.doesNotMatch(svg, /<(?:rect|style|use)\b/i);
  assert.doesNotMatch(svg, /<!(?:DOCTYPE|ENTITY)|<\?xml-stylesheet/i);
  assert.doesNotMatch(svg, /\b(?:href|xlink:href|src)\s*=/i);
  assert.doesNotMatch(svg, /\bon[a-z]+\s*=/i);
  assert.doesNotMatch(svg, /(?:data:image|base64)/i);
  assert.ok(Buffer.byteLength(svg) < 5_000, 'SVG master should stay compact');
});

test('BrandLogo exposes one accessible name and consumes the SVG master', async () => {
  const [component, styles] = await Promise.all([
    read('packages/ui/src/brand-logo.tsx'),
    read('packages/brand/src/styles.css'),
  ]);

  assert.match(component, /role="img"/);
  assert.match(
    component,
    /aria-label=\{descriptor \? `رفرف — \$\{descriptor\}` : 'رفرف'\}/,
  );
  assert.match(component, /className="rafraf-brand__mark" aria-hidden/);

  const pngFallback = styles.indexOf("url('../assets/logo/rafraf-mark.png')");
  const svgMaster = styles.indexOf("url('../assets/logo/rafraf-mark.svg')");
  assert.ok(pngFallback >= 0, 'legacy PNG fallback must remain available');
  assert.ok(svgMaster > pngFallback, 'SVG master must be the preferred source');
});
