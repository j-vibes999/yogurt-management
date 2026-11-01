#!/usr/bin/env node
/**
 * Packaged-native backend acceptance against a wholly synthetic PostgreSQL cluster.
 * No dotenv loader, existing database URL, seed/reset command, or live fixture is used.
 * Run only while port 43188 is available; this script owns and cleans every process it starts.
 *   node tests/native-backend-e2e.mjs [path/to/Yogurt Manager Native.app]
 */
import { spawn } from "node:child_process";
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual, promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const origin = "http://127.0.0.1:43188";
const scrypt = promisify(scryptCallback);
const args = process.argv.slice(2);
const setupOnly = args.includes("--check-setup");
const uiFixture = args.includes("--ui-fixture");
// --swift-engine=<YogurtNative binary> drives the in-process Swift engine over its verification
// stdio frames instead of the packaged Node backend. --parity also starts the packaged Node
// backend against the same scratch database and compares every native read response.
const swiftEngine = args.find(value => value.startsWith("--swift-engine="))?.slice("--swift-engine=".length);
const parity = args.includes("--parity");
const appArgument = args.find(value => !value.startsWith("--"));
// The packaged Node backend (parity oracle) is built by scripts/build-native-legacy.mjs.
const application = path.resolve(repository, appArgument ?? "dist-native-legacy/Yogurt Manager Native.app");
const defaultBackend = swiftEngine ? "swift" : "node";
let engine, engineClosed, engineProtocolError, engineText = "", engineSequence = 0;
const enginePending = new Map();
const parityDifferences = [];
let parityCompared = 0;
const controller = new AbortController();
const runningTools = new Set();
let stage = "setup", checks = 0, requests = 0, supervisor, supervisorClosed, heartbeat;
let scratch, pgBin, pgStartAttempted = false, client, databaseURL, config, capability;
let closing = false, cleanupPromise, interrupted = false, supervisorProtocolError;
const identities = {};

class CheckFailure extends Error { constructor(label) { super(label); this.name = "CheckFailure"; } }
function check(label, condition) { if (!condition) throw new CheckFailure(label); checks += 1; }
function equal(label, actual, expected) { check(label, Object.is(actual, expected)); }
function same(label, actual, expected) { check(label, isDeepStrictEqual(actual, expected)); }
const minimalEnvironment = () => Object.fromEntries(["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"].filter(key => process.env[key]).map(key => [key, process.env[key]]));

