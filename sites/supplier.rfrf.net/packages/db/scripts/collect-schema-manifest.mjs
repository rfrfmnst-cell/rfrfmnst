import { writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import {
  fingerprintSchemaManifest,
  normalizeSchemaManifest,
} from './schema-manifest.mjs';

const output = process.env.SCHEMA_MANIFEST_OUTPUT?.trim() ?? '';
if (!output || /[\r\n\0]/u.test(output))
  throw new Error('SCHEMA_MANIFEST_OUTPUT is invalid');
const prisma = new PrismaClient();

try {
  const [
    tables,
    columns,
    constraints,
    indexes,
    enums,
    sequences,
    views,
    functions,
    triggers,
    policies,
    databaseSecurity,
    schemaSecurity,
    relationSecurity,
    functionSecurity,
    defaultPrivileges,
    roleExposure,
  ] = await Promise.all([
    prisma.$queryRaw`SELECT table_name AS name, table_type AS type FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    prisma.$queryRaw`SELECT table_name AS table, column_name AS name, ordinal_position AS ordinal, data_type AS type, udt_name AS "udtName", is_nullable AS nullable, column_default AS "default" FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`,
    prisma.$queryRaw`SELECT relation.relname AS table, constraint_row.conname AS name, constraint_row.contype AS type, pg_get_constraintdef(constraint_row.oid, true) AS definition FROM pg_constraint AS constraint_row JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid WHERE relation.relnamespace = 'public'::regnamespace ORDER BY relation.relname, constraint_row.conname`,
    prisma.$queryRaw`SELECT tablename AS table, indexname AS name, indexdef AS definition FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname`,
    prisma.$queryRaw`SELECT type.typname AS type, enum.enumlabel AS value, enum.enumsortorder::text AS ordinal FROM pg_type AS type JOIN pg_enum AS enum ON enum.enumtypid = type.oid WHERE type.typnamespace = 'public'::regnamespace ORDER BY type.typname, enum.enumsortorder`,
    prisma.$queryRaw`SELECT sequencename AS name, data_type AS type, start_value::text AS start, min_value::text AS min, max_value::text AS max, increment_by::text AS increment, cycle FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename`,
    prisma.$queryRaw`SELECT table_name AS name, view_definition AS definition FROM information_schema.views WHERE table_schema = 'public' ORDER BY table_name`,
    prisma.$queryRaw`SELECT routine.oid::regprocedure::text AS name, pg_get_functiondef(routine.oid) AS definition FROM pg_proc AS routine WHERE routine.pronamespace = 'public'::regnamespace ORDER BY name`,
    prisma.$queryRaw`SELECT relation.relname AS table, trigger.tgname AS name, pg_get_triggerdef(trigger.oid, true) AS definition FROM pg_trigger AS trigger JOIN pg_class AS relation ON relation.oid = trigger.tgrelid WHERE relation.relnamespace = 'public'::regnamespace AND NOT trigger.tgisinternal ORDER BY relation.relname, trigger.tgname`,
    prisma.$queryRaw`SELECT tablename AS table, policyname AS name, permissive, roles::text, cmd, qual, with_check AS "withCheck" FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname`,
    prisma.$queryRaw`
      SELECT owner.rolname AS owner,
        ARRAY(SELECT entry::text FROM unnest(COALESCE(database.datacl, acldefault('d', database.datdba))) AS entry ORDER BY entry::text) AS acl
      FROM pg_database AS database JOIN pg_roles AS owner ON owner.oid = database.datdba
      WHERE database.datname = current_database()`,
    prisma.$queryRaw`
      SELECT namespace.nspname AS name, owner.rolname AS owner,
        ARRAY(SELECT entry::text FROM unnest(COALESCE(namespace.nspacl, acldefault('n', namespace.nspowner))) AS entry ORDER BY entry::text) AS acl
      FROM pg_namespace AS namespace JOIN pg_roles AS owner ON owner.oid = namespace.nspowner
      WHERE namespace.nspname = 'public' ORDER BY namespace.nspname`,
    prisma.$queryRaw`
      SELECT relation.relname AS name, relation.relkind::text AS kind, owner.rolname AS owner,
        ARRAY(SELECT entry::text FROM unnest(COALESCE(relation.relacl, acldefault(CASE WHEN relation.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END, relation.relowner))) AS entry ORDER BY entry::text) AS acl,
        relation.relrowsecurity AS "rowSecurity", relation.relforcerowsecurity AS "forceRowSecurity"
      FROM pg_class AS relation JOIN pg_roles AS owner ON owner.oid = relation.relowner
      WHERE relation.relnamespace = 'public'::regnamespace AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      ORDER BY relation.relname, relation.relkind`,
    prisma.$queryRaw`
      SELECT routine.oid::regprocedure::text AS name, owner.rolname AS owner,
        routine.prosecdef AS "securityDefiner", COALESCE(routine.proconfig, ARRAY[]::text[]) AS config,
        ARRAY(SELECT entry::text FROM unnest(COALESCE(routine.proacl, acldefault('f', routine.proowner))) AS entry ORDER BY entry::text) AS acl
      FROM pg_proc AS routine JOIN pg_roles AS owner ON owner.oid = routine.proowner
      WHERE routine.pronamespace = 'public'::regnamespace ORDER BY name`,
    prisma.$queryRaw`
      SELECT owner.rolname AS owner, COALESCE(namespace.nspname, '') AS schema,
        defaults.defaclobjtype::text AS "objectType",
        ARRAY(SELECT entry::text FROM unnest(defaults.defaclacl) AS entry ORDER BY entry::text) AS acl
      FROM pg_default_acl AS defaults JOIN pg_roles AS owner ON owner.oid = defaults.defaclrole
      LEFT JOIN pg_namespace AS namespace ON namespace.oid = defaults.defaclnamespace
      WHERE defaults.defaclnamespace IN (0, 'public'::regnamespace)
      ORDER BY owner, schema, "objectType"`,
    prisma.$queryRaw`
      WITH exposure AS (
        SELECT 'database'::text AS source, 'current_database'::text AS object,
          expanded.grantee, expanded.privilege_type::text AS privilege, expanded.is_grantable AS grantable
        FROM pg_database AS database
        CROSS JOIN LATERAL aclexplode(COALESCE(database.datacl, acldefault('d', database.datdba))) AS expanded
        WHERE database.datname = current_database()
        UNION ALL
        SELECT 'schema', namespace.nspname, expanded.grantee, expanded.privilege_type::text, expanded.is_grantable
        FROM pg_namespace AS namespace
        CROSS JOIN LATERAL aclexplode(COALESCE(namespace.nspacl, acldefault('n', namespace.nspowner))) AS expanded
        WHERE namespace.nspname = 'public'
        UNION ALL
        SELECT CASE WHEN relation.relkind = 'S' THEN 'sequence' ELSE 'relation' END,
          relation.relname, expanded.grantee, expanded.privilege_type::text, expanded.is_grantable
        FROM pg_class AS relation
        CROSS JOIN LATERAL aclexplode(COALESCE(relation.relacl, acldefault(CASE WHEN relation.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END, relation.relowner))) AS expanded
        WHERE relation.relnamespace = 'public'::regnamespace AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
        UNION ALL
        SELECT 'function', routine.oid::regprocedure::text, expanded.grantee,
          expanded.privilege_type::text, expanded.is_grantable
        FROM pg_proc AS routine
        CROSS JOIN LATERAL aclexplode(COALESCE(routine.proacl, acldefault('f', routine.proowner))) AS expanded
        WHERE routine.pronamespace = 'public'::regnamespace
        UNION ALL
        SELECT 'default-' || defaults.defaclobjtype::text,
          COALESCE(namespace.nspname, ''), expanded.grantee,
          expanded.privilege_type::text, expanded.is_grantable
        FROM pg_default_acl AS defaults
        LEFT JOIN pg_namespace AS namespace ON namespace.oid = defaults.defaclnamespace
        CROSS JOIN LATERAL aclexplode(defaults.defaclacl) AS expanded
        WHERE defaults.defaclnamespace IN (0, 'public'::regnamespace)
      )
      SELECT exposure.source, exposure.object,
        CASE WHEN exposure.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END AS grantee,
        exposure.privilege, exposure.grantable
      FROM exposure LEFT JOIN pg_roles AS grantee ON grantee.oid = exposure.grantee
      WHERE exposure.grantee = 0 OR grantee.rolname IN ('anon', 'authenticated')
      ORDER BY source, object, grantee, privilege`,
  ]);
  const manifest = normalizeSchemaManifest({
    tables,
    columns,
    constraints,
    indexes,
    enums,
    sequences,
    views,
    functions,
    triggers,
    policies,
    databaseSecurity,
    schemaSecurity,
    relationSecurity,
    functionSecurity,
    defaultPrivileges,
    roleExposure,
  });
  await writeFile(
    output,
    `${JSON.stringify({ schemaVersion: 'rafraf-schema-manifest-v2', databaseName: (await prisma.$queryRaw`SELECT current_database() AS name`)[0].name, fingerprint: fingerprintSchemaManifest(manifest), manifest })}\n`,
    { mode: 0o600 },
  );
  process.stdout.write('Canonical redacted schema manifest collected.\n');
} finally {
  await prisma.$disconnect();
}
