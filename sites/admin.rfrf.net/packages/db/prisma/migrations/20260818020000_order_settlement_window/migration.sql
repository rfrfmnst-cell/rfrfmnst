-- Settlement window timestamps.
--
-- Both columns are additive and nullable, so the migration is safe to deploy
-- ahead of the code that writes them: existing rows keep working and no
-- backfill is required.
--
-- delivered_at opens the complaint window; customer_confirmed_at shortens it.
-- They stay separate columns because the supplier attests to delivery while the
-- customer attests to receipt, and collapsing them would let the party being
-- paid also close the window that protects the buyer.

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "customerConfirmedAt" TIMESTAMP(3);

-- Settlement sweeps look for orders whose window has closed. Without this the
-- sweep degrades to a full scan of every order as the table grows.
CREATE INDEX IF NOT EXISTS "orders_status_deliveredAt_idx"
  ON "orders" ("status", "deliveredAt");