async function executable(name) {
  const directories = [...(process.env.PATH ?? "").split(path.delimiter), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
  for (const directory of directories) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    try { await fs.access(candidate, constants.X_OK); return fs.realpath(candidate); } catch { /* Try the next installed tool. */ }
  }
  throw new CheckFailure(`missing-tool-${name}`);
}
async function runTool(file, values, options = {}) {
  if (controller.signal.aborted && !options.cleanup) throw new CheckFailure("interrupted");
  return new Promise((resolve, reject) => {
    const child = spawn(file, values, { cwd: scratch ?? repository, env: minimalEnvironment(), stdio: ["ignore", "pipe", "pipe"], ...options });
    runningTools.add(child);
    // Never echo subprocess diagnostics: database/client failures may contain configuration.
    child.stdout.resume(); child.stderr.resume();
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new CheckFailure("tool-deadline")); }, options.timeout ?? 120000);
    child.once("error", () => { clearTimeout(timer); runningTools.delete(child); reject(new CheckFailure("tool-start-failed")); });
    child.once("close", code => {
      clearTimeout(timer); runningTools.delete(child);
      if (code === 0 || options.allowFailure) resolve(code); else reject(new CheckFailure("tool-exit-failed"));
    });
  });
}
async function availablePort(preferred = 0) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new CheckFailure(preferred ? "native-port-in-use" : "postgres-port-unavailable")));
    server.listen({ host: "127.0.0.1", port: preferred, exclusive: true }, () => {
      const port = server.address().port; server.close(error => error ? reject(new CheckFailure("port-release-failed")) : resolve(port));
    });
  });
}
async function setup() {
  config = {};
  if (swiftEngine) {
    config.swift = await fs.realpath(path.resolve(repository, swiftEngine)).catch(() => { throw new CheckFailure("swift-engine-missing"); });
    await fs.access(config.swift, constants.X_OK).catch(() => { throw new CheckFailure("swift-engine-not-executable"); });
  }
  if (!swiftEngine || parity) {
    const appRoot = await fs.realpath(application).catch(() => { throw new CheckFailure("packaged-app-missing"); });
    const binary = path.join(appRoot, "Contents/Helpers/yogurt-supervisor");
    const node = path.join(appRoot, "Contents/Resources/runtime/node");
    const bootstrap = path.join(appRoot, "Contents/Resources/runtime/bootstrap.cjs");
    const backend = path.join(appRoot, "Contents/Resources/backend");
    for (const item of [binary, node]) await fs.access(item, constants.X_OK).catch(() => { throw new CheckFailure("packaged-executable-missing"); });
    for (const item of [bootstrap, path.join(backend, ".next/required-server-files.json"), path.join(backend, "desktop/backend.cjs")]) await fs.access(item).catch(() => { throw new CheckFailure("packaged-backend-missing"); });
    Object.assign(config, { binary, node, bootstrap, backend });
  }
  pgBin = path.dirname(await executable("initdb"));
  for (const name of ["pg_ctl", "createdb"]) await fs.access(path.join(pgBin, name), constants.X_OK).catch(() => { throw new CheckFailure("postgres-toolset-incomplete"); });
  await fs.access(path.join(repository, "node_modules/prisma/build/index.js"));
  if (setupOnly) { console.log("Native backend setup: packaged artifacts and PostgreSQL tools available; processes started=0"); return; }

  if (!uiFixture && config.binary) await availablePort(43188);
  const temporary = await fs.realpath(os.tmpdir());
  scratch = await fs.mkdtemp(path.join(temporary, "yogurt-native-e2e-"));
  await fs.chmod(scratch, 0o700);
  check("scratch-root-resolves-without-symlinks", await fs.realpath(scratch) === scratch);
  equal("scratch-root-is-direct-child-of-canonical-temp", path.dirname(scratch), temporary);
  equal("scratch-root-is-private", (await fs.stat(scratch)).mode & 0o777, 0o700);
  const cluster = path.join(scratch, "postgres");
  const password = randomBytes(32).toString("base64url");
  const user = "yogurt_native_e2e";
  const port = await availablePort();
  const database = `yogurt_e2e_native_${randomBytes(8).toString("hex")}`;
  const passwordFile = path.join(scratch, "postgres-password");
  const pgpass = path.join(scratch, "pgpass");
  await fs.writeFile(passwordFile, password, { mode: 0o600, flag: "wx" });
  await fs.writeFile(pgpass, `127.0.0.1:${port}:*:${user}:${password}\n`, { mode: 0o600, flag: "wx" });
  stage = "initialize-isolated-postgres";
  await runTool(path.join(pgBin, "initdb"), ["-D", cluster, "--username", user, "--auth-local=reject", "--auth-host=scram-sha-256", "--pwfile", passwordFile, "--encoding=UTF8", "--no-locale"]);
  await fs.appendFile(path.join(cluster, "postgresql.conf"), `\nlisten_addresses = '127.0.0.1'\nport = ${port}\nunix_socket_directories = ''\nmax_connections = 30\nshared_buffers = '32MB'\nlog_statement = 'none'\nlog_min_error_statement = 'panic'\n`);
  stage = "start-isolated-postgres"; pgStartAttempted = true;
  await runTool(path.join(pgBin, "pg_ctl"), ["-D", cluster, "-l", path.join(scratch, "postgres.log"), "-w", "-t", "20", "start"]);
  await runTool(path.join(pgBin, "createdb"), ["-h", "127.0.0.1", "-p", String(port), "-U", user, database], { env: { ...minimalEnvironment(), PGPASSFILE: pgpass } });
  const databaseURI = new URL(`postgresql://${user}@127.0.0.1:${port}/${database}`);
  databaseURI.password = password;
  databaseURI.search = "sslmode=disable&connection_limit=5&connect_timeout=5&pool_timeout=15";
  databaseURL = databaseURI.toString();
  check("database-target-is-fresh-loopback-scratch", databaseURI.hostname === "127.0.0.1" && /^\/yogurt_e2e_native_[a-f0-9]+$/.test(databaseURI.pathname));

  // Prisma's generated client can load its generator's .env paths. Generate an
  // isolated client from the copied schema so repository/private files are never discovered.
  stage = "create-isolated-prisma-schema";
  await fs.writeFile(path.join(scratch, "package.json"), JSON.stringify({ name: "yogurt-native-e2e", private: true, dependencies: { prisma: "6.16.2", "@prisma/client": "6.16.2" } }), { mode: 0o600 });
  await fs.mkdir(path.join(scratch, "node_modules"));
  await fs.symlink(path.join(repository, "node_modules/@prisma"), path.join(scratch, "node_modules/@prisma"), "dir");
  await fs.symlink(path.join(repository, "node_modules/prisma"), path.join(scratch, "node_modules/prisma"), "dir");
  const schema = (await fs.readFile(path.join(repository, "prisma/schema.prisma"), "utf8")).replace('provider = "prisma-client-js"', 'provider = "prisma-client-js"\n  output = "./client"');
  check("isolated-prisma-output-is-explicit", schema.includes('output = "./client"'));
  const schemaPath = path.join(scratch, "schema.prisma");
  await fs.writeFile(schemaPath, schema, { mode: 0o600 });
  const prismaEnvironment = { ...minimalEnvironment(), DATABASE_URL: databaseURL, PRISMA_GENERATE_SKIP_AUTOINSTALL: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1", CHECKPOINT_DISABLE: "1" };
  const cli = path.join(repository, "node_modules/prisma/build/index.js");
  await runTool(process.execPath, [cli, "db", "push", "--schema", schemaPath, "--skip-generate"], { env: prismaEnvironment });
  await runTool(process.execPath, [cli, "generate", "--schema", schemaPath, "--no-hints"], { env: prismaEnvironment });
  const generated = await import(pathToFileURL(path.join(scratch, "client/index.js")).href);
  const { PrismaClient } = generated.default ?? generated;
  client = new PrismaClient({ datasourceUrl: databaseURL, log: [] });
  const current = await client.$queryRaw`SELECT current_database() AS name, host(inet_server_addr()) AS host, current_setting('unix_socket_directories') AS sockets`;
  equal("connected-to-generated-scratch-database", current[0].name, database);
  equal("postgres-is-loopback-only", current[0].host, "127.0.0.1");
  equal("postgres-unix-sockets-disabled", current[0].sockets, "");
}

async function fixtures() {
  stage = "synthetic-fixtures";
  for (const role of ["admin", "production", "driver"]) {
    const password = randomBytes(32).toString("base64url");
    const salt = randomBytes(16);
    const hash = await scrypt(password, salt, 64);
    const row = await client.user.create({ data: { email: `${role}@native-e2e.invalid`, fullName: `ທົດສອບ ${role}`, role, passwordHash: `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}` } });
    identities[role] = { row, password };
  }
  const milk = await client.rawMaterial.create({ data: { code: "NATIVE-MILK", name: "ນົມທົດສອບ", category: "ingredient", unit: "L", currentStock: "100.123456", minStockAlert: "3.125", avgCostPerUnit: "12.3456" } });
  const cups = await client.rawMaterial.create({ data: { code: "NATIVE-CUPS", name: "ຖ້ວຍທົດສອບ", category: "packaging", unit: "ອັນ", currentStock: "1000.000001", minStockAlert: "20.125", avgCostPerUnit: "0.1250" } });
  const product = await client.finishedProduct.create({ data: { code: "NATIVE-YG", name: "ໂຢເກີດທົດສອບ", retailPrice: "100.25", shelfLifeDays: 21, recipes: { create: { name: "ສູດທົດສອບ", version: 1, baseCups: 100, isDefault: true, items: { create: [{ rawMaterialId: milk.id, quantityRequired: "2.5000" }, { rawMaterialId: cups.id, quantityRequired: "100.0000" }] } } } }, include: { recipes: true } });
  const store = await client.store.create({ data: { name: "ຮ້ານທົດສອບ", commissionRate: "0.3000", monthlyElectricity: "12345.67", latitude: "17.9757", longitude: "102.6331", phone: "0000000000", fridge: { create: { assetCode: "NATIVE-FRIDGE", capacityCups: 100 } } }, include: { fridge: true } });
  await client.fridgeInventory.create({ data: { storeId: store.id, fridgeId: store.fridge.id, finishedProductId: product.id, currentStock: 0 } });
  const expense = await client.expense.create({ data: { category: "ຄ່າທົດສອບ", amount: "1234567890.25", incurredAt: new Date("2199-12-30T00:00:00.000Z"), storeId: store.id, note: "synthetic native acceptance" } });
  await client.expenseCategory.create({ data: { name: "ຄ່າທົດສອບ" } });
  await client.auditLog.create({ data: { userId: identities.admin.row.id, action: "update", entityType: "fixture", summary: "native-safe-metadata", metadata: { before: { name: "before", passwordHash: "PROHIBITED-NATIVE-PROJECTION" }, after: { name: "after", sessionToken: "PROHIBITED-NATIVE-PROJECTION", nested: { databaseUrl: "PROHIBITED-NATIVE-PROJECTION" } } } } });
  return { milk, cups, product, store, expense };
}

async function startBackend() {
  const dataRoot = path.join(scratch, "runtime"); await fs.mkdir(dataRoot, { mode: 0o700 });
  capability = randomBytes(48).toString("base64url");
  // Both backends share one secret, so a cookie from either login is valid on the other.
  const secret = randomBytes(48).toString("base64url");
  if (swiftEngine) await startSwiftEngine(dataRoot, secret);
  if (config.binary) await startNodeBackend(dataRoot, secret);
}

async function startSwiftEngine(dataRoot, secret) {
  stage = "swift-engine-start";
  engine = spawn(config.swift, ["--yogurt-engine-stdio"], { cwd: scratch, env: minimalEnvironment(), stdio: ["pipe", "pipe", "pipe"] });
  engineClosed = new Promise(resolve => engine.once("close", (code, signal) => resolve({ code, signal })));
  engine.stdin.on("error", () => {}); engine.stderr.resume();
  let ready = false;
  const started = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new CheckFailure("swift-engine-start-deadline")), 60000);
    engine.once("error", () => { clearTimeout(timer); reject(new CheckFailure("swift-engine-spawn-failed")); });
    engine.once("exit", () => {
      clearTimeout(timer); if (!ready) reject(new CheckFailure("swift-engine-exited-before-ready"));
      for (const pending of enginePending.values()) pending.reject(new CheckFailure("swift-engine-exited"));
      enginePending.clear();
    });
    engine.stdout.on("data", bytes => {
      engineText += bytes.toString("utf8");
      let end;
      while ((end = engineText.indexOf("\n")) >= 0) {
        const line = engineText.slice(0, end); engineText = engineText.slice(end + 1);
        let frame;
        try { frame = JSON.parse(line); } catch { engineProtocolError = true; reject(new CheckFailure("swift-engine-protocol-json")); return; }
        if (frame.version !== 1) { engineProtocolError = true; return; }
        if (frame.type === "ready") { ready = true; clearTimeout(timer); resolve(); }
        else if (frame.type === "failed") { engineProtocolError = true; clearTimeout(timer); reject(new CheckFailure(`swift-engine-failed-${frame.code}`)); }
        else if (frame.type === "response") {
          const pending = enginePending.get(frame.id);
          if (!pending) { engineProtocolError = true; continue; }
          enginePending.delete(frame.id); pending.resolve(frame);
        }
      }
    });
  });
  engine.stdin.write(`${JSON.stringify({ version: 1, type: "bootstrap", dataRoot, capability, config: { DATABASE_URL: databaseURL, SESSION_SECRET: secret } })}\n`);
  await started;
}

