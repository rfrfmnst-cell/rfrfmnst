import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// This command owns a new disposable database. It never consumes a supplied
// DATABASE_URL, production schema, provider credential or existing container.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(
  new URL("../apps/api/package.json", import.meta.url),
);
const { Pool } = require("pg");
const dockerEnv = { ...process.env };
for (const key of [
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_TLS",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
])
  delete dockerEnv[key];
function docker(args) {
  const result = spawnSync(
    "docker",
    ["--host=unix:///var/run/docker.sock", ...args],
    { env: dockerEnv, encoding: "utf8", timeout: 90000 },
  );
  assert.equal(result.status, 0, "Managed local Docker operation failed.");
  return result.stdout.trim();
}
const container = `rafraf-api-test-${randomBytes(8).toString("hex")}`;
const image =
  "postgres:17-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b";
let owned = false,
  admin,
  readOnly,
  server;
let serverExit;
const checks = [];
try {
  docker([
    "run",
    "--rm",
    "-d",
    "--name",
    container,
    "-e",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "-e",
    "POSTGRES_DB=rafraf_api_test",
    "-p",
    "127.0.0.1::5432",
    image,
  ]);
  owned = true;
  const binding = docker(["port", container, "5432/tcp"]);
  assert.match(binding, /^127\.0\.0\.1:\d+$/);
  const databasePort = Number(binding.split(":")[1]);
  for (let attempt = 0; attempt < 100; attempt++) {
    const status = spawnSync(
      "docker",
      [
        "--host=unix:///var/run/docker.sock",
        "exec",
        container,
        "pg_isready",
        "-h",
        "127.0.0.1",
        "-U",
        "postgres",
        "-d",
        "rafraf_api_test",
      ],
      { env: dockerEnv, stdio: "ignore", timeout: 2000 },
    );
    if (status.status === 0) break;
    if (attempt === 99)
      throw Error("Disposable PostgreSQL did not become ready.");
    await delay(100);
  }
  admin = new Pool({
    connectionString: `postgresql://postgres@127.0.0.1:${databasePort}/rafraf_api_test`,
    max: 1,
    connectionTimeoutMillis: 2500,
  });
  await admin.query("CREATE ROLE rafraf_api_probe LOGIN");
  await admin.query("GRANT USAGE ON SCHEMA public TO rafraf_api_probe");
  const connectionString = `postgresql://rafraf_api_probe@127.0.0.1:${databasePort}/rafraf_api_test`;
  readOnly = new Pool({ connectionString, max: 1 });

  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const apiPort = reservation.address().port;
  await new Promise((done) => reservation.close(done));
  const secret = randomBytes(32).toString("hex");
  server = spawn(process.execPath, ["hostinger-runtime/bootstrap.cjs"], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      PORT: String(apiPort),
      API_DOCS_ENABLED: "false",
      API_DATABASE_URL: connectionString,
      READINESS_PROBE_SECRET: secret,
    },
    stdio: "ignore",
  });
  serverExit = once(server, "exit");
  serverExit.catch(() => {});
  const origin = `http://127.0.0.1:${apiPort}`;
  let alive = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    assert.equal(server.exitCode, null, "Packaged API exited before startup.");
    try {
      const response = await fetch(`${origin}/api/liveness`, {
        signal: AbortSignal.timeout(1000),
      });
      alive = response.ok;
      await response.body?.cancel();
      if (alive) break;
    } catch {
      /* Owned preview starting. */
    }
    await delay(100);
  }
  assert.ok(alive);
  checks.push("packaged-liveness");
  async function probe(status, code) {
    const response = await fetch(`${origin}/api/readiness`, {
      headers: { "x-readiness-probe-secret": secret },
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.code, code);
    assert.ok(!JSON.stringify(body).includes("synthetic-private-customer"));
  }
  const denied = await fetch(`${origin}/api/readiness`);
  assert.equal(denied.status, 401);
  checks.push("unauthorized-probe-rejected");
  await probe(503, "DATABASE_SCHEMA_UNAVAILABLE");
  checks.push("empty-schema-rejected");
  for (const table of [
    "users",
    "customers",
    "suppliers",
    "rfqs",
    "quotes",
    "orders",
  ]) {
    await admin.query(`CREATE TABLE public.${table} (id text)`);
    await admin.query(`GRANT SELECT ON public.${table} TO rafraf_api_probe`);
  }
  await admin.query("INSERT INTO users VALUES ('synthetic-private-customer')");
  await probe(200, "DATABASE_CORE_SCHEMA_READY");
  checks.push("read-only-role-core-schema-ready");
  await assert.rejects(
    readOnly.query("INSERT INTO users VALUES ('must-not-write')"),
    { code: "42501" },
  );
  checks.push("probe-role-cannot-insert");
  await admin.query("REVOKE SELECT ON users FROM rafraf_api_probe");
  await probe(503, "DATABASE_SCHEMA_UNAVAILABLE");
  checks.push("revoked-access-rejected");
  await admin.query("GRANT SELECT ON users TO rafraf_api_probe");
  await probe(200, "DATABASE_CORE_SCHEMA_READY");
  checks.push("recovered-access-ready");
  await admin.query("DROP TABLE orders");
  await probe(503, "DATABASE_SCHEMA_UNAVAILABLE");
  checks.push("missing-core-table-rejected");
  const liveness = await fetch(`${origin}/api/liveness`);
  assert.equal(liveness.status, 200);
  checks.push("liveness-independent-from-database-readiness");
  console.log(
    JSON.stringify({
      passed: true,
      checks,
      database: "disposable-local-postgresql-17",
      productionAccess: false,
      providerRequests: false,
    }),
  );
} finally {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([serverExit, delay(3000)]);
    if (server.exitCode === null && server.signalCode === null)
      server.kill("SIGKILL");
  }
  await readOnly?.end();
  await admin?.end();
  if (owned) docker(["rm", "--force", container]);
}
