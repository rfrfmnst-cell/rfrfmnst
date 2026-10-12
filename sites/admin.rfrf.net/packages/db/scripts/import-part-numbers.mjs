/**
 * استيراد أرقام القطع إلى `PartNumber`.
 *
 * الاستعمال:
 *   node scripts/import-part-numbers.mjs --file part-numbers.csv
 *   node scripts/import-part-numbers.mjs --file part-numbers.csv --apply
 *
 * أعمدة CSV: `number` إلزامي، و`partId` أو `nameAr` لتحديد القطعة،
 * و`type` اختياري (OEM افتراضاً) و`brand` اختياري.
 *
 * ⛔ الوضع الافتراضي جافّ: لا كتابة إلا مع `--apply` صراحةً. المنطق كلّه في
 * `part-number-import-runner.mjs` ليُشغَّل نفسه في الاختبار على قاعدة حقيقية.
 */
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { runPartNumberImport } from './part-number-import-runner.mjs';

function readFlag(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : '';
}

const filePath = readFlag('file');
const apply = process.argv.includes('--apply');
const prisma = new PrismaClient();

async function main() {
  if (!filePath)
    throw new Error(
      'no CSV given. run: node scripts/import-part-numbers.mjs --file <path.csv> [--apply]',
    );
  const text = await readFile(filePath, 'utf8');
  // معاملة واحدة: الخطة تُحسب مقابل الصفوف القائمة داخلها، فلا يتسلّل صفّ بينهما.
  const summary = await prisma.$transaction((tx) =>
    runPartNumberImport({ client: tx, text, apply }),
  );

  console.log(
    JSON.stringify(
      {
        mode: summary.mode,
        parsed: summary.parsed,
        rejected: summary.rejected.length,
        unresolved: summary.unresolved.length,
        alreadyPresent: summary.alreadyPresent,
        duplicatesInFile: summary.duplicatesInFile,
        toCreate: summary.toCreate,
        ambiguousNumbers: summary.ambiguous.length,
        created: summary.created,
      },
      null,
      2,
    ),
  );
  for (const entry of summary.rejected.slice(0, 20))
    console.warn(`rejected line ${entry.lineNumber}: ${entry.reason}`);
  for (const entry of summary.unresolved.slice(0, 20))
    console.warn(`unresolved line ${entry.lineNumber}: ${entry.reason}`);
  for (const entry of summary.ambiguous.slice(0, 20))
    console.warn(
      `ambiguous number ${entry.number} maps to ${entry.partIds.length} parts — resolvePart will FLAG it`,
    );
  if (!apply)
    console.log('dry run: nothing written. re-run with --apply to write.');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
