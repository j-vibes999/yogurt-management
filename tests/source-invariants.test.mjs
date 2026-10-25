import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("schema contains production/refill/accounting safety fields", () => {
  const schema = read("prisma/schema.prisma");
  for (const marker of [
    "preparing",
    "quantityRemaining",
    "totalMaterialCost",
    "unitCost",
    "subtotalCost",
    "model RawMaterialAdjustment",
    "voidedAt",
  ]) {
    assert.ok(schema.includes(marker), `missing schema marker: ${marker}`);
  }
});

test("application source only imports demo data through db-data fallback", () => {
  const hits = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.(ts|tsx)$/.test(entry.name) && fs.readFileSync(file, "utf8").includes("@/data/demo")) {
        hits.push(path.relative(root, file));
      }
    }
  }
  walk(path.join(root, "src"));
  assert.deepEqual(hits, ["src/lib/db-data.ts"]);
});

test("all source API routes have root app-router reexports", () => {
  function collect(dir, base = "") {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      const rel = path.join(base, entry.name);
      if (entry.isDirectory()) out.push(...collect(file, rel));
      else if (entry.name === "route.ts") out.push(rel);
    }
    return out;
  }
  for (const rel of collect(path.join(root, "src/app/api"))) {
    assert.ok(fs.existsSync(path.join(root, "app/api", rel)), `missing root API reexport: ${rel}`);
  }
});


test("all source pages have root app-router reexports", () => {
  function collect(dir, base = "") {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      const rel = path.join(base, entry.name);
      if (entry.isDirectory()) out.push(...collect(file, rel));
      else if (entry.name === "page.tsx") out.push(rel);
    }
    return out;
  }
  for (const rel of collect(path.join(root, "src/app"))) {
    assert.ok(fs.existsSync(path.join(root, "app", rel)), `missing root page reexport: ${rel}`);
  }
});

test("critical transaction APIs retain safety guards", () => {
  const restock = read("src/app/api/restock-visits/route.ts");
  const refill = read("src/app/api/refills/[id]/route.ts");
  const production = read("src/app/api/production-batches/route.ts");
  const adjust = read("src/app/api/inventory/adjust/route.ts");
  assert.ok(restock.includes("STALE_INVENTORY"));
  assert.ok(restock.includes("PAYMENT_EXCEEDS_BALANCE"));
  assert.ok(refill.includes("INSUFFICIENT_STOCK"));
  assert.ok(production.includes("INSUFFICIENT_RAW_MATERIALS"));
  assert.ok(adjust.includes("NEGATIVE_STOCK"));
});

test("reports support actual COGS and explicit fallback mode", () => {
  const data = read("src/lib/db-data.ts");
  assert.ok(data.includes('costMode: "actual" | "estimated"'));
  assert.ok(data.includes("subtotalCost"));
  assert.ok(data.includes("productCost"));
});


test("UX 4.0 guardrails stay in place", () => {
  const sourceFiles = [];
  function walkSource(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walkSource(file);
      else if (/\.(ts|tsx)$/.test(entry.name)) sourceFiles.push(file);
    }
  }
  walkSource(path.join(root, "src"));
  for (const file of sourceFiles) {
    const source = fs.readFileSync(file, "utf8");
    assert.equal(/[\u0E00-\u0E7F]/.test(source), false, `Thai UI text remains in ${path.relative(root, file)}`);
    assert.equal(/window\.(confirm|prompt)|\bconfirm\(|\bprompt\(/.test(source), false, `native browser dialog remains in ${path.relative(root, file)}`);
    assert.equal(/fontSize\s*:\s*(?:8|9|10|11)(?!\d)/.test(source), false, `inline font <= 11px remains in ${path.relative(root, file)}`);
  }
  const css = read("src/app/globals.css");
  for (const marker of [
    "UX 4.0 · Modern Yogurt Operations",
    "UX 4.0 reports analytics",
    "UX 4.0 action dialogs",
    "UX 4.0 readability floor",
    ".map-explorer-v4",
    ".mobile-bottom-nav",
  ]) assert.ok(css.includes(marker), `missing UX 4.0 marker: ${marker}`);
});

test("restock sales do not double-count completed refills", () => {
  const api = read("src/app/api/restock-visits/route.ts");
  const form = read("src/components/restock-audit-form.tsx");
  assert.match(api, /calculateLiveRestockLine\(/);
  assert.match(form, /calculateLiveRestockLine\(/);
});
