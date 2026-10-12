import { writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import {
  APPEND_ONLY_TABLES,
  DELETE_ALLOWED_TABLES,
  FINANCIAL_DELETE_DENIED_TABLES,
  RUNTIME_TABLE_PRIVILEGES,
  isPostgresPermissionDenied,
  validateRuntimePrivilegeSnapshot,
} from './runtime-privilege-contract.mjs';

const role = process.env.DATABASE_RUNTIME_ROLE?.trim() ?? '';
const output = process.env.RUNTIME_EVIDENCE_OUTPUT?.trim() ?? '';
if (!/^[a-z][a-z0-9_]{2,31}$/u.test(role))
  throw new Error('DATABASE_RUNTIME_ROLE is invalid');
if (output && /[\r\n\0]/u.test(output))
  throw new Error('RUNTIME_EVIDENCE_OUTPUT is invalid');
const prisma = new PrismaClient();
const denied = async (label, operation) => {
  try {
    await operation();
  } catch (error) {
    if (isPostgresPermissionDenied(error)) return label;
    throw error;
  }
  throw new Error(`${label} unexpectedly succeeded`);
};

try {
  const [identity] = await prisma.$queryRaw`
    SELECT rolname AS role, rolsuper AS superuser, rolcreatedb AS "createDb",
      rolcreaterole AS "createRole", rolinherit AS inherit,
      rolbypassrls AS "bypassRls" FROM pg_roles WHERE rolname = current_user
  `;
  const memberships = await prisma.$queryRaw`
    SELECT granted.rolname AS name FROM pg_auth_members AS membership
    JOIN pg_roles AS granted ON granted.oid = membership.roleid
    WHERE membership.member = current_user::regrole ORDER BY name
  `;
  const ownedObjects = await prisma.$queryRaw`
    SELECT relation.oid::regclass::text AS name FROM pg_class AS relation
    WHERE relation.relowner = current_user::regrole ORDER BY name
  `;
  const executablePublicFunctions = await prisma.$queryRaw`
    SELECT routine.oid::regprocedure::text AS name FROM pg_proc AS routine
    WHERE routine.pronamespace = 'public'::regnamespace
      AND has_function_privilege(current_user, routine.oid, 'EXECUTE') ORDER BY name
  `;
  const [scope] = await prisma.$queryRaw`
    SELECT has_database_privilege(current_user, current_database(), 'CREATE') AS "databaseCreate",
      has_schema_privilege(current_user, 'public', 'CREATE') AS "schemaCreate"
  `;
  const tablePrivileges = {};
  for (const table of Object.keys(RUNTIME_TABLE_PRIVILEGES).sort()) {
    const rows = await prisma.$queryRaw`
      SELECT privilege_type AS privilege FROM information_schema.role_table_grants
      WHERE grantee = current_user AND table_schema = 'public' AND table_name = ${table}
      ORDER BY CASE privilege_type WHEN 'SELECT' THEN 1 WHEN 'INSERT' THEN 2 WHEN 'UPDATE' THEN 3 WHEN 'DELETE' THEN 4 ELSE 9 END
    `;
    tablePrivileges[table] = rows.map(({ privilege }) => privilege);
  }
  validateRuntimePrivilegeSnapshot({
    ...identity,
    memberships: memberships.map(({ name }) => name),
    ownedObjects: ownedObjects.map(({ name }) => name),
    executablePublicFunctions: executablePublicFunctions.map(
      ({ name }) => name,
    ),
    tablePrivileges,
    ...scope,
  });

  const fixtureId = `rehearsal-runtime-${process.pid}-${Date.now()}`;
  let rolledBack = false;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.adminMfaVerificationAttempt.create({
        data: {
          id: fixtureId,
          challengeKey: fixtureId,
          userId: fixtureId,
          sequence: 1,
        },
      });
      const created = await tx.adminMfaVerificationAttempt.findUniqueOrThrow({
        where: { id: fixtureId },
      });
      if (created.status !== 'IN_FLIGHT')
        throw new Error('runtime create/read fixture failed');
      await tx.adminMfaVerificationAttempt.update({
        where: { id: fixtureId },
        data: { status: 'INVALID' },
      });
      throw new Error('RUNTIME_ROLLBACK_SENTINEL');
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'RUNTIME_ROLLBACK_SENTINEL')
      rolledBack = true;
    else throw error;
  }
  const persistentRows = await prisma.adminMfaVerificationAttempt.count({
    where: { id: fixtureId },
  });
  if (!rolledBack || persistentRows !== 0)
    throw new Error('runtime synthetic transaction did not roll back cleanly');

  const denials = [];
  const allowedDeleteChecks = [];
  for (const table of DELETE_ALLOWED_TABLES) {
    const quoted = `"${table.replaceAll('"', '""')}"`;
    await prisma.$executeRawUnsafe(`DELETE FROM public.${quoted} WHERE false`);
    allowedDeleteChecks.push(table);
  }
  for (const table of APPEND_ONLY_TABLES) {
    const quoted = `"${table.replaceAll('"', '""')}"`;
    denials.push(
      await denied(`append-only-update:${table}`, () =>
        prisma.$executeRawUnsafe(
          `UPDATE public.${quoted} SET id = id WHERE false`,
        ),
      ),
    );
    denials.push(
      await denied(`append-only-delete:${table}`, () =>
        prisma.$executeRawUnsafe(`DELETE FROM public.${quoted} WHERE false`),
      ),
    );
  }
  for (const table of FINANCIAL_DELETE_DENIED_TABLES) {
    const quoted = `"${table.replaceAll('"', '""')}"`;
    if (APPEND_ONLY_TABLES.includes(table)) continue;
    denials.push(
      await denied(`forbidden-delete:${table}`, () =>
        prisma.$executeRawUnsafe(`DELETE FROM public.${quoted} WHERE false`),
      ),
    );
  }
  denials.push(
    await denied('migration-catalog-dml', () =>
      prisma.$executeRawUnsafe(
        'UPDATE public."_prisma_migrations" SET checksum = checksum WHERE false',
      ),
    ),
  );
  denials.push(
    await denied('public-ddl', () =>
      prisma.$transaction((tx) =>
        tx.$executeRawUnsafe(
          'CREATE TABLE public.rafraf_forbidden_runtime_table (id int)',
        ),
      ),
    ),
  );
  denials.push(
    await denied('schema-create', () =>
      prisma.$transaction((tx) =>
        tx.$executeRawUnsafe('CREATE SCHEMA rafraf_forbidden_runtime_schema'),
      ),
    ),
  );
  denials.push(
    await denied('role-create', () =>
      prisma.$transaction((tx) =>
        tx.$executeRawUnsafe('CREATE ROLE rafraf_forbidden_runtime_role'),
      ),
    ),
  );
  const evidence = {
    schemaVersion: 'rafraf-runtime-rehearsal-v3',
    role,
    allowedCrudVerified: true,
    transactionRollbackVerified: rolledBack,
    persistentRows,
    denials,
    allowedDeleteChecks,
    membershipCount: memberships.length,
    ownedObjectCount: ownedObjects.length,
    executablePublicFunctionCount: executablePublicFunctions.length,
  };
  if (output)
    await writeFile(output, `${JSON.stringify(evidence)}\n`, { mode: 0o600 });
  process.stdout.write(
    `Runtime connection ${role} passed synthetic CRUD, rollback, and denial checks.\n`,
  );
} finally {
  await prisma.$disconnect();
}
