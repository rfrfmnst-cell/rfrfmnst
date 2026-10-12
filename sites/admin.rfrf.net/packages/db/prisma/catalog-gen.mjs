/**
 * مولّد كتالوج الإطلاق — يطبع SQL (idempotent) إلى stdout.
 * بيانات هيكلية صادقة: أسماء قطع عربية دقيقة + فئات + توافقات طرازات سعودية
 * شائعة، source=INTERNAL بثقة 0.7 وبلا أرقام OEM مخترعة (تُدخل عند التحقق
 * اليدوي فترتفع الثقة). القطع الحساسة موسومة sensitivity/requiresOem.
 *
 * تشغيل: node prisma/catalog-gen.mjs > catalog.sql
 */

import { createHash } from 'node:crypto';

const esc = (s) => s.replaceAll("'", "''");
// معرّف حتمي (idempotent) يحترم العربية — hash ثابت للاسم الكامل
const id = (p, s) =>
  p + '_' + createHash('md5').update(s).digest('hex').slice(0, 20);

const CATEGORIES = [
  ['brakes', 'نظام الفرامل', 'MEDIUM'],
  ['filters', 'الفلاتر', 'LOW'],
  ['suspension', 'نظام التعليق', 'LOW'],
  ['engine-cooling', 'التبريد', 'LOW'],
  ['electrical', 'الكهرباء', 'MEDIUM'],
  ['engine-parts', 'أجزاء المحرك', 'MEDIUM'],
  ['ac', 'التكييف', 'LOW'],
  ['body', 'قطع الهيكل', 'LOW'],
];

// [الاسم، الفئة، sensitivity?، requiresOem?]
const PARTS = [
  ['فحمات فرامل أمامية', 'brakes', 'MEDIUM'],
  ['فحمات فرامل خلفية', 'brakes', 'MEDIUM'],
  ['هوب (ديسك) فرامل أمامي', 'brakes', 'MEDIUM'],
  ['هوب (ديسك) فرامل خلفي', 'brakes', 'MEDIUM'],
  ['فلتر زيت المحرك', 'filters'],
  ['فلتر هواء المحرك', 'filters'],
  ['فلتر مكيف (كبينة)', 'filters'],
  ['فلتر بنزين', 'filters'],
  ['مساعد أمامي يمين', 'suspension'],
  ['مساعد أمامي يسار', 'suspension'],
  ['مساعد خلفي', 'suspension'],
  ['كرسي مساعد أمامي', 'suspension'],
  ['جلدة مقص سفلي', 'suspension'],
  ['كوبلن (رأس عكس) داخلي', 'suspension'],
  ['كوبلن (رأس عكس) خارجي', 'suspension'],
  ['بيضة مقص سفلية', 'suspension'],
  ['ردياتير (مشع ماء)', 'engine-cooling'],
  ['مروحة ردياتير', 'engine-cooling'],
  ['طرمبة ماء', 'engine-cooling'],
  ['ثيرموستات حرارة', 'engine-cooling'],
  ['خرطوم ردياتير علوي', 'engine-cooling'],
  ['بطارية 70 أمبير', 'electrical', 'MEDIUM'],
  ['دينمو (مولد كهرباء)', 'electrical', 'MEDIUM', true],
  ['سلف (مارش) تشغيل', 'electrical', 'MEDIUM', true],
  ['بواجي (شمعات إشعال) طقم', 'engine-parts'],
  ['كويل إشعال', 'engine-parts', 'MEDIUM'],
  ['سير مكينة (حزام)', 'engine-parts'],
  ['حساس أكسجين أمامي', 'engine-parts', 'MEDIUM', true],
  ['كمبروسر مكيف', 'ac', 'MEDIUM', true],
  ['مكثف مكيف (كوندنسر)', 'ac'],
  ['فاصمة (صدام) أمامي', 'body'],
  ['شمعة (فانوس) أمامي يمين', 'body'],
  ['شمعة (فانوس) أمامي يسار', 'body'],
  ['مرآة جانبية يمين', 'body'],
];

// الطرازات: [ماركة، موديل، من، إلى]
const VEHICLES = [
  ['تويوتا', 'كامري', 2012, 2024],
  ['تويوتا', 'كورولا', 2014, 2024],
  ['تويوتا', 'هايلكس', 2012, 2024],
  ['تويوتا', 'لاندكروزر', 2010, 2021],
  ['تويوتا', 'يارس', 2014, 2023],
  ['هيونداي', 'سوناتا', 2015, 2024],
  ['هيونداي', 'النترا', 2016, 2024],
  ['هيونداي', 'أكسنت', 2015, 2023],
  ['هيونداي', 'توسان', 2016, 2024],
  ['نيسان', 'باترول', 2010, 2023],
  ['نيسان', 'التيما', 2013, 2023],
  ['نيسان', 'صني', 2013, 2023],
  ['كيا', 'سبورتاج', 2016, 2024],
  ['كيا', 'سيراتو', 2014, 2023],
  ['شانجان', 'CS75', 2018, 2024],
];

let out = [];
out.push('-- كتالوج الإطلاق (مولَّد) — مسودات INTERNAL تحتاج تحقّقاً يدوياً');
out.push('BEGIN;');

const catId = (slug) => 'cat_' + slug; // slug لاتيني ثابت — معرف مباشر

for (const [slug, nameAr, sens = 'LOW'] of CATEGORIES) {
  const cid = catId(slug);
  out.push(
    `INSERT INTO part_categories (id, slug, "nameAr", sensitivity) VALUES ('${cid}','${slug}','${esc(nameAr)}','${sens}') ON CONFLICT (slug) DO NOTHING;`,
  );
}

for (const [nameAr, catSlug, sens = 'LOW', requiresOem = false] of PARTS) {
  const pid = id('part', catSlug + '-' + nameAr);
  const cid = catId(catSlug);
  out.push(
    `INSERT INTO parts (id, "categoryId", "nameAr", sensitivity, "requiresOem", "updatedAt") VALUES ('${pid}','${cid}','${esc(nameAr)}','${sens}',${requiresOem},now()) ON CONFLICT (id) DO NOTHING;`,
  );
  for (const [make, model, from, to] of VEHICLES) {
    const compatId = id('fit', pid + '-' + make + model);
    out.push(
      `INSERT INTO part_compatibilities (id, "partId", make, model, "yearFrom", "yearTo", confidence, source, notes, "updatedAt") VALUES ('${compatId}','${pid}','${esc(make)}','${esc(model)}',${from},${to},0.7,'INTERNAL','مسودة إطلاق — تحتاج تحقق يدوي/OEM',now()) ON CONFLICT (id) DO NOTHING;`,
    );
  }
}

out.push('COMMIT;');
console.log(out.join('\n'));
console.error(
  `catalog: ${CATEGORIES.length} فئات، ${PARTS.length} قطعة، ${PARTS.length * VEHICLES.length} توافق`,
);
