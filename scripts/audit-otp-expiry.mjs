import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Exercise the real OTP services with the existing test adapters, adding only
// provider latency. Never connect to a database, send OTP or change app source.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const roles = { "rfrf.net": "customer", "supplier.rfrf.net": "supplier" };
const sites = process.argv[2] ? [process.argv[2]] : Object.keys(roles);
for (const site of sites)
  assert.ok(Object.hasOwn(roles, site), "Pass a customer or supplier site.");
const temporary = mkdtempSync(join(tmpdir(), "rafraf-otp-expiry-"));
try {
  const files = [];
  for (const site of sites) {
    const role = roles[site];
    const app = join(root, "sites", site, "apps", role);
    const fixture = join(app, "lib/auth-flow.test.mjs");
    const require = createRequire(join(app, "package.json"));
    let source = readFileSync(fixture, "utf8");
    source = source.replace(/from (['"])([^'"]+)\1/g, (match, quote, name) => {
      if (name.startsWith("."))
        return `from ${quote}${pathToFileURL(resolve(dirname(fixture), name)).href}${quote}`;
      if (name === "typescript")
        return `from ${quote}${pathToFileURL(require.resolve("typescript")).href}${quote}`;
      return match;
    });
    source = source.replace(
      /new URL\((['"])([^'"]+)\1,\s*import.meta.url\)/g,
      (_match, _quote, name) =>
        `new URL('${pathToFileURL(resolve(dirname(fixture), name)).href}')`,
    );
    assert.ok(
      source.includes("  completionFailure = false,"),
      "OTP fixture shape changed; update this audit explicitly.",
    );
    assert.ok(
      source.includes("checks.push({ number, code });"),
      "OTP provider fixture is unavailable.",
    );
    source = source.replace(
      "  completionFailure = false,",
      "  completionFailure = false,\n  afterVerification = () => {},",
    );
    source = source.replace(
      "checks.push({ number, code });",
      "checks.push({ number, code });\n        afterVerification();",
    );
    source +=
      role === "customer"
        ? `
test('release gate: customer rejects provider approval after local OTP expiry', async (t) => {
  const start = Date.now();
  t.mock.method(Date, 'now', () => start);
  const f = fixture({ afterVerification: () => t.mock.method(Date, 'now', () => start + 301000) });
  const challenge = otp.createCustomerOtpChallenge('+966512345678');
  assert.equal((await f.service.verifyCustomerOtpFlow(challenge.cookie, '123456')).status, 'expired');
});
`
        : `
test('release gate: supplier rejects provider approval after local OTP expiry', async (t) => {
  const start = Date.now();
  t.mock.method(Date, 'now', () => start);
  const f = fixture({ afterVerification: () => t.mock.method(Date, 'now', () => start + 301000) });
  f.cookies.set(otp.SUPPLIER_OTP_COOKIE, otp.createSupplierOtpChallenge('+966512345678').cookie);
  assert.equal(await destination(() => f.actions.verifyOtp(form({ code: '123456' }))), '/login?mode=phone&err=expired');
});
`;
    const file = join(temporary, `${role}.test.mjs`);
    writeFileSync(file, source);
    files.push(file);
  }
  const result = spawnSync(process.execPath, ["--test", ...files], {
    cwd: root,
    env: { PATH: process.env.PATH, NODE_ENV: "test" },
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 60000,
  });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  console.log(
    JSON.stringify({
      gate: "otp-expiry",
      sites,
      passed: result.status === 0,
      realProviderCalls: false,
      applicationSourceChanged: false,
    }),
  );
  process.exitCode = result.status === 0 ? 0 : 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
