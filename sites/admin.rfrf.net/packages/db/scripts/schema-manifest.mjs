import { createHash } from 'node:crypto';

const SECTIONS = [
  'tables',
  'columns',
  'constraints',
  'indexes',
  'enums',
  'sequences',
  'views',
  'functions',
  'triggers',
  'policies',
  'databaseSecurity',
  'schemaSecurity',
  'relationSecurity',
  'functionSecurity',
  'defaultPrivileges',
  'roleExposure',
];

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return typeof value === 'string'
    ? value.replaceAll(/\s+/gu, ' ').trim()
    : value;
};

const encoded = (value) => JSON.stringify(value);

export function normalizeSchemaManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Schema manifest must be an object');
  }
  const actual = Object.keys(value).sort();
  const expected = [...SECTIONS].sort();
  if (encoded(actual) !== encoded(expected)) {
    throw new Error('Schema manifest sections are incomplete');
  }
  return Object.fromEntries(
    SECTIONS.map((section) => {
      if (!Array.isArray(value[section])) {
        throw new Error(`Schema manifest ${section} must be an array`);
      }
      const rows = value[section]
        .map(canonical)
        .sort((left, right) => encoded(left).localeCompare(encoded(right)));
      return [section, rows];
    }),
  );
}

export function fingerprintSchemaManifest(value) {
  const normalized = normalizeSchemaManifest(value);
  return `sha256:${createHash('sha256').update(encoded(normalized)).digest('hex')}`;
}

export function compareSchemaManifests(expectedValue, actualValue) {
  const expected = normalizeSchemaManifest(expectedValue);
  const actual = normalizeSchemaManifest(actualValue);
  const differences = SECTIONS.filter(
    (section) => encoded(expected[section]) !== encoded(actual[section]),
  ).map((section) => `${section} differs from canonical migrations`);
  return {
    expectedFingerprint: fingerprintSchemaManifest(expected),
    actualFingerprint: fingerprintSchemaManifest(actual),
    driftCount: differences.length,
    differences,
  };
}
