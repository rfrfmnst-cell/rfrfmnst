import { readFile, writeFile } from 'node:fs/promises';
import { compareSchemaManifests } from './schema-manifest.mjs';

const expectedPath = process.env.EXPECTED_SCHEMA_MANIFEST?.trim() ?? '';
const actualPath = process.env.ACTUAL_SCHEMA_MANIFEST?.trim() ?? '';
const output = process.env.SCHEMA_DRIFT_OUTPUT?.trim() ?? '';
if (
  [expectedPath, actualPath, output].some(
    (value) => !value || /[\r\n\0]/u.test(value),
  )
)
  throw new Error('Schema comparison paths are invalid');
const expected = JSON.parse(await readFile(expectedPath, 'utf8'));
const actual = JSON.parse(await readFile(actualPath, 'utf8'));
const result = compareSchemaManifests(expected.manifest, actual.manifest);
if (
  result.expectedFingerprint !== expected.fingerprint ||
  result.actualFingerprint !== actual.fingerprint ||
  result.driftCount !== 0
)
  throw new Error(
    `Canonical schema drift detected (${result.driftCount} sections)`,
  );
await writeFile(
  output,
  `${JSON.stringify({ schemaVersion: 'rafraf-schema-drift-v2', ...result })}\n`,
  { mode: 0o600 },
);
process.stdout.write(
  'Actual schema exactly matches the clean migration-built reference database.\n',
);
