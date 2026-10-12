-- Count only runs admitted at the final provider boundary. This keeps rejected
-- and locally invalid attempts out of the global provider-spend quota.
-- Apply the admission marker and its supporting ledgers atomically.
BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE "ai_chat_runs"
  ADD COLUMN "providerAcceptedAt" TIMESTAMP(3);

CREATE INDEX "ai_chat_runs_providerAcceptedAt_idx"
  ON "ai_chat_runs"("providerAcceptedAt");

-- Turnstile verification reservations use AuditLog as a durable, shared
-- customer/supplier ledger. Keep rolling-window counts index-backed.
CREATE INDEX "audit_logs_action_entityType_entityId_createdAt_idx"
  ON "audit_logs"("action", "entityType", "entityId", "createdAt");

COMMIT;
