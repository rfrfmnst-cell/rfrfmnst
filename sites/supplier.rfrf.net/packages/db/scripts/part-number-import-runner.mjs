/**
 * مشغّل استيراد أرقام القطع — المنطق الذي يلمس قاعدة البيانات، بعميل محقون.
 *
 * لماذا هو منفصل عن الـCLI: الاختبار يشغّل **هذا المسار نفسه** على قاعدة
 * اختبار داخل معاملة تُلغى، فيثبت أن `--dry-run` لا يكتب وأن إعادة التشغيل
 * لا تُدرج شيئاً — بدل الاكتفاء بقراءة شكل الملف.
 *
 * العميل (`client`) أي واجهة Prisma: العميل الجذر أو `tx` داخل معاملة. لذلك
 * **لا يفتح هذا الملف معاملة**؛ الذرّية مسؤولية المستدعي (الـCLI يلفّه بـ
 * `$transaction`، والاختبار يمرّر `tx` قائمة).
 */
import {
  ambiguousNumbers,
  parsePartNumberRows,
  planPartNumberImport,
} from './part-number-import-contract.mjs';

/** يحوّل مرجع القطعة إلى معرّف: `partId` مباشرة، أو `nameAr` باسم فريد. */
export async function resolvePartIds(client, rows) {
  const names = [
    ...new Set(rows.filter((row) => !row.partId).map((row) => row.nameAr)),
  ];
  const byName = new Map();
  if (names.length > 0) {
    const parts = await client.part.findMany({
      where: { nameAr: { in: names } },
      select: { id: true, nameAr: true },
    });
    for (const part of parts) {
      const bucket = byName.get(part.nameAr) ?? [];
      bucket.push(part.id);
      byName.set(part.nameAr, bucket);
    }
  }
  const declaredIds = rows.flatMap((row) => (row.partId ? [row.partId] : []));
  const knownIds = new Set(
    declaredIds.length === 0
      ? []
      : (
          await client.part.findMany({
            where: { id: { in: declaredIds } },
            select: { id: true },
          })
        ).map((part) => part.id),
  );

  const resolved = [];
  const unresolved = [];
  for (const row of rows) {
    if (row.partId) {
      if (knownIds.has(row.partId)) resolved.push(row);
      else unresolved.push({ ...row, reason: 'part_id_unknown' });
      continue;
    }
    const candidates = byName.get(row.nameAr) ?? [];
    if (candidates.length === 1)
      resolved.push({ ...row, partId: candidates[0] });
    else
      unresolved.push({
        ...row,
        reason:
          candidates.length === 0 ? 'part_name_unknown' : 'part_name_ambiguous',
      });
  }
  return { resolved, unresolved };
}

/**
 * يحلّل ملف CSV ويحسب الخطة، ولا يكتب إلا عند `apply === true`.
 *
 * @returns ملخّص عددي + الصفوف المرفوضة وغير المحلولة والأرقام الغامضة.
 */
export async function runPartNumberImport({ client, text, apply = false }) {
  const { rows, rejected } = parsePartNumberRows(text);
  const { resolved, unresolved } = await resolvePartIds(client, rows);
  const existing =
    resolved.length === 0
      ? []
      : await client.partNumber.findMany({
          where: {
            number: { in: [...new Set(resolved.map((row) => row.number))] },
          },
          select: { partId: true, number: true, type: true },
        });
  const plan = planPartNumberImport({ rows: resolved, existing });
  const ambiguous = ambiguousNumbers({ rows: resolved, existing });
  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    parsed: rows.length,
    rejected,
    unresolved,
    ambiguous,
    alreadyPresent: plan.alreadyPresent,
    duplicatesInFile: plan.duplicatesInFile,
    toCreate: plan.toCreate.length,
    created: 0,
  };
  // الكتابة الوحيدة في الأداة كلها، وهي خلف `apply` حصراً.
  if (!apply || plan.toCreate.length === 0) return summary;
  const written = await client.partNumber.createMany({ data: plan.toCreate });
  summary.created = written.count;
  return summary;
}
