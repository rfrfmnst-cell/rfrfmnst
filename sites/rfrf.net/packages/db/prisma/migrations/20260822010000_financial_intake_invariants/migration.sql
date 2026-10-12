-- Cross-provider payment intake and payout/ledger integrity gates.
-- Stop on historical ambiguity; finance must reconcile rows explicitly.

-- Prisma Migrate does not wrap PostgreSQL migration files automatically.
-- Keep the preflight and every resulting guard atomic, and fail quickly instead
-- of waiting indefinitely behind live writers.
BEGIN;
SET LOCAL lock_timeout = '10s';

-- Prevent a write from invalidating the historical preflight before the guards
-- are installed. SHARE ROW EXCLUSIVE still permits normal reads while the
-- bounded migration runs.
LOCK TABLE
  "orders",
  "payments",
  "payment_refunds",
  "escrow_ledger_entries",
  "landed_costs",
  "supplier_payouts"
IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "payments"
    WHERE "status" = 'PENDING'
      AND "externalRef" IS NULL
  ) THEN
    RAISE EXCEPTION
      'Legacy pending payments without provider correlation require reconciliation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "payments"
    WHERE "status" IN ('PENDING', 'AUTHORIZED', 'CAPTURED', 'HELD', 'RELEASED')
    GROUP BY "orderId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Multiple active payments exist for one order across providers';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "escrow_ledger_entries" AS e
    LEFT JOIN "orders" AS o ON o."id" = e."orderId"
    LEFT JOIN "payments" AS p ON p."id" = e."paymentId"
    WHERE e."entryType" = 'HOLD'
      AND (
        e."orderId" IS NULL
        OR o."id" IS NULL
        OR e."paymentId" IS NULL
        OR p."id" IS NULL
        OR p."orderId" <> o."id"
        OR p."amount" <> e."amount"
        OR p."currency" <> e."currency"
        OR o."totalAmount" <> e."amount"
        OR o."currency" <> e."currency"
      )
  ) THEN
    RAISE EXCEPTION
      'Escrow HOLD rows must match one payment, order amount, and currency';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "payments" AS p
    WHERE p."status" IN ('CAPTURED', 'HELD')
      AND NOT EXISTS (
        SELECT 1
        FROM "escrow_ledger_entries" AS e
        WHERE e."paymentId" = p."id"
          AND e."orderId" = p."orderId"
          AND e."entryType" = 'HOLD'
          AND e."amount" = p."amount"
          AND e."currency" = p."currency"
      )
  ) THEN
    RAISE EXCEPTION
      'Captured payments without an exact linked HOLD require reconciliation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "orders" AS o
    JOIN "escrow_ledger_entries" AS e
      ON e."orderId" = o."id" AND e."entryType" = 'HOLD'
    JOIN "landed_costs" AS lc ON lc."quoteId" = o."quoteId"
    WHERE lc."currency" <> o."currency" OR e."currency" <> o."currency"
  ) THEN
    RAISE EXCEPTION
      'Settlement inputs contain mixed currencies';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "payments" AS p
    JOIN "orders" AS o ON o."id" = p."orderId"
    WHERE p."status" = 'REFUNDED'
      AND NOT EXISTS (
        SELECT 1
        FROM "payment_refunds" AS pr
        WHERE pr."paymentId" = p."id"
          AND pr."status" = 'COMPLETED'
          AND pr."failureCode" = 'DUPLICATE_PAYMENT_CAPTURE_RESOLVED'
          AND pr."amount" = p."amount"
          AND pr."currency" = p."currency"
          AND EXISTS (
            SELECT 1
            FROM "escrow_ledger_entries" AS canonical_hold
            JOIN "payments" AS canonical_payment
              ON canonical_payment."id" = canonical_hold."paymentId"
            WHERE canonical_hold."orderId" = p."orderId"
              AND canonical_hold."entryType" = 'HOLD'
              AND canonical_hold."paymentId" <> p."id"
              AND canonical_hold."amount" = canonical_payment."amount"
              AND canonical_hold."currency" = canonical_payment."currency"
              AND canonical_payment."orderId" = p."orderId"
              AND canonical_payment."status" IN ('CAPTURED', 'HELD', 'RELEASED')
              AND canonical_hold."amount" = o."totalAmount"
              AND canonical_hold."currency" = o."currency"
          )
      )
      AND (
        o."status" <> 'REFUNDED'
        OR 1 <> (
          SELECT COUNT(*)
          FROM "escrow_ledger_entries" AS h
          WHERE h."paymentId" = p."id"
            AND h."entryType" = 'HOLD'
            AND h."amount" = p."amount"
            AND h."currency" = p."currency"
        )
        OR 1 <> (
          SELECT COUNT(*)
          FROM "escrow_ledger_entries" AS r
          WHERE r."paymentId" = p."id"
            AND r."entryType" = 'REFUND'
            AND r."amount" = -p."amount"
            AND r."currency" = p."currency"
        )
        OR EXISTS (
          SELECT 1
          FROM "escrow_ledger_entries" AS moved
          WHERE moved."orderId" = p."orderId"
            AND moved."entryType" IN ('RELEASE', 'PAYOUT')
        )
        OR EXISTS (
          SELECT 1
          FROM "supplier_payouts" AS sp
          WHERE sp."orderId" = p."orderId" AND sp."status" <> 'CANCELLED'
        )
      )
  ) THEN
    RAISE EXCEPTION
      'Refunded payments require exact HOLD/REFUND currency and ledger proof';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "supplier_payouts"
    WHERE "orderId" IS NOT NULL AND "status" <> 'CANCELLED'
    GROUP BY "orderId"
    HAVING COUNT(*) > 1
  ) OR EXISTS (
    SELECT 1
    FROM "escrow_ledger_entries"
    WHERE "orderId" IS NOT NULL AND "entryType" = 'PAYOUT'
    GROUP BY "orderId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Duplicate supplier payout evidence requires reconciliation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "payment_refunds"
    WHERE "externalRef" IS NOT NULL
    GROUP BY "externalRef"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Duplicate provider refund references require reconciliation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "payment_refunds" AS pr
    JOIN "payments" AS p ON p."id" = pr."paymentId"
    WHERE pr."externalRef" IS NOT NULL
      AND p."externalRef" IS NOT NULL
      AND pr."externalRef" = p."externalRef"
  ) THEN
    RAISE EXCEPTION
      'Legacy refund rows using purchase references require reconciliation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "supplier_payouts"
    WHERE "reference" IS NOT NULL
    GROUP BY UPPER(BTRIM("reference"))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Duplicate normalized supplier payout references require reconciliation';
  END IF;
