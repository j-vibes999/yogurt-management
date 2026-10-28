import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import * as money from "../src/lib/money.ts";
import { calculateSettlement, formatMoney } from "../src/lib/business.ts";
import * as dateOnly from "../src/lib/date-only.ts";
import * as dailyClosing from "../src/lib/daily-closing.ts";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { z } = require("zod");
const repo = fileURLToPath(new URL("../", import.meta.url));
const source = (file) => readFileSync(`${repo}${file}`, "utf8");
const response = { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) };

// Exercise the actual route and shared idempotency code with an atomic in-memory
// transaction. This verifies application behavior without a database or server.
function loadModule(file, imports, append = "") {
  const output = ts.transpileModule(source(file) + append, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  const context = { exports, module: { exports }, Error, Date, URL, console, process: { env: { DATABASE_URL: "memory-only" } },
    require: (name) => {
      if (Object.hasOwn(imports, name)) return imports[name];
      throw new Error(`Unexpected test dependency: ${name}`);
    },
  };
  vm.runInNewContext(output, context, { filename: file });
  return context.module.exports;
}
const idempotency = loadModule("src/lib/idempotency.ts", { "node:crypto": { createHash } });
const key = "11111111-1111-4111-8111-111111111111";
const request = (body, operationKey = key) => new Request("https://money.test/", {
  method: "POST", headers: { "Content-Type": "application/json", ...(operationKey ? { "Idempotency-Key": operationKey } : {}) }, body: JSON.stringify(body),
});

function fixture({ price = "0.05", balance = "0.00", auditFails = false, expense = null, closing = null, session = { userId: "admin", role: "admin" }, cost = {} } = {}) {
  let state = { receipts: [], audits: [], expenses: expense ? [expense] : [], closings: closing ? [closing] : [], settlements: [], visits: [], stock: 10 };
  const store = { id: "store", isActive: true, commissionRate: "0.3000", fridge: { id: "fridge", assetCode: "FRIDGE" },
    fridgeInventory: [{ id: "inventory", finishedProductId: "product", currentStock: 10, lastAuditDate: null, finishedProduct: { retailPrice: price } }],
    settlements: balance === "0.00" ? [] : [{ closingBalance: balance }],
  };
  const tx = {
    operationReceipt: {
      findUnique: async ({ where }) => state.receipts.find((row) => row.key === where.userId_scope_key.key && row.scope === where.userId_scope_key.scope && row.userId === where.userId_scope_key.userId) ?? null,
      create: async ({ data }) => { state.receipts.push(data); return data; },
    },
    store: { findUnique: async () => store },
    expense: {
      findUnique: async ({ where }) => state.expenses.find((row) => row.id === where.id) ?? null,
      create: async ({ data }) => { const row = { id: `expense-${state.expenses.length}`, voidedAt: null, ...data }; state.expenses.push(row); return row; },
      update: async ({ where, data }) => { const index = state.expenses.findIndex((row) => row.id === where.id); const row = { ...state.expenses[index], ...data }; state.expenses[index] = row; return row; },
    },
    dailyClosing: {
      findUnique: async ({ where }) => state.closings.find((row) => row.closingDate.getTime() === where.closingDate.getTime()) ?? null,
      upsert: async ({ where, create, update }) => { const index = state.closings.findIndex((row) => row.closingDate.getTime() === where.closingDate.getTime()); const row = index < 0 ? { id: "closing", ...create } : { ...state.closings[index], ...update }; if (index < 0) state.closings.push(row); else state.closings[index] = row; return row; },
    },
    settlement: { findUnique: async () => null, create: async ({ data }) => { const row = { id: "settlement", ...data }; state.settlements.push(row); return row; } },
    restockVisit: { create: async ({ data }) => { const row = { id: "visit", ...data }; state.visits.push(row); return row; } },
    fridgeInventory: { update: async ({ data }) => { state.stock = data.currentStock; return data; } },
  };
  const imports = {
    "next/server": { NextResponse: response }, zod: { z }, "node:crypto": { createHash },
    "@/lib/money": money, "@/lib/date-only": dateOnly,
    "@/lib/idempotency": idempotency,
    "@/lib/daily-closing": dailyClosing,
    "@/lib/prisma": { prisma: { dailyClosing: tx.dailyClosing } },
    "@/lib/business": loadModule("src/lib/business.ts", { "./money.ts": money }),
    "@/lib/server-session": { getCurrentSession: async () => session },
    "@/lib/logger": { logError() {} },
    "@/lib/refill-summary": { refilledSinceAudit: async () => new Map() },
    "@/lib/stock-cost": { consumeFridgeLots: async () => ({ unitCost: 0, subtotalCost: 0, costKnown: true, unknownCostUnits: 0, expiredCost: 0, expiredUnknownUnits: 0, ...cost }) },
    "@/lib/audit": { writeAuditLog: async (input, transaction) => { assert.equal(transaction, tx, "audit must share the mutation transaction"); if (auditFails) throw new Error("Injected audit failure"); state.audits.push(input); } },
    "@/lib/transaction": { withSerializableTransaction: async (work) => { const before = structuredClone(state); try { return await work(tx); } catch (error) { state = before; throw error; } } },
  };
  const visitBody = (paidAmount = "0.03") => ({ storeId: "store", fridgeAssetCode: "FRIDGE", paymentMethod: "cash", paidAmount,
    expectedFinancialSnapshot: { commissionRate: .3, previousBalance: balance, retailPrices: [{ productId: "product", retailPrice: price }] },
    lines: [{ productId: "product", previousStock: 10, countRemaining: "9", countExpiredReturned: "0", countRefilled: 0 }],
  });
  return { store, state: () => state, visitBody, route: (file) => loadModule(file, imports) };
}

test("money inputs accept two-decimal LAK and reject coercion, negative, finer precision and range overflow", () => {
  assert.equal(money.parseMoneyCents("14000.70"), 1400070n);
  assert.equal(money.parseMoneyCents(.05), 5n);
  assert.equal(money.parseMoneyCents("999999999999.99"), money.MAX_MONEY_CENTS);
  for (const value of [-1, "-1", "0.004", .004, "", "1e3", Infinity, null, true, [], "1000000000000.00"]) assert.equal(money.parseMoneyCents(value), null, String(value));
  assert.equal(money.moneyDecimalString(1400070n), "14000.70");
  assert.match(formatMoney(14000.7), /14,000\.7/);
});

test("commission rounds half up once and net conserves the exact gross", () => {
  const split = money.calculateSettlementCents(5n, "0.3");
  assert.equal(split.storeCommissionCents, 2n);
  assert.equal(split.netPayableCents, 3n);
  for (const gross of [0n, 1n, 5n, 101n, 2000100n, money.MAX_MONEY_CENTS]) {
    const amounts = money.calculateSettlementCents(gross, "0.3");
    assert.equal(amounts.storeCommissionCents + amounts.netPayableCents, gross);
  }
  assert.equal(calculateSettlement(.05, .3).netPayableAmount, .03);
  assert.equal(calculateSettlement(20001, .3).netPayableAmount, 14000.7);
});

test("count parsing rejects blank, fractional, exponent and oversized raw inputs", () => {
  assert.equal(money.parseWholeCount("9"), 9);
  for (const value of ["", " 9", "9.0", "9.2", "1e1", -1, 1.5, 2147483648, null]) assert.equal(money.parseWholeCount(value), null);
});

test("restock persists conserving cents, actual zero cost and canonical same-key replay", async () => {
  const f = fixture(); const route = f.route("src/app/api/restock-visits/route.ts");
  const first = await route.POST(request(f.visitBody()));
  const replay = await route.POST(request(f.visitBody()));
  assert.equal(first.status, 201); assert.equal(replay.status, 201);
  assert.equal(JSON.stringify(first.body), JSON.stringify(replay.body));
  assert.equal(f.state().settlements.length, 1); assert.equal(f.state().audits.length, 1);
  const row = f.state().settlements[0];
  assert.equal(row.grossAmount, "0.05"); assert.equal(row.storeCommissionAmount, "0.02"); assert.equal(row.netPayableAmount, "0.03");
  assert.equal(row.paidAmount, "0.03"); assert.equal(row.closingBalance, "0.00"); assert.equal(row.paymentStatus, "paid");
  const item = f.state().visits[0].items.create[0]; assert.equal(item.costKnown, true); assert.equal(item.unknownCostUnits, 0); assert.equal(item.subtotalCost, "0.00");
});

test("restock rejects invalid money, raw counts and changed financial quotes before committing", async () => {
  for (const paidAmount of ["-1", "0.004", "nonnumeric"]) {
    const f = fixture(); assert.equal((await f.route("src/app/api/restock-visits/route.ts").POST(request(f.visitBody(paidAmount)))).status, 400); assert.equal(f.state().visits.length, 0);
  }
  for (const count of ["", "9.2", "1e1", -1]) {
    const f = fixture(); const body = f.visitBody(); body.lines[0].countRemaining = count;
    assert.equal((await f.route("src/app/api/restock-visits/route.ts").POST(request(body))).status, 400); assert.equal(f.state().visits.length, 0);
  }
  for (const field of ["price", "commission", "balance"]) {
    const f = fixture(); const body = f.visitBody();
    if (field === "price") body.expectedFinancialSnapshot.retailPrices[0].retailPrice = "0.04";
    if (field === "commission") body.expectedFinancialSnapshot.commissionRate = .2;
    if (field === "balance") body.expectedFinancialSnapshot.previousBalance = "0.01";
    assert.equal((await f.route("src/app/api/restock-visits/route.ts").POST(request(body))).status, 409); assert.equal(f.state().visits.length, 0);
  }
});

test("restock preserves mixed cost provenance and legacy clients without quote snapshots", async () => {
  const f = fixture({ cost: { unitCost: 0, subtotalCost: 0, costKnown: false, unknownCostUnits: 1 } });
  const body = f.visitBody(); delete body.expectedFinancialSnapshot;
  assert.equal((await f.route("src/app/api/restock-visits/route.ts").POST(request(body))).status, 201);
  assert.equal(f.state().visits[0].items.create[0].unknownCostUnits, 1);
});

test("payment-only clears a fractional balance and rejects zero or finer-than-cent payments", async () => {
  const f = fixture({ balance: "14000.70" }); const route = f.route("src/app/api/settlements/pay/route.ts");
  const body = { storeId: "store", paidAmount: "14000.70", paymentMethod: "cash" };
  const result = await route.POST(request(body)); assert.equal(result.status, 201); assert.equal(result.body.closingBalance, 0);
  assert.equal((await route.POST(request(body))).status, 201); assert.equal(f.state().settlements.length, 1);
  for (const paidAmount of ["0.004", "0.00", "-1"]) assert.equal((await route.POST(request({ ...body, paidAmount }))).status, 400);
});

test("expense create and daily closing replay once and atomically roll back an audit failure", async () => {
  for (const [file, body] of [
    ["src/app/api/expenses/route.ts", { category: "ຄ່າຂົນສົ່ງ", amount: "0.05", incurredAt: "2026-10-01" }],
    ["src/app/api/daily-closing/route.ts", { closingDate: "2026-10-01", cashAmount: "0.05", bankAmount: "0.02", expenseAmount: "0.01" }],
  ]) {
    const f = fixture(); const route = f.route(file);
    assert.equal((await route.POST(request(body))).status, 201); assert.equal((await route.POST(request(body))).status, 201);
    assert.equal(f.state().expenses.length + f.state().closings.length, 1); assert.equal(f.state().audits.length, 1); assert.equal(f.state().receipts.length, 1);
    const failed = fixture({ auditFails: true }); assert.equal((await failed.route(file).POST(request(body))).status, 500);
    assert.equal(failed.state().expenses.length + failed.state().closings.length, 0); assert.equal(failed.state().receipts.length, 0);
    assert.equal((await route.POST(request(body, null))).status, 400);
    const changed = { ...body, ...(body.amount ? { amount: "0.06" } : { cashAmount: "0.06" }) };
    assert.equal((await route.POST(request(changed))).status, 409);
  }
});

test("expense and closing reject unsupported precision and invalid calendar dates", async () => {
  const f = fixture();
  const expenses = f.route("src/app/api/expenses/route.ts"); const closing = f.route("src/app/api/daily-closing/route.ts");
  assert.equal((await expenses.POST(request({ amount: ".004" }))).status, 400);
  assert.equal((await expenses.POST(request({ amount: "1.00", incurredAt: "2026-02-31" }))).status, 400);
  assert.equal((await closing.POST(request({ closingDate: "2026-10-01", cashAmount: "0.004" }))).status, 400);
  assert.equal((await closing.POST(request({ closingDate: "2026-02-31", cashAmount: "1.00" }))).status, 400);
  assert.equal(f.state().expenses.length + f.state().closings.length, 0);
});

test("daily closing refuses a blind overwrite and preserves every recorded amount", async () => {
  const closing = { id: "recorded-day", closingDate: dateOnly.parseDateOnly("2026-10-01"), cashAmount: "100.00", bankAmount: "200.00", expenseAmount: "30.00", note: "recorded" };
  const f = fixture({ closing });
  const result = await f.route("src/app/api/daily-closing/route.ts").POST(request({ closingDate: "2026-10-01", cashAmount: "110", bankAmount: "0", expenseAmount: "0" }));
  assert.equal(result.status, 409, "an existing day requires the snapshot the user actually reviewed");
  assert.deepEqual(f.state().closings[0], closing);
  assert.equal(f.state().audits.length, 0);
  assert.equal(f.state().receipts.length, 0);
});

test("daily closing applies a reviewed edit once and rejects another editor's stale snapshot", async () => {
  const closing = { id: "recorded-day", closingDate: dateOnly.parseDateOnly("2026-10-01"), cashAmount: "100.00", bankAmount: "200.00", expenseAmount: "30.00", note: "recorded" };
  const expectedSnapshot = { id: closing.id, cashAmount: "100.00", bankAmount: "200.00", expenseAmount: "30.00", note: "recorded" };
  const f = fixture({ closing }); const route = f.route("src/app/api/daily-closing/route.ts");
  const body = { closingDate: "2026-10-01", cashAmount: "110.00", bankAmount: "200.00", expenseAmount: "30.00", note: "corrected", expectedSnapshot };
  const saved = await route.POST(request(body));
  assert.equal(saved.status, 201);
  assert.equal((await route.POST(request(body))).status, 201, "same-key retry must recover the accepted edit");
  assert.equal(f.state().audits.length, 1);
  assert.equal((await route.POST(request({ ...body, cashAmount: "120" }, "22222222-2222-4222-8222-222222222222"))).status, 409);
  assert.equal(f.state().closings[0].cashAmount, "110.00");
  assert.equal(f.state().closings[0].bankAmount, "200.00");
});

test("daily closing lookup returns the reviewed exact amounts only to administrators", async () => {
  const closing = { id: "recorded-day", closingDate: dateOnly.parseDateOnly("2026-10-01"), cashAmount: "100.5", bankAmount: "200", expenseAmount: "30", note: null };
  const f = fixture({ closing }); const route = f.route("src/app/api/daily-closing/route.ts");
  const found = await route.GET(new Request("https://money.test/api/daily-closing?date=2026-10-01"));
  assert.equal(found.status, 200);
  assert.equal(JSON.stringify(found.body), JSON.stringify({ closingDate: "2026-10-01", snapshot: { id: "recorded-day", cashAmount: "100.50", bankAmount: "200.00", expenseAmount: "30.00", note: null } }));
  const empty = await route.GET(new Request("https://money.test/api/daily-closing?date=2026-10-02"));
  assert.equal(empty.body.snapshot, null);
  assert.equal((await route.GET(new Request("https://money.test/api/daily-closing?date=2026-02-31"))).status, 400);
  for (const [session, status] of [[null, 401], [{ userId: "driver", role: "driver" }, 403], [{ userId: "production", role: "production" }, 403]]) {
    assert.equal((await fixture({ closing, session }).route("src/app/api/daily-closing/route.ts").GET(new Request("https://money.test/api/daily-closing?date=2026-10-01"))).status, status);
  }
});

test("daily closing rejects a stale new-day snapshot once another request has created that date", async () => {
  const f = fixture(); const route = f.route("src/app/api/daily-closing/route.ts");
  const body = { closingDate: "2026-10-01", cashAmount: "100", bankAmount: "200", expenseAmount: "30", expectedSnapshot: null };
  assert.equal((await route.POST(request(body))).status, 201);
  assert.equal((await route.POST(request({ ...body, cashAmount: "110" }, "22222222-2222-4222-8222-222222222222"))).status, 409);
  assert.equal(f.state().closings[0].cashAmount, "100.00");
});

test("closing responses require a complete exact-money snapshot before a form can confirm saving", () => {
  const snapshot = { id: "closing", cashAmount: "100.00", bankAmount: "200.00", expenseAmount: "30.00", note: null };
  assert.equal(dailyClosing.isDailyClosingSnapshot?.(snapshot), true);
  for (const value of [{}, null, { ...snapshot, id: "" }, { ...snapshot, cashAmount: "0.001" }, { ...snapshot, bankAmount: 200 }, { ...snapshot, note: undefined }]) {
    assert.equal(dailyClosing.isDailyClosingSnapshot?.(value), false);
  }
});

test("historical expense edits retain an inactive store, record accounting dates, and reject stale snapshots", async () => {
  const expense = { id: "historical", category: "transport", amount: "1.00", incurredAt: dateOnly.parseDateOnly("2026-09-30"), storeId: "store", note: null, receiptUrl: null, voidedAt: null };
  const f = fixture({ expense }); f.store.isActive = false;
  const route = f.route("src/app/api/expenses/[id]/route.ts"); const params = { params: Promise.resolve({ id: expense.id }) };
  const snapshot = { category: expense.category, amount: "1.00", incurredAt: "2026-09-30", storeId: "store", note: null, receiptUrl: null };
  const body = { storeId: "store", incurredAt: "2026-10-01", note: "corrected", expectedExpenseSnapshot: snapshot };
  assert.equal((await route.PATCH(request(body), params)).status, 200);
  assert.equal((await route.PATCH(request(body), params)).status, 200); assert.equal(f.state().audits.length, 1);
  assert.equal(f.state().audits[0].metadata.before.incurredAt, "2026-09-30T12:00:00.000Z");
  assert.equal(f.state().audits[0].metadata.after.incurredAt, "2026-10-01T12:00:00.000Z");
  assert.equal((await route.PATCH(request({ ...body, amount: "2.00" }, "22222222-2222-4222-8222-222222222222"), params)).status, 409);
  assert.equal(f.state().expenses[0].amount, "1.00");
});

test("expense void is idempotent and expense edit/void roll back when their audit fails", async () => {
  const expense = { id: "expense", category: "transport", amount: "1.00", incurredAt: dateOnly.parseDateOnly("2026-10-01"), storeId: null, note: null, receiptUrl: null, voidedAt: null };
  const params = { params: Promise.resolve({ id: expense.id }) };
  const f = fixture({ expense }); const route = f.route("src/app/api/expenses/[id]/route.ts");
  assert.equal((await route.DELETE(request({ reason: "mistake" }), params)).status, 200);
  assert.equal((await route.DELETE(request({ reason: "mistake" }), params)).status, 200); assert.equal(f.state().audits.length, 1);
  for (const method of ["PATCH", "DELETE"]) {
    const failed = fixture({ expense, auditFails: true });
    assert.equal((await failed.route("src/app/api/expenses/[id]/route.ts")[method](request(method === "PATCH" ? { amount: "2.00" } : { reason: "mistake" }), params)).status, 500);
    assert.equal(failed.state().expenses[0].amount, "1.00"); assert.equal(failed.state().expenses[0].voidedAt, null); assert.equal(failed.state().receipts.length, 0);
  }
});

test("business dates and default expenses stay in the local accounting month at midnight", () => {
  const boundary = new Date("2026-09-30T17:30:00.000Z");
  assert.equal(dateOnly.businessDateString(boundary), "2026-10-01");
  assert.equal(dateOnly.businessDateOnly(boundary).toISOString(), "2026-10-01T12:00:00.000Z");
});

test("the payment form schema accepts a full fractional balance and rejects finer precision", () => {
  const imports = { "next/link": {}, react: {}, "react/jsx-runtime": {}, "react-hook-form": {}, "@hookform/resolvers/zod": {}, zod: { z }, "@/lib/business": {}, "@/lib/toast": {}, "@/lib/pending-request": {}, "@/lib/money": money, "@/lib/operation-request": {}, "@/components/action-dialog": {}, "@/lib/restock-draft": {}, "@/lib/use-unsaved-changes": {} };
  const form = loadModule("src/components/restock-audit-form.tsx", imports, "\nexport { paymentSchema };\n");
  assert.equal(form.paymentSchema.safeParse({ paymentMethod: "cash", paidAmount: "14000.70" }).success, true);
  assert.equal(form.paymentSchema.safeParse({ paymentMethod: "cash", paidAmount: "0.004" }).success, false);
});

test("the financial form only treats a complete monetary receipt as confirmed success", () => {
  const imports = { "next/link": {}, react: {}, "react/jsx-runtime": {}, "react-hook-form": {}, "@hookform/resolvers/zod": {}, zod: { z }, "@/lib/business": {}, "@/lib/toast": {}, "@/lib/pending-request": {}, "@/lib/money": money, "@/lib/operation-request": {}, "@/components/action-dialog": {}, "@/lib/restock-draft": {}, "@/lib/use-unsaved-changes": {} };
  const form = loadModule("src/components/restock-audit-form.tsx", imports, "\nexport { isCompletionResult };\n");
  const receipt = { receiptNumber: "PM-123", previousBalance: 14000.7, paidAmount: 14000.7, closingBalance: 0, paymentStatus: "paid" };
  assert.equal(form.isCompletionResult(receipt), true);
  for (const value of [null, {}, { ...receipt, receiptNumber: "" }, { ...receipt, paidAmount: "14000.70" }, { ...receipt, closingBalance: -1 }, { ...receipt, previousBalance: Infinity }, { ...receipt, paymentStatus: "unknown" }]) {
    assert.equal(form.isCompletionResult(value), false);
  }
});
