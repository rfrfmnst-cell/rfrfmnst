import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../src/assistant-thread.tsx', import.meta.url),
  'utf8',
);

test('the message feed is the assistant-ui viewport and an accessible chat log', () => {
  assert.match(
    source,
    /<ThreadPrimitive\.Viewport[\s\S]*className="rf-ai-feed"/,
  );
  assert.match(source, /role="log"/);
  assert.match(source, /aria-busy=\{isRunning\}/);
  assert.match(source, /<ThreadPrimitive\.ScrollToBottom asChild>/);
  assert.match(source, /aria-label="الانتقال إلى أحدث رسالة"/);
  assert.match(source, /<ThreadPrimitive\.Empty>/);
  assert.match(source, /صف لي القطعة التي تبحث عنها/);
  assert.match(source, /<ComposerPrimitive\.Cancel asChild>/);
  assert.match(source, /aria-label="إيقاف الرد"/);
  assert.match(
    source,
    /<ComposerPrimitive\.Root asChild>[\s\S]*<form className="rf-ai-composer">/,
  );
  assert.match(source, /submitMode="enter"/);
});

test('streaming and an empty RFQ review remain explicit to assistive technology', () => {
  assert.match(
    source,
    /className="rf-message bot is-typing"[\s\S]*role="status"/,
  );
  assert.match(source, /reviewRows\.length === 0/);
  assert.match(source, /راجع بطاقة «ملخص طلبك» المرتبطة بالمحادثة/);
  assert.match(source, /اختر «رفض» وصححها قبل إنشاء الطلب/);
});
