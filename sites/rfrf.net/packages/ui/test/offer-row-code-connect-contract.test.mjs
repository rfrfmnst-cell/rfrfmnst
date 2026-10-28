import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, '../../..');

async function read(path) {
  return readFile(resolve(repoRoot, path), 'utf8');
}

test('OfferRow exports the runtime design contract', async () => {
  const component = await read('packages/ui/src/offer-row.tsx');
  assert.match(component, /export interface OfferRowProps/);
  assert.match(component, /export function OfferRow/);
  assert.match(component, /'default' \| 'selected'/);
});

test('OfferRow Code Connect assets stay aligned with the current Figma component', async (t) => {
  try {
    await access(resolve(repoRoot, 'design-system/code-connect/OfferRow.figma.ts'));
    await access(resolve(repoRoot, 'figma.config.json'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    t.skip('The captured Hostinger source does not include Figma authoring assets; external alignment is unverified.');
    return;
  }
  const [component, template, config] = await Promise.all([
    read('packages/ui/src/offer-row.tsx'),
    read('design-system/code-connect/OfferRow.figma.ts'),
    read('figma.config.json'),
  ]);

  assert.match(component, /export interface OfferRowProps/);
  assert.match(component, /export function OfferRow/);
  assert.match(component, /'default' \| 'selected'/);

  assert.match(template, /SYbtz3uoi6AtCM73Ni1zNy/);
  assert.match(template, /node-id=152-42/);
  assert.match(template, /source=packages\/ui\/src\/offer-row\.tsx/);
  assert.match(template, /figma\.code`/);
  assert.doesNotMatch(template, /figma\.connect/);

  for (const property of [
    'Supplier',
    'City',
    'Rating',
    'Availability',
    'Delivery',
    'Price',
    'Initial',
    'Recommended',
    'State',
  ]) {
    assert.match(template, new RegExp(`['"]${property}['"]`));
  }

  assert.match(template, /Default: 'default'/);
  assert.match(template, /Selected: 'selected'/);
  assert.match(config, /design-system\/code-connect\/\*\*\/\*\.figma\.ts/);
});
