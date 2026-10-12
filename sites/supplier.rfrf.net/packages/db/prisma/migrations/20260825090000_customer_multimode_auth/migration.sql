-- Rehearse on a disposable Neon branch before deployment. This migration is
-- intentionally not applied to Production by repository tooling.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "users"
    WHERE "email" IS NOT NULL
    GROUP BY lower(btrim("email"))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'customer auth migration blocked: normalized email collision';
  END IF;
END $$;

ALTER TABLE "users"
  ALTER COLUMN "phone" DROP NOT NULL,
  ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "emailNormalized" TEXT,
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "emailVerificationTokenHash" TEXT,
  ADD COLUMN "emailVerificationBrowserHash" TEXT,
  ADD COLUMN "emailVerificationExpiresAt" TIMESTAMP(3),
  ADD COLUMN "googleSubject" TEXT;

UPDATE "users"
SET "emailNormalized" = lower(btrim("email"))
WHERE "email" IS NOT NULL;

-- Existing phone identities have already passed their portal OTP flow. The
-- timestamp records migration provenance without manufacturing an email proof.
UPDATE "users"
SET "phoneVerifiedAt" = COALESCE("lastLoginAt", "createdAt")
WHERE "phone" IS NOT NULL;

CREATE UNIQUE INDEX "users_emailNormalized_key"
  ON "users"("emailNormalized");
CREATE UNIQUE INDEX "users_emailVerificationTokenHash_key"
  ON "users"("emailVerificationTokenHash");
CREATE UNIQUE INDEX "users_googleSubject_key"
  ON "users"("googleSubject");

ALTER TABLE "users"
  ADD CONSTRAINT "users_email_normalized_check"
    CHECK (
      "emailNormalized" IS NULL
      OR "emailNormalized" = lower(btrim("emailNormalized"))
    );
