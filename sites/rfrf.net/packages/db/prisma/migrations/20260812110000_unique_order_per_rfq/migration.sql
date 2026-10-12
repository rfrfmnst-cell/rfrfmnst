-- A linked order must agree with the RFQ reached through its required quote.
-- Refuse to rewrite conflicting non-null values silently.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "orders" AS o
    JOIN "quotes" AS q ON q."id" = o."quoteId"
    JOIN "rfq_items" AS i ON i."id" = q."rfqItemId"
    WHERE o."rfqId" IS NOT NULL
      AND o."rfqId" <> i."rfqId"
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce one order per RFQ: an order.rfqId conflicts with its quote RFQ';
  END IF;
END
$$;

-- Historical rows may predate the direct RFQ link. The required quote gives a
-- deterministic, ownership-preserving backfill path.
UPDATE "orders" AS o
SET "rfqId" = i."rfqId"
FROM "quotes" AS q
JOIN "rfq_items" AS i ON i."id" = q."rfqItemId"
WHERE o."quoteId" = q."id"
  AND o."rfqId" IS NULL;

-- Refuse to hide pre-existing duplicate orders. Operators must resolve them
-- deliberately before this migration can be applied.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "orders"
    WHERE "rfqId" IS NOT NULL
    GROUP BY "rfqId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce one order per RFQ: duplicate non-null orders.rfqId values exist';
  END IF;
END
$$;

-- PostgreSQL permits multiple NULL values in a unique index, preserving orders
-- that intentionally have no RFQ while enforcing one order for every linked RFQ.
CREATE UNIQUE INDEX "orders_rfqId_key" ON "orders"("rfqId");
