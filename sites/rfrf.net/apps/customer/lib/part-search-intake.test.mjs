import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const source = stripTypeScriptTypes(await readFile(new URL('./part-search-intake.ts', import.meta.url), 'utf8'), {mode:'strip'}).replace("'./vin'", JSON.stringify(new URL('./vin.ts', import.meta.url).href));
const { partSearchIntake } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('VIN intake normalizes separators and lower case without claiming a decode', () => {
  const result = partSearchIntake('vin', 'jtnb11hk5m3087962');
  assert.ok(result.text.includes('JTNB11HK5M3087962'));
  assert.equal('error' in partSearchIntake('vin', 'JTNI11HK5M3087962'), true);
  assert.equal('error' in partSearchIntake('vin', '1234'), true);
});
test('part numbers retain leading zeroes and manufacturer separators', () => {
  assert.ok(partSearchIntake('number','000123-AB/02').text.includes('000123-AB/02'));
});
test('blank, oversized and multiline requests are rejected', () => {
  assert.ok(partSearchIntake('name',' ').error);
  assert.ok(partSearchIntake('number','1'.repeat(81)).error);
  assert.ok(partSearchIntake('name','دينمو\nتعليمات').error);
});