async function engineRequest(method, route, headers, payload, signal) {
  let body = Buffer.alloc(0);
  if (payload instanceof FormData) {
    // Serialize the multipart body exactly as fetch would send it.
    const encoded = new Request("http://engine.invalid/", { method: "POST", body: payload });
    body = Buffer.from(await encoded.arrayBuffer()); headers["content-type"] = encoded.headers.get("content-type");
  } else if (payload !== undefined) body = Buffer.from(payload);
  const id = `r${++engineSequence}`;
  const frame = await new Promise((resolve, reject) => {
    const abort = () => { enginePending.delete(id); reject(new CheckFailure("swift-engine-request-deadline")); };
    signal.addEventListener("abort", abort, { once: true });
    enginePending.set(id, { resolve: value => { signal.removeEventListener("abort", abort); resolve(value); }, reject });
    engine.stdin.write(`${JSON.stringify({ version: 1, type: "request", id, method, path: route, headers, body: body.toString("base64") })}\n`);
  });
  return { status: frame.status, headers: new Headers(frame.headers), bytes: Buffer.from(frame.body, "base64") };
}

async function startNodeBackend(dataRoot, secret) {
  stage = "packaged-supervisor-start";
  supervisor = spawn(config.binary, [config.node, config.bootstrap], { cwd: scratch, env: minimalEnvironment(), stdio: ["pipe", "pipe", "pipe"] });
  supervisorClosed = new Promise(resolve => supervisor.once("close", (code, signal) => resolve({ code, signal })));
  supervisor.stdin.on("error", () => {}); supervisor.stderr.resume();
  let text = "", ready = false;
  const started = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new CheckFailure("packaged-backend-start-deadline")), 60000);
    supervisor.once("error", () => { clearTimeout(timer); reject(new CheckFailure("supervisor-spawn-failed")); });
    supervisor.once("exit", () => { clearTimeout(timer); if (!ready) reject(new CheckFailure("supervisor-exited-before-ready")); });
    supervisor.stdout.on("data", bytes => {
      text += bytes.toString("utf8");
      if (Buffer.byteLength(text) > 65536) { supervisorProtocolError = true; reject(new CheckFailure("supervisor-protocol-size")); return; }
      let end;
      while ((end = text.indexOf("\n")) >= 0) {
        const line = text.slice(0, end); text = text.slice(end + 1);
        let event;
        try { event = JSON.parse(line); } catch { supervisorProtocolError = true; reject(new CheckFailure("supervisor-protocol-json")); return; }
        if (event.version !== 1 || !["ready", "failed", "shutdown"].includes(event.type) || Object.keys(event).some(key => !["version", "type", "code"].includes(key))) { supervisorProtocolError = true; reject(new CheckFailure("supervisor-protocol-frame")); return; }
        if (event.type === "ready") { ready = true; clearTimeout(timer); resolve(); }
        if (event.type === "failed") { supervisorProtocolError = true; clearTimeout(timer); reject(new CheckFailure("packaged-backend-canonical-failure")); }
      }
    });
  });
  supervisor.stdin.write(`${JSON.stringify({ version: 1, type: "bootstrap", port: 43188, appRoot: config.backend, dataRoot, capability, config: { DATABASE_URL: databaseURL, SESSION_SECRET: secret } })}\n`);
  heartbeat = setInterval(() => { if (!supervisor.stdin.destroyed && supervisor.exitCode === null) supervisor.stdin.write('{"version":1,"type":"heartbeat"}\n'); }, 2000);
  await started;
  check("supervisor-protocol-is-canonical", !supervisorProtocolError);
}

async function request(route, { role = "admin", method = "GET", body, key, headers = {}, capabilityHeader = true, discard = false, backend = defaultBackend } = {}) {
  check("request-route-is-local-api", route.startsWith("/api/") || route === "/_desktop/ready");
  if (supervisorProtocolError || engineProtocolError) throw new CheckFailure("supervisor-failed-during-requests");
  if (controller.signal.aborted) throw new CheckFailure("interrupted");
  const identity = role ? identities[role] : undefined;
  const requestHeaders = {
    ...(capabilityHeader ? { "x-yogurt-desktop-token": capability } : {}),
    ...(identity?.cookie ? { cookie: identity.cookie } : {}),
    ...(identity?.row && method !== "GET" && method !== "HEAD" ? { "X-Operation-User": identity.row.id } : {}),
    ...(key ? { "Idempotency-Key": key } : {}), ...headers,
  };
  let payload;
  if (body !== undefined) {
    if (body instanceof FormData) payload = body;
    else { requestHeaders["content-type"] = "application/json"; payload = JSON.stringify(body); }
  }
  requests += 1;
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]);
  if (backend === "swift") {
    const response = await engineRequest(method, route, requestHeaders, payload, signal);
    if (discard) return { status: response.status };
    let data = null;
    try { data = response.bytes.length ? JSON.parse(response.bytes.toString("utf8")) : null; } catch { /* Binary receipt or protected plain response. */ }
    return { status: response.status, data, bytes: response.bytes, headers: response.headers };
  }
  const response = await fetch(new URL(route, origin), { method, headers: requestHeaders, body: payload, redirect: "manual", signal });
  if (discard) { await response.body?.cancel(); return { status: response.status }; }
  const bytes = Buffer.from(await response.arrayBuffer());
  let data = null;
  try { data = bytes.length ? JSON.parse(bytes.toString("utf8")) : null; } catch { /* Binary receipt or protected plain response. */ }
  return { status: response.status, data, bytes, headers: response.headers };
}
async function mutation(route, body, options = {}) { return request(route, { method: "POST", key: randomUUID(), body, ...options }); }
async function native(resource, query = {}, role = "admin") {
  const parameters = new URLSearchParams(query).toString();
  const response = await request(`/api/native/v1/${resource}${parameters ? `?${parameters}` : ""}`, { role });
  equal(`native-${resource}-status`, response.status, 200);
  equal(`native-${resource}-version`, response.data?.version, 1);
  equal(`native-${resource}-resource`, response.data?.resource, resource);
  equal(`native-${resource}-source`, response.data?.source, "database");
  check(`native-${resource}-timestamp`, Number.isFinite(Date.parse(response.data?.generatedAt)));
  check(`native-${resource}-credential-projection`, !JSON.stringify(response.data).includes("PROHIBITED-NATIVE-PROJECTION") && !/"(?:passwordHash|sessionSecret|databaseUrl|sessionToken)"/i.test(JSON.stringify(response.data)));
  return response.data.data;
}
async function loginRoles() {
  stage = "native-authentication";
  equal("capability-is-required", (await request("/_desktop/ready", { capabilityHeader: false, role: null })).status, 403);
  equal("session-is-required", (await request("/api/native/v1/overview", { role: null })).status, 401);
  for (const role of Object.keys(identities)) {
    const identity = identities[role];
    const response = await request("/api/auth/login", { method: "POST", role: null, body: { email: identity.row.email, password: identity.password } });
    equal(`login-${role}`, response.status, 200);
    const setCookie = response.headers.get("set-cookie") ?? "";
    check(`secure-cookie-${role}`, /^yogurt_session=/.test(setCookie) && /;\s*HttpOnly(?:;|$)/i.test(setCookie) && /;\s*Secure(?:;|$)/i.test(setCookie) && /;\s*SameSite=Strict(?:;|$)/i.test(setCookie));
    identity.cookie = setCookie.split(";")[0];
    const session = await request("/api/session", { role });
    equal(`session-role-${role}`, session.data?.role, role);
    equal(`session-user-${role}`, session.data?.userId, identity.row.id);
  }
}

