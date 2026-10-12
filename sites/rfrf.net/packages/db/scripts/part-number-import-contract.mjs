/**
 * عقد استيراد أرقام القطع — منطق نقي بلا قاعدة بيانات ليُختبر مباشرة.
 *
 * لماذا هذا الملف موجود: `PartNumber` فارغ في الإنتاج، و`resolvePart` في
 * `apps/supplier/app/catalog/catalog-mutation-service.ts` يطابق عليه حصراً،
 * فيُوسَم كل صف كتالوج يرفعه أي مورّد `FLAGGED` بلا ربط بقطعة.
 *
 * قيدان يحكمان التصميم:
 *  1. **القواعد نفسها التي يقبلها رافع كتالوج المورّد** (`catalog-policy.ts`)،
 *     وإلا بقيت صفوف صحيحة بلا مطابقة.
 *  2. **الإدمان صريح**: `PartNumber` بلا مفتاح فريد (فهرس غير فريد على `number`
 *     فقط)، فـ`skipDuplicates` لا يمنع التكرار. الخطة تُحسب مقابل الصفوف
 *     القائمة قبل أي كتابة.
 */

/** حدّ الطول ونمط الحروف كما في `apps/supplier/app/catalog/catalog-policy.ts`. */
export const PART_NUMBER_PATTERN = /^[A-Z0-9][A-Z0-9._/\- ]+$/u;
export const PART_NUMBER_MIN_LENGTH = 2;
export const PART_NUMBER_MAX_LENGTH = 80;
export const PART_NUMBER_TYPES = ['OEM', 'AFTERMARKET', 'CROSS_REFERENCE'];
export const BRAND_MAX_LENGTH = 80;

/**
 * حارس النصّ غير الآمن كما في `catalog-policy.ts:51` حرفياً: محارف تحكّم، أو
 * بادئة `=`/`+`/`@` التي تُنفَّذ كصيغة عند فتح تصدير CSV في جدول بيانات.
 */
function hasUnsafeText(value) {
  return /\p{Cc}/u.test(value) || /^[=+@]/u.test(value);
}

const REQUIRED_HEADERS = ['number'];
const PART_KEYS = ['partId', 'nameAr'];

function normalizeSpaces(value) {
  return String(value ?? '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** يطابق تطبيع رافع الكتالوج: ضغط المسافات ثم رفع الحالة. */
export function normalizePartNumber(value) {
  return normalizeSpaces(value).toUpperCase();
}

export function partNumberRejectionReason(value) {
  const number = normalizePartNumber(value);
  if (number.length < PART_NUMBER_MIN_LENGTH) return 'part_number_too_short';
  if (number.length > PART_NUMBER_MAX_LENGTH) return 'part_number_too_long';
  if (!PART_NUMBER_PATTERN.test(number)) return 'part_number_charset';
  return null;
}

/** قارئ CSV صغير يحترم الحقول المقتبسة والفواصل داخلها وأسطر CRLF. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const source = String(text ?? '').replace(/^﻿/u, '');
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character !== '"') {
        field += character;
      } else if (source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = false;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((value) => value.trim() !== ''));
}

/**
 * يحوّل نص CSV إلى صفوف مقبولة ومرفوضة. لا يلمس قاعدة البيانات.
 * الأعمدة: `number` إلزامي، و`partId` أو `nameAr` لتحديد القطعة،
 * و`type` اختياري (افتراضه OEM)، و`brand` اختياري.
 */
export function parsePartNumberRows(text) {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], rejected: [], headers: [] };
  const headers = table[0].map((header) => normalizeSpaces(header));
  for (const required of REQUIRED_HEADERS)
    if (!headers.includes(required))
      throw new Error(`CSV must declare a "${required}" column`);
  if (!PART_KEYS.some((key) => headers.includes(key)))
    throw new Error('CSV must declare a "partId" or "nameAr" column');

  const rows = [];
  const rejected = [];
  for (let index = 1; index < table.length; index += 1) {
    const cells = table[index];
    const record = Object.fromEntries(
      headers.map((header, column) => [header, cells[column] ?? '']),
    );
    const lineNumber = index + 1;
    const reason = partNumberRejectionReason(record.number);
    if (reason) {
      rejected.push({
        lineNumber,
        reason,
        raw: normalizeSpaces(record.number),
      });
      continue;
    }
    const partId = normalizeSpaces(record.partId);
    const nameAr = normalizeSpaces(record.nameAr);
    if (!partId && !nameAr) {
      rejected.push({ lineNumber, reason: 'part_reference_missing', raw: '' });
      continue;
    }
    const type = normalizeSpaces(record.type).toUpperCase() || 'OEM';
    if (!PART_NUMBER_TYPES.includes(type)) {
      rejected.push({ lineNumber, reason: 'type_unknown', raw: type });
      continue;
    }
    const brand = normalizeSpaces(record.brand);
    if (brand.length > BRAND_MAX_LENGTH) {
      rejected.push({ lineNumber, reason: 'brand_too_long', raw: brand });
      continue;
    }
    if (brand.length > 0 && hasUnsafeText(brand)) {
      rejected.push({ lineNumber, reason: 'brand_unsafe', raw: brand });
      continue;
    }
    rows.push({
      lineNumber,
      partId: partId || null,
      nameAr: nameAr || null,
      number: normalizePartNumber(record.number),
      type,
      brand: brand || null,
    });
  }
  return { rows, rejected, headers };
}