END
$$;

ALTER TABLE "payments"
  ADD COLUMN "providerOrderCode" TEXT,
  ADD COLUMN "failureCode" TEXT;

CREATE UNIQUE INDEX "payments_providerOrderCode_key"
  ON "payments" ("providerOrderCode");

-- Only provider requests whose outcome is still open are mutually exclusive.
-- Captured duplicates must be representable long enough to create and finish
-- their durable refund operation. Checkout/webhook still serialize on the
-- order intake lock, while this cross-provider index closes direct-write races.
DROP INDEX IF EXISTS "payments_one_active_per_order_provider_key";
CREATE UNIQUE INDEX "payments_one_open_intake_per_order_key"
  ON "payments" ("orderId")
  WHERE "status" IN ('PENDING', 'AUTHORIZED');

CREATE UNIQUE INDEX "payment_refunds_externalRef_key"
  ON "payment_refunds" ("externalRef");

CREATE UNIQUE INDEX "supplier_payouts_reference_normalized_key"
  ON "supplier_payouts" (UPPER(BTRIM("reference")))
  WHERE "reference" IS NOT NULL;

CREATE UNIQUE INDEX "supplier_payouts_one_active_per_order_key"
  ON "supplier_payouts" ("orderId")
  WHERE "orderId" IS NOT NULL AND "status" <> 'CANCELLED';

CREATE UNIQUE INDEX "escrow_one_payout_per_order_key"
  ON "escrow_ledger_entries" ("orderId")
  WHERE "entryType" = 'PAYOUT' AND "orderId" IS NOT NULL;

COMMIT;