async function nativeReads(fixture) {
  stage = "native-read-authorization-and-projections";
  const resources = {
    overview: {}, stores: {}, store: { id: fixture.store.id }, map: {}, refills: {}, restock: { id: fixture.store.id },
    inventory: {}, production: {}, settlements: { filter: "all", page: "1" }, expenses: { page: "1" }, expense: { id: fixture.expense.id },
    reports: { period: "today" }, notifications: {}, operations: {}, fridges: {}, audit: { page: "1" }, catalog: {}, closing: { date: "2199-12-31" },
  };
  const allowed = {
    production: new Set(["overview", "stores", "store", "map", "refills", "inventory", "production", "notifications", "catalog"]),
    driver: new Set(["overview", "stores", "store", "map", "refills", "restock", "settlements", "notifications", "catalog"]),
  };
  for (const [resource, query] of Object.entries(resources)) {
    await native(resource, query);
    for (const role of ["production", "driver"]) {
      if (allowed[role].has(resource)) await native(resource, query, role);
      else {
        const parameters = new URLSearchParams(query).toString();
        equal(`denied-${role}-${resource}`, (await request(`/api/native/v1/${resource}${parameters ? `?${parameters}` : ""}`, { role })).status, 403);
      }
    }
  }
  const inventory = await native("inventory");
  const raw = inventory.rawMaterials.find(item => item.id === fixture.milk.id);
  same("raw-material-decimal-strings", [raw.currentStock, raw.minStockAlert, raw.avgCostPerUnit], ["100.123456", "3.125", "12.3456"]);
  const expense = (await native("expense", { id: fixture.expense.id })).expense;
  equal("expense-edit-money-is-exact", expense.amount, "1234567890.25");
  same("expense-compare-snapshot-is-original", expense.expectedExpenseSnapshot, { category: expense.category, amount: expense.amount, incurredAt: expense.incurredAt, storeId: expense.storeId, note: expense.note, receiptUrl: expense.receiptUrl });
  const quote = (await native("restock", { id: fixture.store.id }, "driver")).data;
  equal("restock-money-is-string", typeof quote.previousBalance, "string");
  equal("restock-rate-is-string", quote.store.commissionRate, "0.3");
  same("restock-financial-snapshot-is-exact", quote.expectedFinancialSnapshot, { previousBalance: "0", commissionRate: "0.3", retailPrices: [{ productId: fixture.product.id, retailPrice: "100.25" }] });
  const driverCatalog = await native("catalog", {}, "driver");
  same("driver-has-no-materials", driverCatalog.materials, []); same("driver-has-no-recipes", driverCatalog.recipes, []); same("driver-has-no-finance-categories", driverCatalog.categories, []);
  const driverOverview = await native("overview", {}, "driver");
  same("driver-overview-has-no-material-cost", driverOverview.dashboard.lowMaterials, []);
  equal("driver-overview-has-no-owner-net", driverOverview.dashboard.ownerNet, 0);
  const productionOverview = await native("overview", {}, "production");
  same("production-overview-has-no-settlement-rows", productionOverview.dashboard.settlements, []);
  equal("production-overview-has-no-receivables", productionOverview.dashboard.outstanding, 0);
  const reports = await native("reports", { period: "month" });
  equal("report-range-time-zone", reports.range.timeZone, "Asia/Vientiane");
  check("report-range-is-exclusive-and-ordered", Date.parse(reports.range.from) < Date.parse(reports.range.to));
  const missing = await request("/api/native/v1/no-such-resource"); equal("unknown-native-resource", missing.status, 404);
  for (const route of ["/api/native/v1/inventory?id=bad", "/api/native/v1/store", "/api/native/v1/audit?page=0", "/api/native/v1/closing?date=2199-02-30", "/api/native/v1/expenses?page=1&page=2"]) equal("invalid-native-query-is-rejected", (await request(route)).status, 400);
  equal("production-cannot-create-refills", (await mutation("/api/refills", { storeId: fixture.store.id, items: [{ finishedProductId: fixture.product.id, quantity: 1 }] }, { role: "production" })).status, 403);
  equal("driver-cannot-adjust-materials", (await mutation("/api/inventory/adjust", { rawMaterialId: fixture.milk.id, quantityDelta: "1", reason: "test" }, { role: "driver" })).status, 403);
  equal("operation-account-mismatch-is-rejected", (await mutation("/api/expenses", { category: "other", amount: "1.00" }, { headers: { "X-Operation-User": identities.driver.row.id } })).status, 409);
}

/** Parity mode: every native read, session and nav-count response must match the Node oracle field by field. */
async function compareReads(label, fixture) {
  if (!parity) return;
  stage = `read-parity-${label}`;
  const resources = {
    overview: {}, stores: {}, store: { id: fixture.store.id }, map: {}, refills: {}, restock: { id: fixture.store.id },
    inventory: {}, production: {}, settlements: { filter: "all", page: "1" }, expenses: { page: "1" }, expense: { id: fixture.expense.id },
    reports: { period: "today" }, notifications: {}, operations: {}, fridges: {}, audit: { page: "1" }, catalog: {}, closing: { date: "2199-12-31" },
  };
  const differences = (left, right, at, found) => {
    if (found.length >= 40) return;
    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length !== right.length) found.push(`${at}: length ${left.length} != ${right.length}`);
      for (let index = 0; index < Math.min(left.length, right.length); index += 1) differences(left[index], right[index], `${at}[${index}]`, found);
    } else if (left && right && typeof left === "object" && typeof right === "object" && !Array.isArray(left) && !Array.isArray(right)) {
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
        if (!(key in right)) found.push(`${at}.${key}: missing in swift (node=${JSON.stringify(left[key])?.slice(0, 120)})`);
        else if (!(key in left)) found.push(`${at}.${key}: extra in swift (swift=${JSON.stringify(right[key])?.slice(0, 120)})`);
        else differences(left[key], right[key], `${at}.${key}`, found);
      }
    } else if (!Object.is(left, right)) found.push(`${at}: node=${JSON.stringify(left)?.slice(0, 160)} swift=${JSON.stringify(right)?.slice(0, 160)}`);
  };
  const compare = async (route, role) => {
    const [node, swift] = [await request(route, { role, backend: "node" }), await request(route, { role, backend: "swift" })];
    const found = [];
    if (node.status !== swift.status) found.push(`status node=${node.status} swift=${swift.status}`);
    else if (node.status === 200) {
      const strip = value => value && typeof value === "object" && "generatedAt" in value ? { ...value, generatedAt: "<time>" } : value;
      differences(strip(node.data), strip(swift.data), "$", found);
    }
    if (node.status === 200 && !found.length) parityCompared += 1;
    for (const item of found) parityDifferences.push(`${label} ${role} ${route} ${item}`);
  };
  for (const role of ["admin", "production", "driver"]) {
    await compare("/api/session", role);
    await compare("/api/nav-counts", role);
    for (const [resource, query] of Object.entries(resources)) {
      const parameters = new URLSearchParams(query).toString();
      await compare(`/api/native/v1/${resource}${parameters ? `?${parameters}` : ""}`, role);
    }
  }
  check(`read-parity-${label}-collected`, true);
}

async function replay(route, body, { role = "admin", method = "POST", status = 201 } = {}) {
  const key = randomUUID();
  const first = await mutation(route, body, { role, method, key });
  equal("durable-mutation-accepted", first.status, status);
  const again = await mutation(route, body, { role, method, key });
  equal("durable-replay-status", again.status, status);
  same("durable-replay-result", again.data, first.data);
  return { ...first, key };
}

