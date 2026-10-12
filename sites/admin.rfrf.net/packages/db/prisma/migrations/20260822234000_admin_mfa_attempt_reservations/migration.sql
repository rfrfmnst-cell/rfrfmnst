-- Reserve every admin MFA verification before invoking Twilio Verify. The
-- unique per-challenge sequence and application advisory lock close parallel
-- attempt-limit bypasses while keeping provider latency outside transactions.

-- Prisma Migrate does not wrap PostgreSQL migration files automatically.
BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE TYPE "AdminMfaVerificationStatus" AS ENUM (
  'IN_FLIGHT',
  'INVALID',
  'EXPIRED',
  'UNAVAILABLE',
  'VERIFIED',
  'NOT_ALLOWED',
  'SUPERSEDED'
);

CREATE TABLE "admin_mfa_verification_attempts" (
  "id" TEXT NOT NULL,
  "challengeKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "status" "AdminMfaVerificationStatus" NOT NULL DEFAULT 'IN_FLIGHT',
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "admin_mfa_verification_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "admin_mfa_verification_attempts_sequence_check"
    CHECK ("sequence" BETWEEN 1 AND 5)
);

CREATE UNIQUE INDEX "admin_mfa_verification_attempts_challengeKey_sequence_key"
  ON "admin_mfa_verification_attempts"("challengeKey", "sequence");
CREATE INDEX "admin_mfa_verification_attempts_status_createdAt_idx"
  ON "admin_mfa_verification_attempts"("status", "createdAt");

REVOKE ALL PRIVILEGES ON TABLE "admin_mfa_verification_attempts" FROM PUBLIC;

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
      'REVOKE ALL PRIVILEGES ON TABLE admin_mfa_verification_attempts FROM %I',
      api_role
    );
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rafraf_app') THEN
    GRANT SELECT, INSERT, UPDATE
      ON TABLE "admin_mfa_verification_attempts" TO rafraf_app;
  END IF;
END
$migration$;

COMMIT;
