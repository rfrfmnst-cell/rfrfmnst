-- Named operations identities, per-user permissions, and MFA are enforced by
-- the admin application. Keep this change additive: existing accounts retain
-- no privileges until explicitly provisioned by an owner.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "adminPermissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
