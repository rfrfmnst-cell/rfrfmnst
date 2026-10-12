import { appendFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import {
  deriveReferenceDatabaseEnvironment,
  exportReferenceDatabaseEnvironment,
} from './reference-database-url.mjs';

const name = process.env.REFERENCE_DATABASE_NAME?.trim() ?? '';
const output = process.env.GITHUB_ENV?.trim() ?? '';
const projectId = process.env.EXPECTED_NEON_PROJECT_ID?.trim() ?? '';
const branchId = process.env.EXPECTED_NEON_BRANCH_ID?.trim() ?? '';
if (
  !/^rafraf_reference_[0-9]+_[0-9]+$/u.test(name) ||
  !output ||
  /[\r\n\0]/u.test(output)
)
  throw new Error('Reference database inputs are invalid');
const prisma = new PrismaClient();
try {
  const [identity] =
    await prisma.$queryRaw`SELECT current_setting('neon.project_id', true) AS project_id, current_setting('neon.branch_id', true) AS branch_id`;
  if (identity?.project_id !== projectId || identity?.branch_id !== branchId)
    throw new Error(
      'Reference database owner is not connected to the exact disposable branch',
    );
  const existing =
    await prisma.$queryRaw`SELECT datname FROM pg_database WHERE datname = ${name}`;
  if (existing.length !== 0)
    throw new Error(
      'Reference database already exists; a fresh workflow attempt is required',
    );
  await prisma.$executeRawUnsafe(
    `CREATE DATABASE "${name}" TEMPLATE template0`,
  );
  const environment = deriveReferenceDatabaseEnvironment(
    process.env.DIRECT_URL ?? process.env.DATABASE_URL,
    name,
  );
  await exportReferenceDatabaseEnvironment(environment, {
    maskWriter: async (value) => process.stdout.write(`::add-mask::${value}\n`),
    environmentWriter: (contents) =>
      appendFile(output, contents, { mode: 0o600 }),
  });
  process.stdout.write(
    'Clean reference database created only on the disposable branch.\n',
  );
} finally {
  await prisma.$disconnect();
}
