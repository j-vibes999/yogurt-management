import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { databaseFingerprint, loadBackupReadiness } from "../src/lib/backup-readiness.ts";
import { openReceipt, privateReceiptDirectory, storeReceipt } from "../src/lib/receipt-storage.ts";

const runtimePaths = await import("../src/lib/runtime-paths.ts").catch(() => ({}));
const require = createRequire(import.meta.url);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWO4w8UFAAK2APG8J2s+AAAAAElFTkSuQmCC", "base64");

async function fixture(t, configured = true) {
  const scratch = await mkdtemp(path.join(tmpdir(), "yogurt-runtime-paths-"));
  const root = path.join(scratch, "Installed App");
  const directory = path.join(scratch, "Application Support", "runtime");
  const previous = process.env.YOGURT_DATA_ROOT;
  if (configured) process.env.YOGURT_DATA_ROOT = directory;
  else delete process.env.YOGURT_DATA_ROOT;
  t.after(async () => {
    if (previous === undefined) delete process.env.YOGURT_DATA_ROOT;
    else process.env.YOGURT_DATA_ROOT = previous;
    await rm(scratch, { recursive: true, force: true });
  });
  await mkdir(root, { recursive: true });
  return { root, directory };
}

test("runtime data defaults to the legacy directory when no override is configured", async t => {
  const { root } = await fixture(t, false);
  assert.equal(typeof runtimePaths.runtimeDataDirectory, "function");
  assert.equal(runtimePaths.runtimeDataDirectory(root), path.join(root, ".yogurt"));
  assert.equal(runtimePaths.runtimeDataDirectory(), path.join(process.cwd(), ".yogurt"));
});

test("runtime data uses an absolute override without nesting another .yogurt directory", async t => {
  const { root, directory } = await fixture(t);
  assert.equal(typeof runtimePaths.runtimeDataDirectory, "function");
  assert.equal(runtimePaths.runtimeDataDirectory(root), directory);
  assert.equal(runtimePaths.runtimeDataDirectory(root, path.join(root, "explicit")), path.join(root, "explicit"));
});

test("runtime data rejects relative configured roots before filesystem access", async t => {
  const { root } = await fixture(t, false);
  assert.equal(typeof runtimePaths.runtimeDataDirectory, "function");
  for (const configured of ["relative/runtime", "../outside", ""]) {
    assert.throws(() => runtimePaths.runtimeDataDirectory(root, configured), /absolute path/);
  }
  process.env.YOGURT_DATA_ROOT = "relative/runtime";
  assert.throws(() => privateReceiptDirectory(root), /absolute path/);
});

test("receipts write and reopen under the configured private data root", async t => {
  const { root, directory } = await fixture(t);
  const receipt = await storeReceipt(png, "image/png", root);
  const receiptDirectory = path.join(directory, "private-receipts");
  assert.equal(privateReceiptDirectory(root), receiptDirectory);
  assert.equal((await stat(receiptDirectory)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(receiptDirectory, receipt.name))).mode & 0o777, 0o600);
  assert.deepEqual(await readFile(path.join(receiptDirectory, receipt.name)), png);
  const opened = await openReceipt(receipt.name, root);
  assert.ok(opened);
  try { assert.deepEqual(await opened.handle.readFile(), png); }
  finally { await opened.handle.close(); }
  await assert.rejects(stat(path.join(root, ".yogurt")), { code: "ENOENT" });
});

test("backup readiness reads evidence and artifacts from the configured data root", async t => {
  const { root, directory } = await fixture(t);
  const backupDirectory = path.join(directory, "backups");
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  const source = "postgresql://fixture:unused@127.0.0.1/yogurt_e2e_runtime";
  const backup = { ok: true, scope: "public", file: "verified.dump", sha256: "a".repeat(64), bytes: 4, createdAt: "2026-10-28T11:00:00Z", sourceFingerprint: databaseFingerprint(source), receipts: "verified.receipts.tar.gz" };
  for (const [name, value] of [
    ["latest.json", backup],
    ["latest-attempt.json", { ...backup, attemptedAt: "2026-10-28T11:00:00Z" }],
    ["last-restore-verification.json", { ...backup, verifiedAt: "2026-10-28T11:30:00Z" }],
  ]) await writeFile(path.join(backupDirectory, name), JSON.stringify(value), { mode: 0o600 });
  await writeFile(path.join(backupDirectory, "verified.dump"), "dump", { mode: 0o600 });
  await writeFile(path.join(backupDirectory, "verified.receipts.tar.gz"), "receipt archive", { mode: 0o600 });
  assert.deepEqual(await loadBackupReadiness(root, source, Date.parse("2026-10-28T12:00:00Z")), {
    ok: true, ageHours: 1, restoreVerified: true, reasons: [],
  });
  await rm(path.join(backupDirectory, "verified.dump"));
  const missing = await loadBackupReadiness(root, source, Date.parse("2026-10-28T12:00:00Z"));
  assert.equal(missing.ok, false);
  assert.ok(missing.reasons.includes("backup-artifact-missing"));
});

test("metrics write to private runtime data while build metadata stays in the application root", async t => {
  const { root, directory } = await fixture(t);
  await mkdir(path.join(root, ".next"), { recursive: true });
  await mkdir(path.join(directory, ".next"), { recursive: true });
  await writeFile(path.join(root, ".next", "BUILD_ID"), "immutable-build\n");
  await writeFile(path.join(directory, ".next", "BUILD_ID"), "mutable-decoy\n");
  const source = readFileSync(new URL("../src/app/api/metrics/web-vitals/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  new Function("require", "exports", "process", compiled)(
    name => name === "@/lib/runtime-paths" ? runtimePaths : require(name),
    exports,
    { ...process, cwd: () => root },
  );
  const response = await exports.POST(new Request("http://127.0.0.1/api/metrics/web-vitals", {
    method: "POST", body: JSON.stringify({ name: "LCP", value: 120, path: "/operations" }),
  }));
  assert.equal(response.status, 204);
  const metricDirectory = path.join(directory, "metrics");
  const metricFile = path.join(metricDirectory, "web-vitals.ndjson");
  const contents = await readFile(metricFile, "utf8").catch(error => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  assert.ok(contents, "the metric must be saved outside the application root");
  const metric = JSON.parse(contents.trim());
  assert.equal(metric.collectorBuildId, "immutable-build");
  assert.equal(metric.buildId, "immutable-build");
  assert.equal((await stat(metricDirectory)).mode & 0o777, 0o700);
  assert.equal((await stat(metricFile)).mode & 0o777, 0o600);
  await assert.rejects(stat(path.join(root, ".yogurt")), { code: "ENOENT" });
});