async function stockWorkflows(fixture) {
  stage = "stock-receive-production-and-delivery";
  const received = await replay("/api/inventory/receive", { supplierName: "native synthetic supplier", rawMaterialId: fixture.milk.id, quantity: "2.500000", unitPrice: "12.3456", note: "synthetic acceptance" }, { role: "production" });
  equal("receive-single-purchase", await client.purchaseOrder.count({ where: { id: received.data.id } }), 1);
  equal("receive-exact-stock", (await client.rawMaterial.findUniqueOrThrow({ where: { id: fixture.milk.id } })).currentStock.toString(), "102.623456");
  equal("receive-payload-conflict", (await mutation("/api/inventory/receive", { supplierName: "native synthetic supplier", rawMaterialId: fixture.milk.id, quantity: "3", unitPrice: "12.3456", note: "synthetic acceptance" }, { role: "production", key: received.key })).status, 409);

  await replay("/api/inventory/adjust", { rawMaterialId: fixture.milk.id, quantityDelta: "0.000001", reason: "synthetic precise adjustment" }, { role: "production" });
  equal("adjust-exact-six-digit-stock", (await client.rawMaterial.findUniqueOrThrow({ where: { id: fixture.milk.id } })).currentStock.toString(), "102.623457");
  equal("negative-stock-rejected", (await mutation("/api/inventory/adjust", { rawMaterialId: fixture.milk.id, quantityDelta: "-1000", reason: "synthetic rejected adjustment" })).status, 409);
  equal("stale-absolute-stock-rejected", (await mutation("/api/inventory/adjust", { action: "update_material", rawMaterialId: fixture.milk.id, stock: "99", expectedStock: "100.123456", stockReason: "synthetic stale edit" })).status, 409);

  const produced = await replay("/api/production-batches", { productId: fixture.product.id, cups: 20 }, { role: "production" });
  const batch = await client.productionBatch.findUniqueOrThrow({ where: { id: produced.data.id } });
  same("production-exact-cost-and-quantity", [batch.quantityProduced, batch.quantityRemaining, batch.totalMaterialCost.toString(), batch.unitCost.toString(), batch.costKnown], [20, 20, "8.67", "0.4336", true]);
  same("production-exact-material-decrements", await Promise.all([fixture.milk, fixture.cups].map(async item => (await client.rawMaterial.findUniqueOrThrow({ where: { id: item.id } })).currentStock.toString())), ["102.123457", "980.000001"]);
  equal("production-single-audit", await client.auditLog.count({ where: { entityType: "production_batch", entityId: batch.id } }), 1);
  equal("production-key-payload-conflict", (await mutation("/api/production-batches", { productId: fixture.product.id, cups: 21 }, { role: "production", key: produced.key })).status, 409);
  equal("production-shortage-rejected", (await mutation("/api/production-batches", { productId: fixture.product.id, cups: 100000 }, { role: "production" })).status, 409);

  const refill = await replay("/api/refills", { storeId: fixture.store.id, items: [{ finishedProductId: fixture.product.id, quantity: 10 }], note: "native synthetic refill" }, { role: "driver" });
  const route = `/api/refills/${refill.data.id}`;
  equal("refill-dispatched", (await mutation(route, { status: "delivering" }, { method: "PATCH", role: "driver" })).status, 200);
  const completions = await Promise.all([0, 1].map(() => mutation(route, { status: "completed" }, { method: "PATCH", role: "driver" })));
  same("concurrent-refill-completion-status", completions.map(item => item.status), [200, 200]);
  equal("concurrent-refill-replay-detected", completions.filter(item => item.data?.alreadyApplied).length, 1);
  equal("refill-single-stock-deduction", (await client.productionBatch.findUniqueOrThrow({ where: { id: batch.id } })).quantityRemaining, 10);
  equal("refill-current-stock", (await client.fridgeInventory.findUniqueOrThrow({ where: { fridgeId_finishedProductId: { fridgeId: fixture.store.fridge.id, finishedProductId: fixture.product.id } } })).currentStock, 10);
  const lots = await client.fridgeStockLot.findMany({ where: { refillRequestId: refill.data.id } });
  same("refill-exact-stock-lot", lots.map(item => [item.quantityReceived, item.quantityRemaining, item.unitCost.toString(), item.costKnown]), [[10, 10, "0.4336", true]]);
  equal("refill-single-completion-audit", await client.auditLog.count({ where: { entityType: "refill_request", entityId: refill.data.id, action: "status" } }), 2);
  const lookup = await native("refills", { id: refill.data.id }, "driver");
  equal("completed-refill-can-be-reconciled", lookup.refills[0]?.status, "completed");
  equal("terminal-refill-transition-rejected", (await mutation(route, { status: "waiting" }, { method: "PATCH", role: "driver" })).status, 409);
  return batch;
}

async function financeWorkflows(fixture) {
  stage = "exact-restock-snapshot-and-payment-replay";
  const quote = (await native("restock", { id: fixture.store.id }, "driver")).data;
  const lines = [{ productId: fixture.product.id, previousStock: 10, countRemaining: 5, countExpiredReturned: 1, countRefilled: 10 }];
  const body = { storeId: fixture.store.id, fridgeAssetCode: fixture.store.fridge.assetCode, lines, paidAmount: "80.25", paymentMethod: "cash", expectedFinancialSnapshot: quote.expectedFinancialSnapshot };
  await client.finishedProduct.update({ where: { id: fixture.product.id }, data: { retailPrice: "100.26" } });
  equal("stale-financial-snapshot-rejected", (await mutation("/api/restock-visits", body, { role: "driver" })).status, 409);
  equal("stale-finance-makes-no-record", await client.settlement.count(), 0);
  await client.finishedProduct.update({ where: { id: fixture.product.id }, data: { retailPrice: "100.25" } });
  equal("stale-inventory-rejected", (await mutation("/api/restock-visits", { ...body, lines: [{ ...lines[0], previousStock: 9 }] }, { role: "driver" })).status, 409);
  const accepted = await replay("/api/restock-visits", body, { role: "driver" });
  const saved = await client.settlement.findUniqueOrThrow({ where: { id: accepted.data.settlementId } });
  same("restock-authoritative-money", [saved.grossAmount, saved.storeCommissionAmount, saved.netPayableAmount, saved.previousBalance, saved.paidAmount, saved.closingBalance].map(value => value.toString()), ["401", "120.3", "280.7", "0", "80.25", "200.45"]);
  equal("restock-single-audit", await client.auditLog.count({ where: { entityType: "restock_visit", entityId: accepted.data.visitId } }), 1);
  equal("restock-single-settlement", await client.settlement.count(), 1);
  const item = await client.restockVisitItem.findFirstOrThrow({ where: { restockVisitId: accepted.data.visitId } });
  same("restock-sale-expiry-and-cost", [item.unitsSold, item.countExpiredReturned, item.subtotalCost.toString(), item.expiredCost.toString()], [4, 1, "1.73", "0.43"]);
  equal("restock-payload-key-conflict", (await mutation("/api/restock-visits", { ...body, paidAmount: "80.24" }, { role: "driver", key: accepted.key })).status, 409);
  const rows = (await native("settlements", { filter: "all", page: "1" }, "driver")).settlements;
  const projected = rows.find(row => row.settlementId === saved.id);
  same("settlement-exact-native-money", [projected.grossAmount, projected.storeCommissionAmount, projected.netPayableAmount, projected.previousBalance, projected.paidAmount, projected.closingBalanceExact], ["401", "120.3", "280.7", "0", "80.25", "200.45"]);
  equal("no-invented-settlement-receipt", projected.receiptPath, null);
  const stored = await native("store", { id: fixture.store.id }, "driver");
  equal("store-exact-latest-balance", stored.latestBalance, "200.45");
  equal("overpayment-is-rejected", (await mutation("/api/settlements/pay", { storeId: fixture.store.id, paidAmount: "200.46", paymentMethod: "cash" }, { role: "driver" })).status, 400);
  const paymentBody = { storeId: fixture.store.id, paidAmount: "100.20", paymentMethod: "bank" };
  const paid = await replay("/api/settlements/pay", paymentBody, { role: "driver" });
  const payment = await client.settlement.findUniqueOrThrow({ where: { id: paid.data.settlementId } });
  same("payment-authoritative-money", [payment.previousBalance.toString(), payment.paidAmount.toString(), payment.closingBalance.toString(), payment.paymentMethod], ["200.45", "100.2", "100.25", "bank"]);
  equal("payment-single-audit", await client.auditLog.count({ where: { entityType: "settlement", entityId: payment.id } }), 1);
  equal("payment-payload-key-conflict", (await mutation("/api/settlements/pay", { ...paymentBody, paidAmount: "100.21" }, { role: "driver", key: paid.key })).status, 409);
  const competing = await Promise.all([0, 1].map(() => mutation("/api/settlements/pay", { storeId: fixture.store.id, paidAmount: "100.25", paymentMethod: "cash" }, { role: "driver" })));
  same("concurrent-full-payment-once", competing.map(value => value.status).sort(), [201, 400]);
  equal("paid-balance-never-negative", (await native("store", { id: fixture.store.id }, "driver")).latestBalance, "0");
  equal("payment-ledger-has-no-duplicates", await client.settlement.count(), 3);
}

