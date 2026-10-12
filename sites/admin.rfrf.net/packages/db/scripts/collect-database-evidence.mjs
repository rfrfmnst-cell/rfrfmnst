import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';

const projectId = process.env.EXPECTED_NEON_PROJECT_ID?.trim() ?? '';
const branchId = process.env.EXPECTED_NEON_BRANCH_ID?.trim() ?? '';
const releaseSha = process.env.RELEASE_SHA?.trim() ?? '';
const output = process.env.DATABASE_EVIDENCE_OUTPUT?.trim() ?? '';
const phase = process.argv[2] ?? 'post';

if (!/^[a-z0-9][a-z0-9-]{2,63}$/u.test(projectId)) {
  throw new Error('EXPECTED_NEON_PROJECT_ID is invalid');
}
if (!/^br-[a-z0-9][a-z0-9-]{2,63}$/u.test(branchId)) {
  throw new Error('EXPECTED_NEON_BRANCH_ID is invalid');
}
if (!/^[0-9a-f]{40}$/u.test(releaseSha)) {
  throw new Error('RELEASE_SHA is invalid');
}
if (!output || /[\r\n\0]/u.test(output)) {
  throw new Error('DATABASE_EVIDENCE_OUTPUT is invalid');
}
if (!['pre', 'post', 'recovery'].includes(phase)) {
  throw new Error('Evidence phase must be pre, post, or recovery');
}

