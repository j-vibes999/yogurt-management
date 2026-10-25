import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import vm from "node:vm";
import * as money from "../src/lib/money.ts";
import * as dates from "../src/lib/date-only.ts";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { z } = require("zod");
function load(file, imports) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  const context = { exports, module: { exports }, Error, Date, process: { env: { DATABASE_URL: "memory-only" } },
    require(name) { if (Object.hasOwn(imports, name)) return imports[name]; throw new Error(`Unexpected dependency ${name}`); } };
  vm.runInNewContext(output, context, { filename: file });
  return context.module.exports;
}
const idempotency = load("src/lib/idempotency.ts", { "node:crypto": { createHash } });
const operationKey = "11111111-1111-4111-8111-111111111111";
const request = (body, key = operationKey) => new Request("https://stores.test/", { method: "POST", headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body: JSON.stringify(body) });
function fixture({ auditFails = false, before = null } = {}) {
  let state = { stores: before ? [before] : [], fridges: [], inventories: [], audits: [], receipts: [] };
  const tx = {
    store: {
      create: async ({ data }) => { const row = { id: "store", ...data }; state.stores.push(row); return row; },
      findUnique: async ({ where }) => state.stores.find(row => row.id === where.id) ?? null,
      update: async ({ where, data }) => { const index = state.stores.findIndex(row => row.id === where.id); const row = { ...state.stores[index], ...data }; state.stores[index] = row; return row; },
    },
    finishedProduct: { findMany: async () => [{ id: "one" }, { id: "two" }] },
    fridge: { create: async ({ data }) => { const row = { id: "fridge", ...data }; state.fridges.push(row); return row; } },
    fridgeInventory: { create: async ({ data }) => { state.inventories.push(data); return data; } },
    operationReceipt: {
      findUnique: async ({ where }) => state.receipts.find(row => row.key === where.userId_scope_key.key && row.scope === where.userId_scope_key.scope && row.userId === where.userId_scope_key.userId) ?? null,
      create: async ({ data }) => { state.receipts.push(data); return data; },
    },
  };
  const imports = { "next/server": { NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) } }, zod: { z },
    "@/lib/money": money, "@/lib/date-only": dates, "@/lib/idempotency": idempotency,
    "@/lib/server-session": { getCurrentSession: async () => ({ userId: "admin", role: "admin" }) }, "@/lib/logger": { logError() {} },
    "@/lib/audit": { writeAuditLog: async (input, transaction) => { assert.equal(transaction, tx); if (auditFails) throw new Error("Injected audit failure"); state.audits.push(input); } },
    "@/lib/transaction": { withSerializableTransaction: async work => { const previous = structuredClone(state); try { return await work(tx); } catch (error) { state = previous; throw error; } } },
  };
  return { state: () => state, route: file => load(file, imports) };
}
const base = { name: "Shop", assetCode: "FR-TEST", phone: "0201234", whatsapp: "", fridgeStartDate: "2026-10-01", monthlyElectricity: "14000.70", capacityCups: "100", commissionRate: "0.1601" };

test("percentage forms convert basis points without floating division artifacts", () => {
  assert.equal(money.commissionRateFromPercent("16.01"), "0.1601");
  assert.equal(money.commissionRateFromPercent("30"), "0.3000");
  assert.equal(money.commissionRateFromPercent("100.00"), "1.0000");
  assert.equal(money.commissionRateFromPercent("0.01"), "0.0001");
  for (const invalid of ["100.01", "16.011", "", null, true, "1e2", -1]) assert.equal(money.commissionRateFromPercent(invalid), null);
});

test("store creation persists exact money/rate and replays the complete store/fridge/inventory command once", async () => {
  const f = fixture(); const route = f.route("src/app/api/stores/route.ts");
  const first = await route.POST(request(base)); const replay = await route.POST(request(base));
  assert.equal(first.status, 201); assert.equal(replay.status, 201); assert.equal(JSON.stringify(first.body), JSON.stringify(replay.body));
  assert.equal(f.state().stores.length, 1); assert.equal(f.state().fridges.length, 1); assert.equal(f.state().inventories.length, 2); assert.equal(f.state().audits.length, 1); assert.equal(f.state().receipts.length, 1);
  assert.equal(f.state().stores[0].monthlyElectricity, "14000.70"); assert.equal(f.state().stores[0].commissionRate, "0.1601");
  assert.equal(f.state().stores[0].whatsapp, "0201234"); assert.equal(f.state().fridges[0].capacityCups, 100);
  assert.equal(f.state().stores[0].fridgeStartDate.toISOString(), "2026-10-01T12:00:00.000Z");
  assert.equal((await route.POST(request({ ...base, name: "Other shop" }))).status, 409);
});

