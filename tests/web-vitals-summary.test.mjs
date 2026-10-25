import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const script = path.resolve("scripts/web-vitals-summary.mjs");
async function summarize(metrics) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "yogurt-vitals-test-"));
  try {
    const storage = path.join(directory, ".yogurt", "metrics");
    await fs.mkdir(storage, { recursive: true });
    await fs.writeFile(path.join(storage, "web-vitals.ndjson"), metrics.map(metric => JSON.stringify(metric)).join("\n"));
    return execFileSync(process.execPath, [script], { cwd: directory, encoding: "utf8" });
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
const base = { buildId: "build-a", buildSource: "client", provenance: "field", path: "/stores/private-store-id?secret=private-value", navigationId: "12345", name: "INP", viewport: "desktop", connection: "4g" };

test("vitals summary keeps the final metric update per navigation and uses conservative nearest-rank percentiles", async () => {
  const output = await summarize([
    { ...base, id: "metric-a", value: 100, ts: "2026-10-01T01:00:00.000Z" },
    { ...base, id: "metric-a", value: 300, ts: "2026-10-01T01:00:10.000Z" },
    { ...base, id: "metric-a", value: 50, ts: "2026-10-01T01:00:05.000Z" },
    { ...base, navigationId: "12346", id: "metric-b", value: 100, ts: "2026-10-01T01:00:20.000Z" },
  ]);
  const line = output.split("\n").find(row => row.startsWith("build-a\tclient\tfield\t/stores/[id]\tINP\t"));
  assert.equal(line, "build-a\tclient\tfield\t/stores/[id]\tINP\t2\t100.0\t300.0\t300.0");
  assert.equal(output.includes("private-store-id"), false);
  assert.equal(output.includes("private-value"), false);
});

test("different builds and synthetic measurements remain separate from field samples", async () => {
  const output = await summarize([
    { ...base, id: "same-metric", value: 10 },
    { ...base, buildId: "build-b", id: "same-metric", value: 20 },
    { ...base, provenance: "synthetic", id: "same-metric", value: 30 },
    { ...base, name: "INP", id: "invalid", value: -1 },
  ]);
  for (const [build, provenance, value] of [["build-a", "field", "10.0"], ["build-b", "field", "20.0"], ["build-a", "synthetic", "30.0"]]) {
    assert.ok(output.includes(`${build}\tclient\t${provenance}\t/stores/[id]\tINP\t1\t${value}\t${value}\t${value}`));
  }
  assert.equal(output.includes("-1.0"), false);
});
