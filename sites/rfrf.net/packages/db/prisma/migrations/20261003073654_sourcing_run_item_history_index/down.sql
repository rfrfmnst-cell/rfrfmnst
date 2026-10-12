BEGIN;
SET LOCAL lock_timeout = '10s';

DROP INDEX IF EXISTS "sourcing_runs_rfqItemId_startedAt_id_idx";

COMMIT;
