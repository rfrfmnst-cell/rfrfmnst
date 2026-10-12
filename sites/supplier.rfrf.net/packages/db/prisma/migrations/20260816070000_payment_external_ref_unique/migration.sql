-- Payment providers retry webhooks routinely. Without a uniqueness guarantee on
-- the provider reference, a redelivered callback can create or advance a second
-- payment row for the same transaction and double-move escrow money.
--
-- NULLs stay unconstrained by design: a payment that has not yet reached the
-- provider has no reference, and several may sit in that state at once.

-- Refuse to enforce silently over conflicting history: two settled payments
-- sharing one provider reference is a money-moving inconsistency that a
-- migration must surface rather than paper over.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "payments"
    WHERE "externalRef" IS NOT NULL
    GROUP BY "provider", "externalRef"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce one payment per provider reference: duplicate (provider, externalRef) rows exist';
  END IF;
END
$$;

CREATE UNIQUE INDEX "payments_provider_externalRef_key"
  ON "payments" ("provider", "externalRef");