async function receiptsAndExpenses(fixture) {
  stage = "private-receipt-and-expense-snapshots";
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/f8AAAAASUVORK5CYII=", "base64");
  const form = () => { const value = new FormData(); value.set("file", new Blob([bytes], { type: "image/png" }), "synthetic.png"); return value; };
  equal("driver-receipt-upload-forbidden", (await mutation("/api/uploads/receipts", form(), { role: "driver" })).status, 403);
  const upload = await mutation("/api/uploads/receipts", form());
  equal("receipt-upload-created", upload.status, 201);
  const receipt = upload.data?.url;
  check("receipt-private-path", typeof receipt === "string" && /^\/api\/receipts\/receipt-[a-f0-9-]+\.png$/.test(receipt));
  const download = await request(receipt);
  equal("receipt-admin-download", download.status, 200);
  check("receipt-byte-identical", download.bytes.equals(bytes));
  equal("receipt-private-cache", download.headers.get("cache-control"), "private, no-store, max-age=0");
  equal("receipt-sniffing-disabled", download.headers.get("x-content-type-options"), "nosniff");
  equal("receipt-head", (await request(receipt, { method: "HEAD" })).status, 200);
  equal("driver-receipt-download-forbidden", (await request(receipt, { role: "driver" })).status, 403);
  equal("production-receipt-download-forbidden", (await request(receipt, { role: "production" })).status, 403);
  equal("receipt-session-required", (await request(receipt, { role: null })).status, 401);
  const persisted = path.join(scratch, "runtime/private-receipts", path.basename(receipt));
  equal("receipt-file-private", (await fs.stat(persisted)).mode & 0o777, 0o600);
  equal("receipt-directory-private", (await fs.stat(path.dirname(persisted))).mode & 0o777, 0o700);
  const invalid = new FormData(); invalid.set("file", new Blob(["invalid"], { type: "image/png" }), "synthetic.png");
  equal("invalid-receipt-rejected", (await mutation("/api/uploads/receipts", invalid)).status, 400);

  const created = await replay("/api/expenses", { storeId: fixture.store.id, category: "ຄ່າທົດສອບ", amount: "1234567890.25", incurredAt: "2199-12-31", note: "synthetic acceptance", receiptUrl: receipt });
  const expense = (await native("expense", { id: created.data.id })).expense;
  equal("expense-create-exact-amount", expense.amount, "1234567890.25");
  equal("expense-preserves-private-receipt", expense.receiptUrl, receipt);
  const edit = { amount: "1234567890.26", expectedExpenseSnapshot: expense.expectedExpenseSnapshot };
  await replay(`/api/expenses/${expense.id}`, edit, { method: "PATCH", status: 200 });
  equal("stale-expense-edit-rejected", (await mutation(`/api/expenses/${expense.id}`, { ...edit, amount: "1234567890.27" }, { method: "PATCH" })).status, 409);
  equal("stale-expense-preserves-exact-amount", (await client.expense.findUniqueOrThrow({ where: { id: expense.id } })).amount.toString(), "1234567890.26");
  equal("expense-single-edit-audit", await client.auditLog.count({ where: { entityType: "expense", entityId: expense.id, action: "update" } }), 1);
  await replay(`/api/expenses/${expense.id}`, { reason: "synthetic acceptance complete" }, { method: "DELETE", status: 200 });
  equal("voided-expense-unavailable-to-editor", (await request(`/api/native/v1/expense?id=${expense.id}`)).status, 404);
  equal("expense-single-void-audit", await client.auditLog.count({ where: { entityType: "expense", entityId: expense.id, action: "void" } }), 1);
}

