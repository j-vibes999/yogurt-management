import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { createProductSchema, updateProductSchema, parseProductPrice } from "../src/lib/product-input.ts";

const require = createRequire(import.meta.url);
const ts = require("typescript");
function load(file, imports) {
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  const context = { exports, module: { exports }, Error, Date, console,
    require(name) {
      if (Object.hasOwn(imports, name)) return imports[name];
      throw new Error(`Unexpected test import: ${name}`);
    },
  };
  vm.runInNewContext(output, context, { filename: file });
  return context.module.exports;
}
const idempotency = load("src/lib/idempotency.ts", { "node:crypto": { createHash } });
const key = "23232323-2323-4323-8323-232323232323";
const input = { code: "SKU", name: "Yogurt", retailPrice: "12.34", shelfLifeDays: "21" };
const request = (body, operationKey = key) => new Request("https://offline-product.test/", {
  method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": operationKey }, body: JSON.stringify(body),
});

function fixture() {
  let state = { products: [], receipts: [], audits: [] }, auditFails = false;
  const tx = {
    operationReceipt: {
      findUnique: async ({ where }) => state.receipts.find(row => row.key === where.userId_scope_key.key && row.scope === where.userId_scope_key.scope && row.userId === where.userId_scope_key.userId) ?? null,
      create: async ({ data }) => { state.receipts.push(data); return data; },
    },
    finishedProduct: {
      create: async ({ data }) => { const product = { id: `product-${state.products.length}`, isActive: true, ...data }; state.products.push(product); return product; },
      findUnique: async ({ where }) => state.products.find(product => product.id === where.id) ?? null,
      update: async ({ where, data }) => { const index = state.products.findIndex(product => product.id === where.id); state.products[index] = { ...state.products[index], ...data }; return state.products[index]; },
    },
  };
  const imports = {
    "@prisma/client": { Prisma },
    "next/server": { NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) } },
    "@/lib/server-session": { getCurrentSession: async () => ({ userId: "admin", role: "admin" }) },
    "@/lib/product-input": { createProductSchema, updateProductSchema },
    "@/lib/idempotency": idempotency,
    "@/lib/logger": { logError() {} },
    "@/lib/audit": { writeAuditLog: async (audit, transaction) => { assert.equal(transaction, tx); if (auditFails) throw new Error("Injected audit failure"); state.audits.push(audit); } },
    "@/lib/transaction": { withSerializableTransaction: async work => { const before = structuredClone(state); try { return await work(tx); } catch (error) { state = before; throw error; } } },
  };
  return { state: () => state, failAudit: value => { auditFails = value; },
    create: load("src/app/api/products/route.ts", imports).POST,
    update: load("src/app/api/products/[id]/route.ts", imports).PATCH,
  };
}

test("product prices preserve cents and match the narrower Decimal(12,2) range", () => {
  assert.equal(parseProductPrice("9999999999.99"), "9999999999.99");
  assert.equal(parseProductPrice(0), "0.00");
  assert.equal(parseProductPrice("12.3"), "12.30");
  for (const value of ["10000000000", "0.004", ".1", "1e2", -1, Infinity, true, null, ""]) assert.equal(parseProductPrice(value), null, String(value));
  for (const value of [true, null, "", "21.5", 3651]) assert.equal(createProductSchema.safeParse({ ...input, shelfLifeDays: value }).success, false);
  assert.equal(updateProductSchema.safeParse({}).success, false);
});

test("product create replay returns the original product without duplicate audit or mutation", async () => {
  const f = fixture();
  const first = await f.create(request(input));
  const replay = await f.create(request({ ...input, retailPrice: 12.34, shelfLifeDays: 21 }));
  assert.equal(first.status, 201);
  assert.equal(replay.status, 201);
  assert.equal(replay.body.product.id, first.body.product.id);
  assert.equal(f.state().products.length, 1);
  assert.equal(f.state().audits.length, 1);
  assert.equal(f.state().receipts.length, 1);
  assert.equal((await f.create(request({ ...input, retailPrice: "12.35" }))).status, 409);
  assert.equal(f.state().products[0].retailPrice, "12.34");
});

test("product create rolls back on audit failure and the original key safely recovers", async () => {
  const f = fixture();
  f.failAudit(true);
  const failed = await f.create(request(input));
  assert.equal(failed.status, 503);
  assert.equal(failed.body.retryable, true);
  assert.deepEqual(f.state(), { products: [], receipts: [], audits: [] });
  f.failAudit(false);
  assert.equal((await f.create(request(input))).status, 201);
  assert.equal(f.state().products.length, 1);
});

test("product update and its audit roll back together; replay preserves the first result", async () => {
  const f = fixture();
  const created = await f.create(request(input));
  const params = { params: Promise.resolve({ id: created.body.product.id }) };
  f.failAudit(true);
  assert.equal((await f.update(request({ retailPrice: "3.25" }), params)).status, 503);
  assert.equal(f.state().products[0].retailPrice, "12.34");
  assert.equal(f.state().receipts.length, 1);
  f.failAudit(false);
  assert.equal((await f.update(request({ retailPrice: "3.25" }), params)).status, 200);
  assert.equal((await f.update(request({ retailPrice: "3.25" }), params)).status, 200);
  assert.equal(f.state().products[0].retailPrice, "3.25");
  assert.equal(f.state().audits.length, 2);
  assert.equal(f.state().receipts.length, 2);
  assert.equal((await f.update(request({ retailPrice: "3.251" }), params)).status, 400);
  assert.equal(f.state().products[0].retailPrice, "3.25");
});
