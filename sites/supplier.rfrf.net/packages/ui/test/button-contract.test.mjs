import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('shared Button is behavior-neutral and form-safe', async () => {
  const component = await source('src/button.tsx');

  assert.doesNotMatch(component, /\balert\s*\(/);
  assert.match(component, /type = 'button'/);
  assert.match(component, /disabled=\{disabled \|\| loading\}/);
  assert.match(component, /aria-busy=\{loading \|\| undefined\}/);
  assert.match(component, /loadingLabel \?\? children/);
  assert.match(component, /'aria-label': string;[\s\S]+children\?: never/);
});

test('shared Button exposes bounded variants, sizes, and accessible targets', async () => {
  const component = await source('src/button.tsx');
  const styles = await source('../brand/src/button.css');
  const brandEntry = await source('../brand/src/styles.css');

  assert.match(component, /'danger' \| 'ghost' \| 'primary' \| 'secondary'/);
  assert.match(component, /'lg' \| 'md' \| 'sm'/);
  assert.match(styles, /min-block-size: 44px/);
  assert.match(
    styles,
    /:root\[data-theme='light'\][\s\S]+data-variant='ghost'[\s\S]+var\(--rafraf-primary\)/,
  );
  assert.match(
    styles,
    /data-variant='primary'\]:hover[\s\S]+var\(--rafraf-color-bg-brand\) 86%[\s\S]+black/,
  );
  assert.match(styles, /\.rafraf-button:disabled/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(brandEntry, /@import '\.\/button\.css';/);
});
