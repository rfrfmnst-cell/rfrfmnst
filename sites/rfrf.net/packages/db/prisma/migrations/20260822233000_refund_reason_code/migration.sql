-- Immutable business trigger; provider/reconciliation failures continue to
-- evolve independently in failureCode.
-- Keep even this additive migration atomic under Prisma Migrate.
BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE "payment_refunds" ADD COLUMN "reasonCode" TEXT;

COMMIT;
