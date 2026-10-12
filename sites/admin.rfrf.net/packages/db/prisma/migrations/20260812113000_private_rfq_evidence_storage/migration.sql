ALTER TABLE "rfq_evidence"
  ADD COLUMN "storageKey" TEXT,
  ALTER COLUMN "fileUrl" DROP NOT NULL;

-- Preserve legacy URLs while recognizing rows that already contain private object keys.
UPDATE "rfq_evidence"
SET "storageKey" = "fileUrl"
WHERE "storageKey" IS NULL
  AND "fileUrl" ~ '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+\.(jpg|png|webp)$';

CREATE INDEX "rfq_evidence_storageKey_idx"
  ON "rfq_evidence"("storageKey");

-- Existing legacy rows are not scanned during deployment; all new or changed rows
-- must retain either a legacy URL or the private storage object key.
ALTER TABLE "rfq_evidence"
  ADD CONSTRAINT "rfq_evidence_location_check"
  CHECK (
    NULLIF(BTRIM("storageKey"), '') IS NOT NULL OR
    NULLIF(BTRIM("fileUrl"), '') IS NOT NULL
  ) NOT VALID;