test("store creation rejects truncated capacity, finer money/rate and invalid dates before committing", async () => {
  for (const changed of [
    { capacityCups: "100.9" }, { capacityCups: "1e2" }, { capacityCups: 100.9 }, { capacityCups: "" }, { capacityCups: 0 }, { capacityCups: 10001 },
    { monthlyElectricity: "0.004" }, { monthlyElectricity: -1 }, { monthlyElectricity: true }, { monthlyElectricity: "1000000000000.00" },
    { commissionRate: "0.16011" }, { commissionRate: 1.01 }, { commissionRate: true }, { commissionRate: "" }, { fridgeStartDate: "2026-02-31" },
  ]) {
    const f = fixture(); const result = await f.route("src/app/api/stores/route.ts").POST(request({ ...base, ...changed }));
    assert.equal(result.status, 400, JSON.stringify(changed)); assert.equal(result.body.retryable, false); assert.equal(f.state().stores.length, 0);
  }
});

test("store creation atomically rolls back an audit failure and requires a request key", async () => {
  const failed = fixture({ auditFails: true }); const response = await failed.route("src/app/api/stores/route.ts").POST(request(base));
  assert.equal(response.status, 500); assert.equal(response.body.retryable, true);
  for (const rows of Object.values(failed.state())) assert.equal(rows.length, 0);
  const f = fixture(); assert.equal((await f.route("src/app/api/stores/route.ts").POST(request(base, null))).status, 400); assert.equal(f.state().stores.length, 0);
});

const historical = { id: "store", name: "Shop", contactName: "Owner", phone: "0201234", whatsapp: "0201234", facebook: "Page", address: "Address", latitude: 17.96, longitude: 102.6, fridgeStartDate: dates.parseDateOnly("2026-09-01"), monthlyElectricity: "200000.00", commissionRate: "0.3000", isActive: true };
const params = { params: Promise.resolve({ id: "store" }) };

test("partial store edits preserve omitted contacts, coordinates and installation date", async () => {
  const f = fixture({ before: historical });
  const result = await f.route("src/app/api/stores/[id]/route.ts").PATCH(request({ name: "Shop renamed", monthlyElectricity: "0.05", commissionRate: "0.1601" }), params);
  assert.equal(result.status, 200);
  const row = f.state().stores[0];
  for (const field of ["contactName", "phone", "whatsapp", "facebook", "address", "latitude", "longitude"]) assert.equal(row[field], historical[field]);
  assert.equal(row.fridgeStartDate.toISOString(), historical.fridgeStartDate.toISOString());
  assert.equal(row.monthlyElectricity, "0.05"); assert.equal(row.commissionRate, "0.1601"); assert.equal(f.state().audits.length, 1);
  assert.equal(f.state().audits[0].metadata.before.commissionRate, "0.3000"); assert.equal(f.state().audits[0].metadata.after.commissionRate, "0.1601");
});

test("store edit rejects database rounding, invalid types and bad dates without updating historical data", async () => {
  for (const changed of [{ commissionRate: "0.30001" }, { commissionRate: null }, { commissionRate: false }, { monthlyElectricity: "0.004" }, { monthlyElectricity: "" }, { latitude: [] }, { isActive: "false" }, { fridgeStartDate: "2026-02-31" }]) {
    const f = fixture({ before: historical }); const result = await f.route("src/app/api/stores/[id]/route.ts").PATCH(request({ name: "Shop", ...changed }), params);
    assert.equal(result.status, 400, JSON.stringify(changed)); assert.equal(result.body.retryable, false); assert.equal(f.state().audits.length, 0); assert.equal(f.state().stores[0].commissionRate, "0.3000");
  }
});

test("store edit cannot commit financial changes without their audit", async () => {
  const f = fixture({ before: historical, auditFails: true }); const result = await f.route("src/app/api/stores/[id]/route.ts").PATCH(request({ name: "Shop", monthlyElectricity: "0.05" }), params);
  assert.equal(result.status, 500); assert.equal(f.state().stores[0].monthlyElectricity, "200000.00"); assert.equal(f.state().audits.length, 0);
});
