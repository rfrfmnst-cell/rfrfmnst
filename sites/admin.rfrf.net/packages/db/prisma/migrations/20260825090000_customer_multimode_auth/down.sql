-- Reversal rehearsal only. Refuse to discard identities created after rollout.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "users"
    WHERE "phone" IS NULL
       OR "googleSubject" IS NOT NULL
       OR "emailVerificationTokenHash" IS NOT NULL
       OR "emailVerificationBrowserHash" IS NOT NULL
       OR "emailVerificationExpiresAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'customer auth rollback blocked: new identities or pending verifications exist';
  END IF;
END $$;

DROP INDEX "users_googleSubject_key";
DROP INDEX "users_emailVerificationTokenHash_key";
DROP INDEX "users_emailNormalized_key";

ALTER TABLE "users"
  DROP CONSTRAINT "users_email_normalized_check",
  DROP COLUMN "googleSubject",
  DROP COLUMN "emailVerificationExpiresAt",
  DROP COLUMN "emailVerificationBrowserHash",
  DROP COLUMN "emailVerificationTokenHash",
  DROP COLUMN "emailVerifiedAt",
  DROP COLUMN "emailNormalized",
  DROP COLUMN "phoneVerifiedAt",
  ALTER COLUMN "phone" SET NOT NULL;
