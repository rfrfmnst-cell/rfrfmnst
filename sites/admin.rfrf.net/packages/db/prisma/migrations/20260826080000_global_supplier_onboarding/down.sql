BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE "supplier_documents"
DROP CONSTRAINT IF EXISTS "supplier_documents_status_values";
ALTER TABLE "supplier_documents"
ALTER COLUMN "status" DROP NOT NULL,
ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "suppliers"
DROP CONSTRAINT IF EXISTS "suppliers_contact_phone_e164",
DROP CONSTRAINT IF EXISTS "suppliers_country_code_format";
DROP INDEX IF EXISTS "suppliers_countryCode_crNumber_key";
ALTER TABLE "suppliers" DROP COLUMN IF EXISTS "countryCode";

COMMIT;