const digest = (value) =>
  `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const prisma = new PrismaClient();

try {
  const migrationEntries = await readdir(
    new URL('../prisma/migrations/', import.meta.url),
    { withFileTypes: true },
  );
  const expectedMigrationNames = migrationEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const expectedMigrations = await Promise.all(
    expectedMigrationNames.map(async (name) => ({
      name,
      checksum: createHash('sha256')
        .update(
          await readFile(
            new URL(
              `../prisma/migrations/${name}/migration.sql`,
              import.meta.url,
            ),
          ),
        )
        .digest('hex'),
    })),
  );

  const [identity] = await prisma.$queryRaw`
    SELECT
      current_setting('neon.project_id', true) AS project_id,
      current_setting('neon.branch_id', true) AS branch_id,
      current_database() AS database_name,
      current_user AS database_role
  `;
  if (identity?.project_id !== projectId || identity?.branch_id !== branchId) {
    throw new Error(
      'Database evidence target is not the exact expected Neon branch',
    );
  }

  const migrations = await prisma.$queryRaw`
    SELECT
      migration_name,
      checksum,
      (finished_at IS NULL)::int AS unfinished,
      (rolled_back_at IS NOT NULL)::int AS rolled_back
    FROM "_prisma_migrations"
    ORDER BY migration_name
  `;
  const appliedNames = migrations.map((migration) => migration.migration_name);
  if (appliedNames.some((name) => !expectedMigrationNames.includes(name))) {
    throw new Error(
      'Database contains a migration not committed in this release',
    );
  }
  for (const migration of migrations) {
    const expected = expectedMigrations.find(
      (candidate) => candidate.name === migration.migration_name,
    );
    if (!expected || expected.checksum !== migration.checksum) {
      throw new Error(
        'Database migration checksum does not match the committed SQL',
      );
    }
  }
  if (
    migrations.some(
      (migration) => migration.unfinished || migration.rolled_back,
    )
  ) {
    throw new Error(
      'Database migration catalog contains failed or rolled-back rows',
    );
  }
  if (
    phase === 'post' &&
    JSON.stringify(appliedNames) !== JSON.stringify(expectedMigrationNames)
  ) {
    throw new Error(
      'Database migration catalog is not the exact committed chain',
    );
  }

  const [columns, constraints, indexes] = await Promise.all([
    prisma.$queryRaw`
      SELECT table_name, column_name, ordinal_position, data_type, udt_name,
             is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `,
    prisma.$queryRaw`
      SELECT relation.relname AS table_name, constraint_row.conname,
             constraint_row.contype,
             pg_get_constraintdef(constraint_row.oid, true) AS definition
      FROM pg_constraint AS constraint_row
      JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
      WHERE relation.relnamespace = 'public'::regnamespace
      ORDER BY relation.relname, constraint_row.conname
    `,
    prisma.$queryRaw`
      SELECT tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname
    `,
  ]);
  const tableCount = new Set(columns.map((column) => column.table_name)).size;

  const referenceRoles = await prisma.$queryRaw`
    SELECT name::text AS name FROM roles ORDER BY name::text
  `;
  const expectedReferenceRoles = ['ADMIN', 'CUSTOMER', 'SUPPLIER'];
  if (
    JSON.stringify(referenceRoles.map((role) => role.name)) !==
    JSON.stringify(expectedReferenceRoles)
  ) {
    throw new Error(
      'Database reference roles do not match the application contract',
    );
  }

  let financialConflictCount = null;
  if (phase === 'post') {
    const financialChecks = await prisma.$queryRawUnsafe(`
      SELECT count(*)::int AS count
      FROM (
        SELECT p."id" FROM "payments" AS p
        WHERE p."status" = 'PENDING' AND p."externalRef" IS NULL
        UNION ALL
        SELECT p."orderId" FROM "payments" AS p
        WHERE p."status" IN ('PENDING', 'AUTHORIZED', 'CAPTURED', 'HELD', 'RELEASED')
        GROUP BY p."orderId" HAVING count(*) > 1
        UNION ALL
        SELECT e."id" FROM "escrow_ledger_entries" AS e
        LEFT JOIN "orders" AS o ON o."id" = e."orderId"
        LEFT JOIN "payments" AS p ON p."id" = e."paymentId"
        WHERE e."entryType" = 'HOLD' AND (
          e."orderId" IS NULL OR o."id" IS NULL OR e."paymentId" IS NULL OR
          p."id" IS NULL OR p."orderId" <> o."id" OR p."amount" <> e."amount" OR
          p."currency" <> e."currency" OR o."totalAmount" <> e."amount" OR
          o."currency" <> e."currency"
        )
        UNION ALL
        SELECT p."id" FROM "payments" AS p
        WHERE p."status" IN ('CAPTURED', 'HELD') AND NOT EXISTS (
          SELECT 1 FROM "escrow_ledger_entries" AS e
          WHERE e."paymentId" = p."id" AND e."orderId" = p."orderId"
            AND e."entryType" = 'HOLD' AND e."amount" = p."amount"
            AND e."currency" = p."currency"
        )
        UNION ALL
        SELECT o."id" FROM "orders" AS o
        JOIN "escrow_ledger_entries" AS e
          ON e."orderId" = o."id" AND e."entryType" = 'HOLD'
        JOIN "landed_costs" AS lc ON lc."quoteId" = o."quoteId"
        WHERE lc."currency" <> o."currency" OR e."currency" <> o."currency"
        UNION ALL
        SELECT pr."id" FROM "payment_refunds" AS pr
        JOIN "payments" AS p ON p."id" = pr."paymentId"
        JOIN "orders" AS o ON o."id" = pr."orderId"
        WHERE p."orderId" <> pr."orderId"
           OR pr."amount" <> p."amount"
           OR pr."currency" <> p."currency"
           OR p."currency" <> o."currency"
           OR p."amount" <> o."totalAmount"
        UNION ALL
        SELECT p."id" FROM "payments" AS p
        JOIN "orders" AS o ON o."id" = p."orderId"
        WHERE p."status" = 'REFUNDED' AND NOT EXISTS (
          SELECT 1 FROM "payment_refunds" AS pr
          WHERE pr."paymentId" = p."id" AND pr."orderId" = p."orderId"
            AND pr."status" = 'COMPLETED' AND pr."amount" = p."amount"
            AND pr."currency" = p."currency"
        )
        UNION ALL
        SELECT o."id" FROM "orders" AS o
        WHERE (
          o."status" IN ('COMPLAINT_WINDOW', 'CLOSED', 'PAYOUT_RELEASED')
          AND o."deliveredAt" IS NULL
        ) OR (
          o."customerConfirmedAt" IS NOT NULL
          AND (o."deliveredAt" IS NULL OR o."customerConfirmedAt" < o."deliveredAt")
        )
        UNION ALL
        SELECT sp."orderId" FROM "supplier_payouts" AS sp
        WHERE sp."orderId" IS NOT NULL AND sp."status" <> 'CANCELLED'
        GROUP BY sp."orderId" HAVING count(*) > 1
        UNION ALL
        SELECT pr."externalRef" FROM "payment_refunds" AS pr
        WHERE pr."externalRef" IS NOT NULL
        GROUP BY pr."externalRef" HAVING count(*) > 1
        UNION ALL
        SELECT upper(btrim(sp."reference")) FROM "supplier_payouts" AS sp
        WHERE sp."reference" IS NOT NULL
        GROUP BY upper(btrim(sp."reference")) HAVING count(*) > 1
        UNION ALL
        SELECT sp."id" FROM "supplier_payouts" AS sp
        JOIN "orders" AS o ON o."id" = sp."orderId"
        JOIN "landed_costs" AS lc ON lc."quoteId" = o."quoteId"
        WHERE sp."status" <> 'CANCELLED' AND (
          sp."supplierId" <> o."supplierId" OR
          sp."amount" <> lc."supplierPrice" OR
          sp."currency" <> o."currency" OR
          lc."currency" <> o."currency"
        )
        UNION ALL
        SELECT o."id" FROM "orders" AS o
        WHERE o."status" = 'PAYOUT_RELEASED' AND (
          1 <> (SELECT count(*) FROM "escrow_ledger_entries" AS e
                WHERE e."orderId" = o."id" AND e."entryType" = 'HOLD') OR
          1 <> (SELECT count(*) FROM "escrow_ledger_entries" AS e
                WHERE e."orderId" = o."id" AND e."entryType" = 'RELEASE') OR
          1 <> (SELECT count(*) FROM "escrow_ledger_entries" AS e
                WHERE e."orderId" = o."id" AND e."entryType" = 'PAYOUT') OR
          1 <> (SELECT count(*) FROM "supplier_payouts" AS sp
                WHERE sp."orderId" = o."id" AND sp."status" <> 'CANCELLED')
        )
        UNION ALL
        SELECT o."id" FROM "orders" AS o
        WHERE o."status" = 'DISPUTED' AND NOT EXISTS (
          SELECT 1 FROM "disputes" AS d
          WHERE d."orderId" = o."id" AND d."status" IN ('OPEN', 'UNDER_REVIEW')
        )
      ) AS conflicts
    `);
    financialConflictCount = financialChecks[0]?.count;
    if (financialConflictCount !== 0) {
      throw new Error(
        'Database financial preflight found release-blocking conflicts',
      );
    }
  }

  const [runtime] = await prisma.$queryRaw`
    SELECT
      rolname,
      rolsuper,
      rolcreatedb,
      rolcreaterole,
      rolinherit,
      rolbypassrls,
      rolcanlogin
    FROM pg_roles
    WHERE rolname = 'rafraf_app'
  `;
  const [runtimeCatalog] = await prisma.$queryRaw`
    SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rafraf_app')
      THEN has_table_privilege('rafraf_app', '"_prisma_migrations"', 'INSERT,UPDATE,DELETE')
      ELSE true
    END AS writable
  `;
  const [runtimeOwnership] = await prisma.$queryRaw`
    SELECT count(*)::int AS count
    FROM pg_class AS relation
    JOIN pg_roles AS owner ON owner.oid = relation.relowner
    WHERE owner.rolname = 'rafraf_app'
      AND relation.relnamespace = 'public'::regnamespace
  `;
  const runtimeRoleVerified = Boolean(
    runtime?.rolcanlogin &&
    !runtime.rolsuper &&
    !runtime.rolcreatedb &&
    !runtime.rolcreaterole &&
    !runtime.rolinherit &&
    !runtime.rolbypassrls &&
    !runtimeCatalog?.writable &&
    runtimeOwnership?.count === 0,
  );
  if (phase === 'post' && !runtimeRoleVerified) {
    throw new Error('Least-privilege runtime role evidence is incomplete');
  }

  const evidence = {
    schemaVersion: 'rafraf-database-snapshot-v1',
    phase,
    generatedAt: new Date().toISOString(),
    releaseSha,
    projectId,
    branchId,
    databaseName: identity.database_name,
    migrationCount: migrations.length,
    expectedMigrationCount: expectedMigrations.length,
    failedMigrationCount: 0,
    rolledBackMigrationCount: 0,
    expectedMigrations,
    appliedMigrations: migrations.map(({ migration_name, checksum }) => ({
      name: migration_name,
      checksum,
    })),
    migrationCatalogFingerprint: digest(
      migrations.map(({ migration_name, checksum }) => ({
        name: migration_name,
        checksum,
      })),
    ),
    schemaFingerprint: digest({ columns, constraints, indexes }),
    tableCount,
    referenceRoles: expectedReferenceRoles,
    runtimeRoleVerified,
    financialConflictCount,
  };
  await writeFile(output, `${JSON.stringify(evidence)}\n`, { mode: 0o600 });
  process.stdout.write(
    'Redacted database evidence written for the exact Neon branch.\n',
  );
} finally {
  await prisma.$disconnect();
}
