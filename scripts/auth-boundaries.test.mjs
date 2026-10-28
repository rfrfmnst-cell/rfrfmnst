import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";
import {
  signSession as signCustomer,
  verifySession as verifyCustomer,
} from "../sites/rfrf.net/apps/customer/lib/session.ts";
import {
  signSession as signSupplier,
  verifySession as verifySupplier,
} from "../sites/supplier.rfrf.net/apps/supplier/lib/session-token.ts";
import { authorizeSupplierSession } from "../sites/supplier.rfrf.net/apps/supplier/lib/session-access.ts";
import {
  adminAuthConfigured,
  localAdminMfaEnabled,
  isAdminPermission,
  signAdminSession,
  verifyAdminSession,
  signAdminMfaChallenge,
  verifyAdminMfaChallenge,
} from "../sites/admin.rfrf.net/apps/admin/lib/admin-session.ts";

const names = [
  "NODE_ENV",
  "SESSION_SECRET",
  "ADMIN_SESSION_SECRET",
  "OTP_DELIVERY_PROVIDER",
  "ADMIN_LOCAL_OTP",
  "TWILIO_ACCOUNT_SID",
  "VERIFY_SERVICE_SID",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
];
const originals = new Map(names.map((name) => [name, process.env[name]]));
after(() => {
  for (const [name, value] of originals) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});
for (const name of names) delete process.env[name];
process.env.NODE_ENV = "production";
process.env.SESSION_SECRET = randomBytes(32).toString("hex");
process.env.ADMIN_SESSION_SECRET = randomBytes(32).toString("hex");
const now = Date.now();

test("customer, supplier and administrative tokens cannot cross portal boundaries", async () => {
  const customer = await signCustomer("fixture-customer", now);
  const supplier = await signSupplier("fixture-supplier", now);
  const admin = await signAdminSession("fixture-admin", now);
  assert.equal(await verifyCustomer(customer, now), "fixture-customer");
  assert.equal(await verifySupplier(supplier, now), "fixture-supplier");
  assert.equal((await verifyAdminSession(admin, now))?.userId, "fixture-admin");
  assert.equal(await verifySupplier(customer, now), null);
  assert.equal(await verifyCustomer(supplier, now), null);
  assert.equal(await verifyAdminSession(customer, now), null);
  assert.equal(await verifyAdminSession(supplier, now), null);
  assert.equal(await verifyCustomer(admin, now), null);
  assert.equal(await verifySupplier(admin, now), null);
});

test("administrative MFA proof is not an authenticated session and expires after five minutes", async () => {
  const challenge = await signAdminMfaChallenge("fixture-admin", now);
  assert.equal(
    (await verifyAdminMfaChallenge(challenge, now))?.userId,
    "fixture-admin",
  );
  assert.equal(await verifyAdminSession(challenge, now), null);
  assert.equal(await verifyAdminMfaChallenge(challenge, now + 300000), null);
  assert.equal(await verifyAdminMfaChallenge(challenge + "x", now), null);
  const session = await signAdminSession("fixture-admin", now);
  assert.equal(await verifyAdminMfaChallenge(session, now), null);
  assert.equal(
    await verifyAdminSession(session, now + 8 * 60 * 60 * 1000),
    null,
  );
});

test("production administrative login remains closed without MFA and rejects local OTP configuration", () => {
  assert.equal(adminAuthConfigured(), false);
  process.env.OTP_DELIVERY_PROVIDER = "local";
  process.env.ADMIN_LOCAL_OTP = "123456";
  assert.equal(localAdminMfaEnabled(), false);
  assert.equal(adminAuthConfigured(), false);
  delete process.env.ADMIN_LOCAL_OTP;
  delete process.env.OTP_DELIVERY_PROVIDER;
});

test("permission strings are explicitly allowlisted rather than trusting arbitrary roles", () => {
  assert.equal(isAdminPermission("OPERATIONS_READ"), true);
  assert.equal(isAdminPermission("SUPPLIER_WRITE"), true);
  for (const permission of [
    "*",
    "ADMIN",
    "admin",
    "PAYMENT_WRITE,SUPPLIER_WRITE",
  ])
    assert.equal(isAdminPermission(permission), false);
});

test("a valid supplier signature cannot authorize a suspended account or a database outage", async () => {
  const token = await signSupplier("fixture-supplier", now);
  for (const status of ["SUSPENDED", "REJECTED", "DISABLED"]) {
    assert.equal(
      await authorizeSupplierSession(
        token,
        (value) => verifySupplier(value, now),
        async () => ({ status }),
      ),
      null,
    );
  }
  assert.equal(
    await authorizeSupplierSession(
      token,
      (value) => verifySupplier(value, now),
      async () => {
        throw Error("synthetic outage");
      },
    ),
    null,
  );
});