// الفاصل `|` لا يظهر في أيّ من الأطراف الثلاثة: `partId` معرّف cuid،
// و`number` يمنعه نمط رقم القطعة، و`type` من قائمة مغلقة.
function tripleKey(partId, number, type) {
  return `${partId}|${number}|${type}`;
}

/**
 * يحسب ما يجب إدراجه فعلاً مقابل الصفوف القائمة، فتصير إعادة التشغيل بلا أثر.
 *
 * @param rows صفوف مُحلّلة من `parsePartNumberRows` بعد حلّ `partId`.
 * @param existing صفوف قائمة `{ partId, number, type }` من قاعدة البيانات.
 */
export function planPartNumberImport({ rows, existing }) {
  const present = new Set(
    (existing ?? []).map((entry) =>
      tripleKey(entry.partId, normalizePartNumber(entry.number), entry.type),
    ),
  );
  const planned = new Set();
  const toCreate = [];
  let duplicatesInFile = 0;
  let alreadyPresent = 0;
  for (const row of rows) {
    // يُطبَّع الطرفان: `resolvePart` يطابق بلا حساسية لحالة الأحرف، فصفّ
    // يختلف بالحالة وحدها هو الصفّ نفسه ولا يجوز إدراجه مرة ثانية.
    const number = normalizePartNumber(row.number);
    const key = tripleKey(row.partId, number, row.type);
    if (present.has(key)) {
      alreadyPresent += 1;
      continue;
    }
    if (planned.has(key)) {
      duplicatesInFile += 1;
      continue;
    }
    planned.add(key);
    toCreate.push({
      partId: row.partId,
      number,
      type: row.type,
      brand: row.brand ?? null,
    });
  }
  return { toCreate, alreadyPresent, duplicatesInFile };
}

/**
 * يحذّر من رقم واحد موزّع على أكثر من قطعة: `resolvePart` يعتبره غامضاً
 * ويعيد `FLAGGED`، فالاستيراد الصامت لمثل هذه الصفوف يعيد إنتاج العطل نفسه.
 */
export function ambiguousNumbers({ rows, existing }) {
  const byNumber = new Map();
  for (const entry of [...(existing ?? []), ...rows]) {
    const number = normalizePartNumber(entry.number);
    const parts = byNumber.get(number) ?? new Set();
    parts.add(entry.partId);
    byNumber.set(number, parts);
  }
  return [...byNumber.entries()]
    .filter(([, parts]) => parts.size > 1)
    .map(([number, parts]) => ({ number, partIds: [...parts].sort() }));
}