/** Catalog, store and fridge management used by the native app (not part of the original 626 checks). */
async function catalogWorkflows(fixture, batch) {
  stage = "catalog-store-and-fridge-management";
  const product = await replay("/api/products", { code: "NATIVE-NEW", name: "ສິນຄ້າໃໝ່ທົດສອບ", sizeDescription: "  ", retailPrice: "12.50", shelfLifeDays: 14 });
  same("product-create-view", [product.data.product.code, product.data.product.sizeDescription, product.data.product.retailPrice, product.data.product.shelfLifeDays, product.data.product.isActive], ["NATIVE-NEW", null, 12.5, 14, true]);
  equal("product-duplicate-code", (await mutation("/api/products", { code: "NATIVE-NEW", name: "x", retailPrice: "1", shelfLifeDays: 1 })).status, 409);
  equal("product-invalid-price", (await mutation("/api/products", { code: "NATIVE-BAD", name: "x", retailPrice: "1.005", shelfLifeDays: 1 })).status, 400);
  const productEdit = await replay(`/api/products/${product.data.product.id}`, { retailPrice: "13.75", isActive: false }, { method: "PATCH", status: 200 });
  same("product-update-view", [productEdit.data.product.retailPrice, productEdit.data.product.isActive], [13.75, false]);
  equal("product-update-missing", (await mutation("/api/products/no-such-product", { name: "x" }, { method: "PATCH" })).status, 404);
  equal("product-update-empty", (await mutation(`/api/products/${product.data.product.id}`, {}, { method: "PATCH" })).status, 400);
  equal("product-update-forbidden", (await mutation(`/api/products/${product.data.product.id}`, { name: "x" }, { method: "PATCH", role: "production" })).status, 403);

  const material = await replay("/api/materials", { code: "NATIVE-SUGAR", name: "ນ້ຳຕານທົດສອບ", category: "ingredient", unit: "kg", minStock: "2.125", avgCostPerUnit: "8.5" });
  same("material-create-view", [material.data.material.minStock, material.data.material.cost, material.data.material.isActive], [2.125, 8.5, true]);
  equal("material-duplicate-code", (await mutation("/api/materials", { code: "NATIVE-SUGAR", name: "x", category: "ingredient", unit: "kg" })).status, 409);
  equal("material-too-precise", (await mutation("/api/materials", { code: "NATIVE-FINE", name: "x", category: "ingredient", unit: "kg", avgCostPerUnit: "1.23456" })).status, 400);
  const materialEdit = await replay(`/api/materials/${material.data.material.id}`, { avgCostPerUnit: "9.25", minStock: 3, unit: "g" }, { method: "PATCH", status: 200 });
  same("material-update-view", [materialEdit.data.material.cost, materialEdit.data.material.minStock, materialEdit.data.material.unit], [9.25, 3, "g"]);
  equal("material-unit-in-use", (await mutation(`/api/materials/${fixture.milk.id}`, { unit: "ml" }, { method: "PATCH" })).status, 409);

  const recipe = await replay("/api/recipes", { finishedProductId: fixture.product.id, baseCups: "50", name: "ສູດໃໝ່", items: [{ rawMaterialId: fixture.milk.id, quantityRequired: "1.2500" }, { rawMaterialId: fixture.cups.id, quantityRequired: 50 }] }, { role: "production" });
  equal("recipe-new-version", recipe.data.version, 2);
  equal("recipe-single-default", await client.recipe.count({ where: { finishedProductId: fixture.product.id, isDefault: true } }), 1);
  equal("recipe-duplicate-material", (await mutation("/api/recipes", { finishedProductId: fixture.product.id, baseCups: 10, items: [{ rawMaterialId: fixture.milk.id, quantityRequired: 1 }, { rawMaterialId: fixture.milk.id, quantityRequired: 2 }] }, { role: "production" })).status, 400);
  equal("recipe-inactive-material", (await mutation("/api/recipes", { finishedProductId: fixture.product.id, baseCups: 10, items: [{ rawMaterialId: "no-such-material", quantityRequired: 1 }] }, { role: "production" })).status, 409);

  const remaining = (await client.productionBatch.findUniqueOrThrow({ where: { id: batch.id } })).quantityRemaining;
  await replay("/api/finished-goods/adjust", { batchId: batch.id, quantity: "1", reason: "damaged in storage", note: "synthetic" }, { role: "production" });
  equal("write-off-deducts-batch", (await client.productionBatch.findUniqueOrThrow({ where: { id: batch.id } })).quantityRemaining, remaining - 1);
  same("write-off-keeps-cost", (await client.finishedGoodsAdjustment.findFirstOrThrow({ where: { productionBatchId: batch.id } })).unitCost.toString(), "0.4336");
  equal("write-off-over-stock", (await mutation("/api/finished-goods/adjust", { batchId: batch.id, quantity: 100000, reason: "x" }, { role: "production" })).status, 409);
  equal("write-off-invalid", (await mutation("/api/finished-goods/adjust", { batchId: batch.id, quantity: "1.5", reason: "x" }, { role: "production" })).status, 400);

  const store = await replay("/api/stores", { name: "ຮ້ານໃໝ່ທົດສອບ", assetCode: "NATIVE-FRIDGE-2", phone: " 020 1234 ", latitude: "17.96", longitude: 102.61, commissionRate: "0.25", monthlyElectricity: "1500.5", capacityCups: "80", fridgeStartDate: "2199-01-15" });
  equal("store-create-fridge", store.data.fridge, "NATIVE-FRIDGE-2");
  const created = await client.store.findUniqueOrThrow({ where: { id: store.data.id }, include: { fridge: { include: { inventory: true } } } });
  same("store-create-exact", [created.commissionRate.toString(), created.monthlyElectricity.toString(), created.latitude.toString(), created.longitude.toString(), created.whatsapp, created.fridge.capacityCups, created.fridge.model], ["0.25", "1500.5", "17.96", "102.61", "020 1234", 80, "Yogurt Display 100"]);
  equal("store-create-inventory-rows", created.fridge.inventory.length, await client.finishedProduct.count({ where: { isActive: true } }));
  equal("store-duplicate-asset", (await mutation("/api/stores", { name: "x", assetCode: "NATIVE-FRIDGE-2" })).status, 409);
  equal("store-invalid-latitude", (await mutation("/api/stores", { name: "x", assetCode: "NATIVE-FRIDGE-3", latitude: "91" })).status, 400);
  const edited = await mutation(`/api/stores/${store.data.id}`, { name: "ຮ້ານແກ້ໄຂ", latitude: "", longitude: null, commissionRate: "0.3", whatsapp: "" }, { method: "PATCH", key: undefined });
  same("store-edit-result", [edited.status, edited.data?.name, edited.data?.isActive], [200, "ຮ້ານແກ້ໄຂ", true]);
  const afterEdit = await client.store.findUniqueOrThrow({ where: { id: store.data.id } });
  same("store-edit-exact", [afterEdit.latitude, afterEdit.longitude, afterEdit.commissionRate.toString(), afterEdit.whatsapp], [null, null, "0.3", null]);
  equal("store-deactivate-with-balance", (await mutation(`/api/stores/${fixture.store.id}`, {}, { method: "DELETE", key: undefined })).status, 409);

  const fridge = created.fridge;
  equal("fridge-capacity-below-stock", (await mutation(`/api/fridges/${fixture.store.fridge.id}`, { capacityCups: 1 }, { method: "PATCH", key: undefined })).status, 409);
  equal("fridge-maintenance-with-stock", (await mutation(`/api/fridges/${fixture.store.fridge.id}`, { status: "maintenance" }, { method: "PATCH", key: undefined })).status, 409);
  equal("fridge-duplicate-asset", (await mutation(`/api/fridges/${fridge.id}`, { assetCode: "NATIVE-FRIDGE" }, { method: "PATCH", key: undefined })).status, 409);
  const unplugged = await mutation(`/api/fridges/${fridge.id}`, { currentStoreId: "", model: "Display 80", serialNo: "SN-NATIVE-2", status: "maintenance", capacityCups: 90 }, { method: "PATCH", key: undefined });
  same("fridge-unplug", [unplugged.status, unplugged.data?.storeId, unplugged.data?.status], [200, null, "maintenance"]);
  const deactivated = await mutation(`/api/stores/${store.data.id}`, {}, { method: "DELETE", key: undefined });
  same("store-deactivate", [deactivated.status, deactivated.data?.isActive], [200, false]);
  const moved = await mutation(`/api/fridges/${fridge.id}`, { currentStoreId: store.data.id, status: "active" }, { method: "PATCH", key: undefined });
  equal("fridge-move-to-inactive-store", moved.status, 404);
  same("expense-category-create", [(await mutation("/api/expense-categories", { name: " ຄ່ານ້ຳ " }, { key: undefined })).data?.category, (await mutation("/api/expense-categories", { name: "ຄ່ານ້ຳ" }, { key: undefined })).status], ["ຄ່ານ້ຳ", 201]);
  equal("expense-category-single-row", await client.expenseCategory.count({ where: { name: "ຄ່ານ້ຳ" } }), 1);
}

async function closingWorkflow() {
  stage = "daily-closing-original-snapshot-replay";
  const closingDate = "2199-12-31";
  const initial = await native("closing", { date: closingDate });
  equal("closing-starts-empty", initial.snapshot, null);
  const body = { closingDate, cashAmount: "1234567890.25", bankAmount: "200.10", expenseAmount: "30.05", note: "synthetic closing", expectedSnapshot: initial.snapshot };
  await replay("/api/daily-closing", body);
  equal("closing-blind-overwrite-rejected", (await mutation("/api/daily-closing", { ...body, cashAmount: "1.00" })).status, 409);
  const loaded = await native("closing", { date: closingDate });
  same("closing-native-exact-snapshot", [loaded.snapshot.cashAmount, loaded.snapshot.bankAmount, loaded.snapshot.expenseAmount], ["1234567890.25", "200.10", "30.05"]);
  await replay("/api/daily-closing", { ...body, cashAmount: "1234567890.26", expectedSnapshot: loaded.snapshot });
  equal("closing-stale-edit-rejected", (await mutation("/api/daily-closing", { ...body, cashAmount: "2.00", expectedSnapshot: loaded.snapshot })).status, 409);
  equal("closing-native-preserves-accepted-money", (await native("closing", { date: closingDate })).snapshot.cashAmount, "1234567890.26");
  equal("closing-single-row", await client.dailyClosing.count(), 1);
  equal("closing-audits-accepted-operations-only", await client.auditLog.count({ where: { entityType: "daily_closing" } }), 2);
}

