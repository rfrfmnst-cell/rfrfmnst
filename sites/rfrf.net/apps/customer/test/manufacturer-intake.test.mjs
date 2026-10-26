import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANUFACTURERS, searchManufacturers, manufacturerRequestContext } from '../lib/manufacturers.ts';
import { storeChatEntryDraft, consumeChatEntryDraft, CHAT_ENTRY_DRAFT_MAX_LENGTH } from '../lib/chat-entry-draft.ts';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('search handles Arabic spelling, English names, and category boundaries', () => {
  assert.equal(searchManufacturers('cars', 'تويوتا')[0].id, 'toyota');
  assert.equal(searchManufacturers('cars', 'HYUNDAI')[0].id, 'hyundai');
  assert.equal(searchManufacturers('cars', 'ايسوزو')[0].id, 'isuzu');
  assert.equal(searchManufacturers('equipment', 'كاتربيلر')[0].id, 'caterpillar');
  assert.equal(searchManufacturers('trucks', 'Toyota').length, 0);
});
test('manufacturer, model and year survive the existing login handoff', () => {
  const manufacturer = MANUFACTURERS.find((item) => item.id === 'toyota');
  const context = manufacturerRequestContext({ category: 'cars', manufacturer, model: 'كامري', year: '2020' });
  let value;
  const storage = { setItem(_key, data) { value = data; }, getItem() { return value; }, removeItem() { value = null; } };
  assert.ok(storeChatEntryDraft(storage, { text: context + 'فحمات أمامية', attachmentRequested: true }, 100));
  const draft = consumeChatEntryDraft(storage, 101);
  assert.match(draft.text, /Toyota/); assert.match(draft.text, /كامري/); assert.match(draft.text, /2020/); assert.match(draft.text, /فحمات أمامية/);
  assert.equal(draft.attachmentRequested, true);
  assert.equal(consumeChatEntryDraft(storage, 102), null);
});
test('custom equipment manufacturer is carried as context and invalid year is ignored', () => {
  assert.match(manufacturerRequestContext({ category: 'equipment', customName: 'معدات خاصة', model: 'X1', year: '2020' }), /معدات خاصة/);
  assert.equal(manufacturerRequestContext({ category: 'cars' }), '');
  assert.doesNotMatch(manufacturerRequestContext({ category: 'cars', customName: 'اختبار', year: 'bad' }), /سنة/);
});
test('a long description fits with vehicle context without losing either', () => {
  const context = manufacturerRequestContext({ category: 'equipment', customName: 'شركة '.repeat(20), model: 'طراز '.repeat(20), year: '2020' });
  const text = context + 'ق'.repeat(CHAT_ENTRY_DRAFT_MAX_LENGTH - context.length);
  assert.equal(text.length, CHAT_ENTRY_DRAFT_MAX_LENGTH);
});
test('catalog IDs and logo assets are valid, local and attributed', () => {
  assert.equal(new Set(MANUFACTURERS.map((item) => item.id)).size, MANUFACTURERS.length);
  const sources = JSON.parse(readFileSync(resolve(root, 'public/manufacturers/sources.json'), 'utf8'));
  for (const item of MANUFACTURERS) {
    if (!item.logo) continue;
    assert.ok(item.logo.startsWith('/manufacturers/'));
    assert.ok(existsSync(resolve(root, 'public' + item.logo)), item.id);
    assert.ok(sources.some((source) => source.id === item.id && source.file === item.logo.split('/').at(-1)), item.id);
  }
});
