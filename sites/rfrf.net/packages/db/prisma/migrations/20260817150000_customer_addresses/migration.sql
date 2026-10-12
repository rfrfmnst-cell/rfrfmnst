-- Additive customer address book for the authenticated customer account.
-- Existing Order.shippingAddress JSON remains untouched for backwards compatibility.

CREATE TABLE "customer_addresses" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "buildingNumber" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "additionalNumber" TEXT,
    "unitNumber" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_addresses_customerId_isDefault_createdAt_idx"
    ON "customer_addresses"("customerId", "isDefault", "createdAt");

-- Transactions serialize default changes, while this partial index remains the
-- database-level invariant against two defaults for one customer.
CREATE UNIQUE INDEX "customer_addresses_one_default_per_customer_key"
    ON "customer_addresses"("customerId")
    WHERE "isDefault" = true;

ALTER TABLE "customer_addresses"
    ADD CONSTRAINT "customer_addresses_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep browser-facing compatibility roles out even when owner defaults differ.
REVOKE ALL PRIVILEGES ON TABLE "customer_addresses" FROM PUBLIC;

DO $migration$
DECLARE
  api_role NAME;
BEGIN
  FOR api_role IN
    SELECT rolname
    FROM pg_roles
    WHERE rolname IN ('anon', 'authenticated')
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE customer_addresses FROM %I',
      api_role
    );
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rafraf_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE "customer_addresses" TO rafraf_app;
  END IF;
END
$migration$;