async function freshReadAuthorization() {
  stage = "native-read-fresh-authorization";
  // The cookie still claims admin. The read handler must use the current database role.
  await client.user.update({ where: { id: identities.admin.row.id }, data: { role: "driver" } });
  equal("native-read-role-downgrade-applies-immediately", (await request("/api/native/v1/reports")).status, 403);
  equal("native-read-downgraded-user-can-read-stores", (await request("/api/native/v1/stores")).status, 200);
  await client.user.update({ where: { id: identities.admin.row.id }, data: { role: "admin", isActive: false } });
  equal("native-read-disabled-user-is-rejected", (await request("/api/native/v1/stores")).status, 401);
  await client.user.update({ where: { id: identities.admin.row.id }, data: { isActive: true } });
  await client.userSession.deleteMany({ where: { userId: identities.driver.row.id } });
  equal("native-read-revoked-session-is-rejected", (await request("/api/native/v1/stores", { role: "driver" })).status, 401);
}

async function keepUIFixture(fixture) {
  stage = "ui-fixture";
  // This mode deliberately leaves 43188 unused: the native app owns its backend.
  const secret = randomBytes(48).toString("base64url");
  const credentials = Object.fromEntries(Object.entries(identities).map(([role, identity]) => [role, { email: identity.row.email, password: identity.password }]));
  await fs.writeFile(path.join(scratch, "connection.env"), `DATABASE_URL=${databaseURL}\nSESSION_SECRET=${secret}\n`, { mode: 0o600, flag: "wx" });
  await fs.writeFile(path.join(scratch, "UIcredentials.json"), `${JSON.stringify(credentials)}\n`, { mode: 0o600, flag: "wx" });
  // Populate visible stock without invoking a backend or sharing a real account.
  await client.productionBatch.create({ data: { batchNumber: "NATIVE-UI-SYNTHETIC", recipeId: fixture.product.recipes[0].id, finishedProductId: fixture.product.id, quantityProduced: 20, quantityRemaining: 20, totalMaterialCost: "8.67", unitCost: "0.4336", costKnown: true, mfgDate: new Date(), expDate: new Date(Date.now() + 21 * 86400000) } });
  for (const name of ["connection.env", "UIcredentials.json"]) equal("fixture-file-is-private", (await fs.stat(path.join(scratch, name))).mode & 0o777, 0o600);
  await client.$disconnect(); client = null;
  console.log(`Native UI fixture ready: ${scratch}`);
  console.log("Synthetic fixture only; packaged backend started=0; keep stdin open; EOF cleans PostgreSQL and private files.");
  process.stdin.resume();
  await new Promise(resolve => {
    process.stdin.once("end", resolve); process.stdin.once("error", resolve);
    controller.signal.addEventListener("abort", resolve, { once: true });
  });
}

async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  closing = true;
  cleanupPromise = (async () => {
    const failures = [];
    clearInterval(heartbeat);
    for (const tool of runningTools) tool.kill("SIGTERM");
    if (engine) {
      if (!engine.stdin.destroyed) engine.stdin.end('{"version":1,"type":"shutdown"}\n');
      if (!await Promise.race([engineClosed.then(() => true), delay(10000).then(() => false)])) {
        engine.kill("SIGTERM");
        if (!await Promise.race([engineClosed.then(() => true), delay(6000).then(() => false)])) failures.push("swift-engine-stop-failed");
      }
    }
    if (supervisor) {
      if (!supervisor.stdin.destroyed) supervisor.stdin.end('{"version":1,"type":"shutdown"}\n');
      const exited = await Promise.race([supervisorClosed.then(() => true), delay(6000).then(() => false)]);
      if (!exited) {
        supervisor.kill("SIGTERM");
        if (!await Promise.race([supervisorClosed.then(() => true), delay(6000).then(() => false)])) failures.push("supervisor-stop-failed");
      }
    }
    try { await client?.$disconnect(); } catch { failures.push("client-disconnect-failed"); }
    if (scratch && pgStartAttempted) {
      try { await runTool(path.join(pgBin, "pg_ctl"), ["-D", path.join(scratch, "postgres"), "-m", "immediate", "-w", "-t", "15", "stop"], { cleanup: true, timeout: 20000 }); }
      catch { failures.push("isolated-postgres-stop-failed"); }
    }
    if (supervisor) {
      try { await availablePort(43188); } catch { failures.push("native-port-not-cleared"); }
    }
    // Keep an un-stopped cluster for diagnosis; never remove a running data directory.
    if (scratch && !failures.includes("isolated-postgres-stop-failed")) {
      try { await fs.rm(scratch, { recursive: true, force: true }); await fs.access(scratch).then(() => { throw Error(); }, error => { if (error.code !== "ENOENT") throw error; }); }
      catch { failures.push("scratch-removal-failed"); }
    }
    if (failures.length) throw new CheckFailure(failures.join("-"));
  })();
  return cleanupPromise;
}

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
  interrupted = true; controller.abort();
  if (!closing) for (const tool of runningTools) tool.kill("SIGTERM");
});

try {
  check("known-cli-options", args.every(value => !value.startsWith("--") || ["--check-setup", "--ui-fixture", "--parity"].includes(value) || value.startsWith("--swift-engine="))
    && !(setupOnly && uiFixture) && (!parity || Boolean(swiftEngine)) && (!swiftEngine || !uiFixture));
  await setup();
  if (!setupOnly) {
    const fixture = await fixtures();
    if (uiFixture) await keepUIFixture(fixture);
    else {
      await startBackend(); await loginRoles(); await compareReads("initial", fixture); await nativeReads(fixture);
      const batch = await stockWorkflows(fixture); await financeWorkflows(fixture);
      await receiptsAndExpenses(fixture); await catalogWorkflows(fixture, batch); await closingWorkflow(); await compareReads("after-workflows", fixture); await freshReadAuthorization();
      stage = "final-database-invariants";
      equal("no-negative-raw-stock", await client.rawMaterial.count({ where: { currentStock: { lt: 0 } } }), 0);
      equal("no-negative-fridge-stock", await client.fridgeInventory.count({ where: { currentStock: { lt: 0 } } }), 0);
      equal("no-negative-batch-stock", await client.productionBatch.count({ where: { quantityRemaining: { lt: 0 } } }), 0);
      check("supervisor-retains-canonical-protocol", !supervisorProtocolError && !engineProtocolError);
      stage = "read-parity";
      check("read-parity-matches-node", parityDifferences.length === 0);
    }
  }
} catch (error) {
  // Parity differences come from wholly synthetic fixture data only.
  if (parity) console.error(`Read parity: identical 200 responses=${parityCompared}; differences=${parityDifferences.length}`);
  if (parityDifferences.length) console.error(`Read parity differences (${parityDifferences.length}):\n${parityDifferences.slice(0, 80).join("\n")}`);
  // Fixed labels only: no response bodies, financial values, passwords, or URLs.
  const label = error instanceof CheckFailure ? error.message : "unexpected-runtime-failure";
  console.error(`Native backend E2E failed: stage=${stage}; check=${label}`);
  process.exitCode = 1;
} finally {
  try {
    await cleanup();
    if (!setupOnly) console.log("Native backend cleanup: PostgreSQL stopped; scratch root removed; packaged port cleared.");
  } catch (error) {
    console.error(`Native backend cleanup failed: ${error instanceof CheckFailure ? error.message : "unexpected-cleanup-failure"}`);
    process.exitCode = 1;
  }
  if (interrupted) process.exitCode = 130;
  if (parity && !process.exitCode) console.log(`Read parity: identical 200 responses=${parityCompared}; differences=${parityDifferences.length}`);
  if (!process.exitCode && !setupOnly && !uiFixture) console.log(`Native packaged backend E2E passed: checks=${checks}; local requests=${requests}; live configuration used=0.`);
}
