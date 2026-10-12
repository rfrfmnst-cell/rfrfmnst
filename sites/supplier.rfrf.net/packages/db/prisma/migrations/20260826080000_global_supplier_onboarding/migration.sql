BEGIN;
SET LOCAL lock_timeout = '10s';

LOCK TABLE "suppliers", "supplier_documents"
IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "suppliers"
    WHERE "contactPhone" !~ '^\+[1-9][0-9]{7,14}$'
  ) THEN
    RAISE EXCEPTION 'global supplier onboarding: non-E.164 contactPhone exists';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "suppliers"
    WHERE "crNumber" IS NOT NULL
    GROUP BY "crNumber"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'global supplier onboarding: duplicate legacy registration number exists';
  END IF;
END $$;

ALTER TABLE "suppliers"
ADD COLUMN "countryCode" CHAR(2) NOT NULL DEFAULT 'SA';

CREATE UNIQUE INDEX "suppliers_countryCode_crNumber_key"
ON "suppliers"("countryCode", "crNumber");

ALTER TABLE "suppliers"
ADD CONSTRAINT "suppliers_country_code_format"
CHECK ("countryCode" ~ '^[A-Z]{2}$');

ALTER TABLE "suppliers"
ADD CONSTRAINT "suppliers_contact_phone_e164"
CHECK ("contactPhone" ~ '^\+[1-9][0-9]{7,14}$');

UPDATE "supplier_documents"
SET "status" = 'PENDING'
WHERE "status" IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "supplier_documents"
    WHERE "status" NOT IN ('PENDING', 'APPROVED', 'REJECTED')
  ) THEN
    RAISE EXCEPTION 'global supplier onboarding: unknown document status exists';
  END IF;
END $$;

ALTER TABLE "supplier_documents"
ALTER COLUMN "status" SET DEFAULT 'PENDING',
ALTER COLUMN "status" SET NOT NULL;

ALTER TABLE "supplier_documents"
ADD CONSTRAINT "supplier_documents_status_values"
CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED'));

COMMIT;
