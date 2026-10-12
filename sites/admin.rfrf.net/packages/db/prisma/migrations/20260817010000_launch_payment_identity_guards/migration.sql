-- Launch safety guards for money movement and supplier tenant identity.
-- This migration is additive. It deliberately stops when historical conflicts
-- exist; operators must reconcile them rather than letting an index choose a row.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "payments"
    WHERE "status" IN ('PENDING', 'AUTHORIZED', 'CAPTURED', 'HELD', 'RELEASED')
    GROUP BY "orderId", "provider"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce one active payment per order/provider: conflicting rows exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "escrow_ledger_entries"
    WHERE "entryType" = 'HOLD' AND "orderId" IS NOT NULL
    GROUP BY "orderId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce one escrow hold per order: conflicting HOLD rows exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "escrow_ledger_entries"
    WHERE "entryType" = 'REFUND' AND "paymentId" IS NOT NULL
    GROUP BY "paymentId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce one refund per payment: conflicting REFUND rows exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "payments" AS p
    JOIN "orders" AS o ON o."id" = p."orderId"
    WHERE p."status" = 'REFUNDED'
      AND (
        o."status" <> 'REFUNDED'
        OR NOT EXISTS (
          SELECT 1
          FROM "escrow_ledger_entries" AS e
          WHERE e."paymentId" = p."id"
            AND e."entryType" = 'REFUND'
        )
      )
  ) THEN
    RAISE EXCEPTION
      'Historical REFUNDED payments require order/escrow reconciliation before launch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "suppliers"
    GROUP BY "contactPhone"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce one supplier tenant per phone: duplicate contactPhone rows exist';
  END IF;
END
$$;

CREATE UNIQUE INDEX "payments_one_active_per_order_provider_key"
  ON "payments" ("orderId", "provider")
  WHERE "status" IN ('PENDING', 'AUTHORIZED', 'CAPTURED', 'HELD', 'RELEASED');

CREATE UNIQUE INDEX "escrow_one_hold_per_order_key"
  ON "escrow_ledger_entries" ("orderId")
  WHERE "entryType" = 'HOLD' AND "orderId" IS NOT NULL;

CREATE UNIQUE INDEX "escrow_one_refund_per_payment_key"
  ON "escrow_ledger_entries" ("paymentId")
  WHERE "entryType" = 'REFUND' AND "paymentId" IS NOT NULL;

CREATE UNIQUE INDEX "suppliers_contactPhone_key"
  ON "suppliers" ("contactPhone");
