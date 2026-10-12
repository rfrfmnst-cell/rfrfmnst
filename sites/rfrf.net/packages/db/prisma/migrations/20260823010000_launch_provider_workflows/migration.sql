BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TYPE "PayoutStatus" ADD VALUE IF NOT EXISTS 'APPROVED';
ALTER TYPE "PayoutStatus" ADD VALUE IF NOT EXISTS 'SUBMITTING';
ALTER TYPE "PayoutStatus" ADD VALUE IF NOT EXISTS 'SUBMITTED';
ALTER TYPE "PayoutStatus" ADD VALUE IF NOT EXISTS 'FAILED_RETRYABLE';
ALTER TYPE "PayoutStatus" ADD VALUE IF NOT EXISTS 'FAILED_FINAL';

CREATE TYPE "EInvoiceStatus" AS ENUM (
  'CREATED',
  'PENDING',
  'ACCEPTED',
  'REPORTED',
  'REJECTED',
  'FAILED_RETRYABLE',
  'FAILED_FINAL'
);

ALTER TABLE "suppliers"
  ADD COLUMN "payoutBeneficiaryReference" TEXT;

ALTER TABLE "supplier_warehouses"
  ADD COLUMN "district" TEXT,
  ADD COLUMN "street" TEXT,
  ADD COLUMN "buildingNumber" TEXT,
  ADD COLUMN "postalCode" TEXT,
  ADD COLUMN "addressLine" TEXT;

ALTER TABLE "supplier_payouts"
  ADD COLUMN "provider" TEXT,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "beneficiaryReference" TEXT,
  ADD COLUMN "makerId" TEXT,
  ADD COLUMN "checkerId" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "externalRef" TEXT,
  ADD COLUMN "failureCode" TEXT;

CREATE UNIQUE INDEX "supplier_payouts_idempotencyKey_key"
  ON "supplier_payouts"("idempotencyKey");
CREATE UNIQUE INDEX "supplier_payouts_externalRef_key"
  ON "supplier_payouts"("externalRef");

ALTER TABLE "shipments"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "externalOrderId" TEXT,
  ADD COLUMN "labelUrl" TEXT,
  ADD COLUMN "lastProviderEventAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "shipments_idempotencyKey_key"
  ON "shipments"("idempotencyKey");

CREATE TABLE "provider_webhook_events" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "externalOrderCode" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3),
  "payload" JSONB NOT NULL,
  "orderId" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provider_webhook_events_eventId_key"
  ON "provider_webhook_events"("eventId");
CREATE INDEX "provider_webhook_events_provider_externalOrderCode_receivedAt_idx"
  ON "provider_webhook_events"("provider", "externalOrderCode", "receivedAt");
ALTER TABLE "provider_webhook_events"
  ADD CONSTRAINT "provider_webhook_events_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoices"
  ADD COLUMN "provider" TEXT,
  ADD COLUMN "invoiceUuid" TEXT,
  ADD COLUMN "invoiceHash" TEXT,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "externalRef" TEXT,
  ADD COLUMN "submissionStatus" "EInvoiceStatus" NOT NULL DEFAULT 'CREATED',
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "failureCode" TEXT;

CREATE UNIQUE INDEX "invoices_invoiceUuid_key" ON "invoices"("invoiceUuid");
CREATE UNIQUE INDEX "invoices_idempotencyKey_key" ON "invoices"("idempotencyKey");
CREATE UNIQUE INDEX "invoices_externalRef_key" ON "invoices"("externalRef");

COMMIT;
