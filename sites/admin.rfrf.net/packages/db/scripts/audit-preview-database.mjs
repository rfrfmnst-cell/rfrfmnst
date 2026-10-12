import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  const [identity] = await prisma.$queryRaw`
    SELECT
      current_database() AS database_name,
      current_user AS database_role,
      current_setting('neon.project_id', true) AS neon_project_id,
      current_setting('neon.branch_id', true) AS neon_branch_id
  `;
  const tables = await prisma.$queryRaw`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;
  const authColumns = await prisma.$queryRaw`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name IN ('emailNormalized', 'googleSubject')
    ORDER BY column_name
  `;
  const [catalog] = await prisma.$queryRaw`
    SELECT to_regclass('public."_prisma_migrations"') IS NOT NULL AS present
  `;

  const expectedBranchId = process.env.EXPECTED_NEON_BRANCH_ID?.trim();
  if (expectedBranchId && identity?.neon_branch_id !== expectedBranchId) {
    throw new Error('Preview database branch identity mismatch.');
  }

  console.log(
    JSON.stringify({
      identity,
      tableCount: tables.length,
      rafrafCoreTables: tables
        .map((row) => row.table_name)
        .filter((name) =>
          ['customers', 'orders', 'payments', 'rfqs', 'users'].includes(name),
        ),
      authColumns: authColumns.map((row) => row.column_name),
      prismaMigrationCatalog: catalog?.present === true,
    }),
  );
} finally {
  await prisma.$disconnect();
}
