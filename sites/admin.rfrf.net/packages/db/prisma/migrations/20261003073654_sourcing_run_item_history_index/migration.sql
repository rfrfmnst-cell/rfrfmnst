BEGIN;
SET LOCAL lock_timeout = '10s';

-- Scope both latest-attempt and last-success reads to one RFQ item, preserving
-- their deterministic newest-first order without scanning global run history.
CREATE INDEX "sourcing_runs_rfqItemId_startedAt_id_idx"
ON "sourcing_runs"("rfqItemId", "startedAt" DESC, "id" DESC);

COMMIT;
