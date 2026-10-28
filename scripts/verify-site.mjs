import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const applications = {
  "rfrf.net": "customer",
  "supplier.rfrf.net": "supplier",
  "admin.rfrf.net": "admin",
  "api.rfrf.net": "api",
};
const site = process.argv[2];
if (!Object.hasOwn(applications, site ?? ""))
  throw new Error("Pass a Rafraf site directory name.");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cwd = join(root, "sites", site);
const directory = join(root, "outputs", "verification", site);
mkdirSync(directory, { recursive: true });
for (const candidate of [
  root,
  cwd,
  join(cwd, "apps", applications[site]),
  ...(site === "api.rfrf.net" ? [] : [join(cwd, "packages/db")]),
]) {
  if (
    readdirSync(candidate).some(
      (name) => /^\.env(?:\.|$)/.test(name) && name !== ".env.example",
    )
  ) {
    throw new Error(
      "Run verification in a clean checkout without private environment files.",
    );
  }
}

// Never inherit database, authentication, payment, shipping or AI credentials.
// Test files use synthetic adapters; Prisma generation does not connect to a DB.
const env = {
  CI: "true",
  NEXT_TELEMETRY_DISABLED: "1",
  TURBO_TELEMETRY_DISABLED: "1",
  CHECKPOINT_DISABLE: "1",
};
for (const key of [
  "PATH",
  "HOME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
]) {
  if (process.env[key]) env[key] = process.env[key];
}
const version = spawnSync("pnpm", ["--version"], {
  cwd,
  env,
  encoding: "utf8",
});
if (version.status !== 0 || version.stdout.trim() !== "11.6.0") {
  throw new Error("Verification requires exact pnpm 11.6.0 on PATH.");
}
if (Number(process.versions.node.split(".")[0]) !== 24)
  throw new Error("Verification requires Node.js 24.");

const phases = [
  ...(site === "api.rfrf.net"
    ? []
    : [["generate", "pnpm", ["--filter", "@rafraf/db", "generate"]]]),
  ["types", "pnpm", ["check-types"]],
  ["lint", "pnpm", ["lint"]],
  ["tests", "pnpm", ["test"]],
  [
    "deployment-tests",
    process.execPath,
    [
      "--test",
      ...readdirSync(join(cwd, "scripts"))
        .filter((name) => name.endsWith(".test.mjs"))
        .map((name) => `scripts/${name}`),
    ],
  ],
  ...(site === "api.rfrf.net"
    ? [["api-e2e", "pnpm", ["--filter", "api", "test:e2e", "--runInBand"]]]
    : []),
  ["build", "pnpm", ["build"]],
  [
    "runtime",
    process.execPath,
    [join(root, "scripts/qa-hostinger-runtime.mjs"), site],
  ],
];
const results = [];
for (const [name, command, args] of phases) {
  const startedAt = new Date().toISOString();
  if (
    name === "runtime" &&
    results.find((result) => result.name === "build")?.status !== "passed"
  ) {
    results.push({
      name,
      status: "blocked",
      reason: "Build failed; do not test a stale runtime.",
    });
    continue;
  }
  console.log(`[${site}] ${name}`);
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 20 * 60 * 1000,
    shell: false,
  });
  writeFileSync(
    join(directory, `${name}.log`),
    (result.stdout ?? "") + (result.stderr ?? ""),
  );
  results.push({
    name,
    startedAt,
    finishedAt: new Date().toISOString(),
    status: result.status === 0 ? "passed" : "failed",
    exitCode: result.status,
    signal: result.signal,
    errorCode: result.error?.code,
  });
  writeFileSync(
    join(directory, "report.json"),
    JSON.stringify(
      {
        site,
        node: process.versions.node,
        pnpm: "11.6.0",
        productionCredentials: false,
        results,
      },
      null,
      2,
    ) + "\n",
  );
}
console.log(JSON.stringify({ site, results }, null, 2));
if (results.some((result) => result.status !== "passed")) process.exitCode = 1;
