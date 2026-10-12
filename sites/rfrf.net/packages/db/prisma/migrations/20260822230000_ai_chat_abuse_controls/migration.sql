-- Durable AI reservations enforce customer/IP/global spend and concurrency
-- ceilings before a model request starts. Expiry fails safe after a crashed
-- serverless stream without keeping a customer slot forever.

-- Prisma Migrate does not wrap PostgreSQL migration files automatically.
BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE TYPE "AIChatRunStatus" AS ENUM (
  'ACTIVE',
  'COMPLETED',
  'FAILED',
  'ABORTED',
  'EXPIRED'
);

CREATE TABLE "ai_chat_runs" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "ipHash" TEXT NOT NULL,
  "status" "AIChatRunStatus" NOT NULL DEFAULT 'ACTIVE',
  "blockReason" TEXT,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "totalTokens" INTEGER,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ai_chat_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_chat_runs_requestKey_key"
  ON "ai_chat_runs"("requestKey");
CREATE INDEX "ai_chat_runs_customerId_createdAt_idx"
  ON "ai_chat_runs"("customerId", "createdAt");
CREATE INDEX "ai_chat_runs_ipHash_createdAt_idx"
  ON "ai_chat_runs"("ipHash", "createdAt");
CREATE INDEX "ai_chat_runs_status_expiresAt_idx"
  ON "ai_chat_runs"("status", "expiresAt");
CREATE INDEX "ai_chat_runs_createdAt_idx"
  ON "ai_chat_runs"("createdAt");

ALTER TABLE "ai_chat_runs"
  ADD CONSTRAINT "ai_chat_runs_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

REVOKE ALL PRIVILEGES ON TABLE "ai_chat_runs" FROM PUBLIC;

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
      'REVOKE ALL PRIVILEGES ON TABLE ai_chat_runs FROM %I',
      api_role
    );
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rafraf_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE "ai_chat_runs" TO rafraf_app;
  END IF;
END
$migration$;

COMMIT;
