import { PrismaClient } from '@prisma/client';
import {
  RUNTIME_TABLE_PRIVILEGES,
  validateRuntimePrivilegeSnapshot,
} from './runtime-privilege-contract.mjs';

const role = process.env.DATABASE_RUNTIME_ROLE?.trim() ?? '';
const password = process.env.DATABASE_RUNTIME_PASSWORD ?? '';
if (!/^[a-z][a-z0-9_]{2,31}$/u.test(role))
  throw new Error(
    'DATABASE_RUNTIME_ROLE must be a simple lowercase PostgreSQL role',
  );
if (password.length < 32 || /[\r\n\0]/u.test(password))
  throw new Error(
    'DATABASE_RUNTIME_PASSWORD must be at least 32 safe characters',
  );

const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const identifier = (value) => `"${value.replaceAll('"', '""')}"`;
const prisma = new PrismaClient();

async function snapshot() {
  const [identity] = await prisma.$queryRaw`
    SELECT rolname AS role, rolsuper AS superuser, rolcreatedb AS "createDb",
      rolcreaterole AS "createRole", rolinherit AS inherit,
      rolbypassrls AS "bypassRls" FROM pg_roles WHERE rolname = ${role}
  `;
  const memberships = await prisma.$queryRaw`
    SELECT granted.rolname AS name FROM pg_auth_members AS membership
    JOIN pg_roles AS member ON member.oid = membership.member
    JOIN pg_roles AS granted ON granted.oid = membership.roleid
    WHERE member.rolname = ${role} ORDER BY granted.rolname
  `;
  const ownedObjects = await prisma.$queryRaw`
    SELECT format('%I.%I', namespace.nspname, relation.relname) AS name
    FROM pg_class AS relation JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles AS owner ON owner.oid = relation.relowner
    WHERE owner.rolname = ${role} ORDER BY name
  `;
  const executablePublicFunctions = await prisma.$queryRaw`
    SELECT routine.oid::regprocedure::text AS name FROM pg_proc AS routine
    WHERE routine.pronamespace = 'public'::regnamespace
      AND has_function_privilege(${role}, routine.oid, 'EXECUTE') ORDER BY name
  `;
  const tablePrivileges = {};
  for (const table of Object.keys(RUNTIME_TABLE_PRIVILEGES).sort()) {
    const rows = await prisma.$queryRaw`
      SELECT privilege_type AS privilege FROM information_schema.role_table_grants
      WHERE grantee = ${role} AND table_schema = 'public' AND table_name = ${table}
      ORDER BY CASE privilege_type WHEN 'SELECT' THEN 1 WHEN 'INSERT' THEN 2 WHEN 'UPDATE' THEN 3 WHEN 'DELETE' THEN 4 ELSE 9 END
    `;
    tablePrivileges[table] = rows.map(({ privilege }) => privilege);
  }
  const [scope] = await prisma.$queryRaw`
    SELECT has_database_privilege(${role}, current_database(), 'CREATE') AS "databaseCreate",
      has_schema_privilege(${role}, 'public', 'CREATE') AS "schemaCreate"
  `;
  return {
    ...identity,
    memberships: memberships.map(({ name }) => name),
    ownedObjects: ownedObjects.map(({ name }) => name),
    executablePublicFunctions: executablePublicFunctions.map(
      ({ name }) => name,
    ),
    tablePrivileges,
    ...scope,
  };
}

try {
  await prisma.$executeRawUnsafe(`
    DO $provision$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(role)}) THEN
        EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD %L', ${literal(role)}, ${literal(password)});
      ELSE
        -- Neon project owners can rotate roles they administer, but they are not
        -- PostgreSQL superusers and therefore cannot alter the SUPERUSER or
        -- BYPASSRLS attributes. The validated snapshot below still fails closed
        -- if any reviewed least-privilege attribute has drifted.
        EXECUTE format('ALTER ROLE %I LOGIN PASSWORD %L', ${literal(role)}, ${literal(password)});
      END IF;
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), ${literal(role)});
      EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', ${literal(role)});
      EXECUTE format('REVOKE CREATE ON SCHEMA public FROM %I', ${literal(role)});
      EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I', ${literal(role)});
      EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I', ${literal(role)});
      EXECUTE format('REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM %I', ${literal(role)});
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', ${literal(role)});
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', ${literal(role)});
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', ${literal(role)});
    END
    $provision$;
  `);
  const actualTables = await prisma.$queryRaw`
    SELECT table_name AS name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name
  `;
  const expectedTables = Object.keys(RUNTIME_TABLE_PRIVILEGES).sort();
  if (
    JSON.stringify(actualTables.map(({ name }) => name)) !==
    JSON.stringify(expectedTables)
  )
    throw new Error(
      'Database tables do not match the reviewed runtime privilege matrix',
    );
  const sequences =
    await prisma.$queryRaw`SELECT sequence_name AS name FROM information_schema.sequences WHERE sequence_schema = 'public'`;
  if (sequences.length !== 0)
    throw new Error(
      'Unreviewed public sequences require an explicit privilege decision',
    );
  for (const [table, privileges] of Object.entries(RUNTIME_TABLE_PRIVILEGES)) {
    await prisma.$executeRawUnsafe(
      `GRANT ${privileges.join(', ')} ON TABLE public.${identifier(table)} TO ${identifier(role)}`,
    );
  }
  validateRuntimePrivilegeSnapshot(await snapshot());
  process.stdout.write(
    `Runtime database role ${role} provisioned from the reviewed matrix.\n`,
  );
} finally {
  await prisma.$disconnect();
}
