-- Rafraf authenticates at the application layer and reaches PostgreSQL through
-- Prisma. The Supabase Data API roles must not be able to reach application
-- objects in public. Apply this migration with the owner/admin direct
-- connection; the rafraf_app runtime role is deliberately left unchanged.

DO $migration$
DECLARE
  api_role NAME;
BEGIN
  FOR api_role IN
    SELECT rolname
    FROM pg_roles
    WHERE rolname IN ('anon', 'authenticated')
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I',
      api_role
    );
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I',
      api_role
    );
    EXECUTE format(
      'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM %I',
      api_role
    );
  END LOOP;
END
$migration$;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Revoke the
-- inherited path as well; any future callable function requires an explicit
-- grant to the server-side role that needs it.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

-- Default privileges belong to the role that creates an object. Always cover
-- the migration caller, plus the standard postgres owner role when the caller
-- is allowed to administer it. Apply through the owner/admin direct connection
-- so the owner defaults are included rather than silently out of scope.
DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres')
     AND current_user <> 'postgres'
     AND NOT pg_has_role(current_user, 'postgres', 'MEMBER') THEN
    RAISE EXCEPTION
      'migration role % cannot administer postgres default privileges; rerun with the postgres owner/admin direct connection',
      current_user;
  END IF;
END
$migration$;

DO $migration$
DECLARE
  creator_role NAME;
  api_role NAME;
BEGIN
  FOR creator_role IN
    SELECT DISTINCT rolname
    FROM pg_roles
    WHERE rolname = current_user
       OR (
         rolname = 'postgres'
         AND pg_has_role(current_user, oid, 'MEMBER')
       )
  LOOP
    FOR api_role IN
      SELECT rolname
      FROM pg_roles
      WHERE rolname IN ('anon', 'authenticated')
    LOOP
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM %I',
        creator_role,
        api_role
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM %I',
        creator_role,
        api_role
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON FUNCTIONS FROM %I',
        creator_role,
        api_role
      );

      -- Per-schema defaults add to global defaults; they cannot subtract a
      -- global grant. Revoke both scopes so future objects in public cannot
      -- inherit access from either pg_default_acl entry.
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL PRIVILEGES ON TABLES FROM %I',
        creator_role,
        api_role
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL PRIVILEGES ON SEQUENCES FROM %I',
        creator_role,
        api_role
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL PRIVILEGES ON FUNCTIONS FROM %I',
        creator_role,
        api_role
      );
    END LOOP;

    -- PostgreSQL's implicit PUBLIC execute grant is global. A schema-scoped
    -- revoke cannot subtract that global default, so this statement must omit
    -- IN SCHEMA. Future server functions must grant callers explicitly.
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
      creator_role
    );
  END LOOP;
END
$migration$;

-- Do not accept a migration that only secured the current objects. Verify the
-- explicit default ACLs for both the migration caller and the postgres owner,
-- including PostgreSQL's implicit PUBLIC execute grant on future functions.
DO $migration$
DECLARE
  creator_role NAME;
  api_role NAME;
BEGIN
  FOR creator_role IN
    SELECT DISTINCT rolname
    FROM pg_roles
    WHERE rolname = current_user OR rolname = 'postgres'
  LOOP
    FOR api_role IN
      SELECT rolname
      FROM pg_roles
      WHERE rolname IN ('anon', 'authenticated')
    LOOP
      IF EXISTS (
        SELECT 1
        FROM pg_default_acl AS defaults
        CROSS JOIN LATERAL aclexplode(defaults.defaclacl) AS grant_entry
        JOIN pg_roles AS grantee ON grantee.oid = grant_entry.grantee
        WHERE defaults.defaclrole = creator_role::regrole
          AND defaults.defaclnamespace IN (0, 'public'::regnamespace)
          AND defaults.defaclobjtype IN ('r', 'S', 'f')
          AND grantee.rolname = api_role
      ) THEN
        RAISE EXCEPTION
          '% retains explicit default access to future public objects created by %',
          api_role,
          creator_role;
      END IF;
    END LOOP;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_default_acl AS defaults
      WHERE defaults.defaclrole = creator_role::regrole
        AND defaults.defaclnamespace = 0
        AND defaults.defaclobjtype = 'f'
        AND NOT aclcontains(
          defaults.defaclacl,
          makeaclitem(0, creator_role::regrole, 'EXECUTE', false)
        )
    ) THEN
      RAISE EXCEPTION
        'PUBLIC execute is still implicit for future functions created by %',
        creator_role;
    END IF;
  END LOOP;
END
$migration$;

-- Verify effective privileges, including grants inherited through role
-- membership. A direct REVOKE is not sufficient if an API role inherits access
-- from another database role.
DO $migration$
DECLARE
  api_role NAME;
BEGIN
  FOR api_role IN
    SELECT rolname
    FROM pg_roles
    WHERE rolname IN ('anon', 'authenticated')
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_class AS relation
      WHERE relation.relnamespace = 'public'::regnamespace
        AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND (
          has_table_privilege(api_role, relation.oid, 'SELECT') OR
          has_table_privilege(api_role, relation.oid, 'INSERT') OR
          has_table_privilege(api_role, relation.oid, 'UPDATE') OR
          has_table_privilege(api_role, relation.oid, 'DELETE') OR
          has_table_privilege(api_role, relation.oid, 'TRUNCATE') OR
          has_table_privilege(api_role, relation.oid, 'REFERENCES') OR
          has_table_privilege(api_role, relation.oid, 'TRIGGER')
        )
    ) THEN
      RAISE EXCEPTION
        '% still has effective access to a public table or view',
        api_role;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_class AS sequence
      WHERE sequence.relnamespace = 'public'::regnamespace
        AND sequence.relkind = 'S'
        AND (
          has_sequence_privilege(api_role, sequence.oid, 'USAGE') OR
          has_sequence_privilege(api_role, sequence.oid, 'SELECT') OR
          has_sequence_privilege(api_role, sequence.oid, 'UPDATE')
        )
    ) THEN
      RAISE EXCEPTION
        '% still has effective access to a public sequence',
        api_role;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_proc AS routine
      WHERE routine.pronamespace = 'public'::regnamespace
        AND has_function_privilege(api_role, routine.oid, 'EXECUTE')
    ) THEN
      RAISE EXCEPTION
        '% still has effective access to a public function',
        api_role;
    END IF;
  END LOOP;
END
$migration$;

-- This is a guard against accidentally applying a broader schema-level revoke.
-- rafraf_app keeps the existing direct-connection access used by Prisma.
DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rafraf_app')
     AND NOT has_schema_privilege('rafraf_app', 'public', 'USAGE') THEN
    RAISE EXCEPTION
      'rafraf_app lost USAGE on public; restore the runtime grant before continuing';
  END IF;
END
$migration$;
