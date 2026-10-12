-- Durable, replay-safe full-refund operations.
-- Additive only: existing payments and orders are not rewritten.

CREATE TYPE "PaymentRefundStatus" AS ENUM (
  'REQUESTED',
  'PROCESSING',
  'PROVIDER_PENDING',
  'COMPLETED',
  'FAILED_RETRYABLE',
  'FAILED_FINAL'
);

CREATE TABLE "payment_refunds" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "status" "PaymentRefundStatus" NOT NULL DEFAULT 'REQUESTED',
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'SAR',
  "requestedBy" TEXT NOT NULL,
  "externalRef" TEXT,
  "failureCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "payment_refunds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_refunds_paymentId_key"
  ON "payment_refunds"("paymentId");
CREATE INDEX "payment_refunds_status_updatedAt_idx"
  ON "payment_refunds"("status", "updatedAt");

ALTER TABLE "payment_refunds"
  ADD CONSTRAINT "payment_refunds_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "payments"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_refunds"
  ADD CONSTRAINT "payment_refunds_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
