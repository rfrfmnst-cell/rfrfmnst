-- Rehearse on a disposable Neon branch before deployment. A pending intent
-- does not reserve a User email; it can be safely replaced by a later attempt.
CREATE TABLE "customer_registration_intents" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "emailNormalized" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "phone" TEXT,
  "emailVerificationTokenHash" TEXT NOT NULL,
  "emailVerificationBrowserHash" TEXT NOT NULL,
  "emailVerificationExpiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_registration_intents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_registration_intents_email_normalized_check"
    CHECK ("emailNormalized" = lower(btrim("emailNormalized")))
);

CREATE INDEX "customer_registration_intents_emailNormalized_idx"
  ON "customer_registration_intents"("emailNormalized");
CREATE INDEX "customer_registration_intents_phone_idx"
  ON "customer_registration_intents"("phone");
CREATE UNIQUE INDEX "customer_registration_intents_emailVerificationTokenHash_key"
  ON "customer_registration_intents"("emailVerificationTokenHash");
CREATE INDEX "customer_registration_intents_emailVerificationExpiresAt_idx"
  ON "customer_registration_intents"("emailVerificationExpiresAt");
