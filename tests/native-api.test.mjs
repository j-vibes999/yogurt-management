import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { businessDateString, businessReportRange, parseDateOnly } from "../src/lib/date-only.ts";
import { dailyClosingSnapshot } from "../src/lib/daily-closing.ts";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { Prisma } = require("@prisma/client");
const decimal = value => new Prisma.Decimal(value);
const at = new Date("2026-10-28T20:30:00.000Z");
const product = { id: "p-1", code: "YG", name: "Yogurt", sizeDescription: null, retailPrice: decimal("12000.01"), shelfLifeDays: 21, isActive: true, hidden: "omit" };
const material = { id: "m-1", code: "MILK", name: "Milk", category: "ingredient", unit: "L", currentStock: decimal("123.123456"), minStockAlert: decimal("5.001"), avgCostPerUnit: decimal("10.9091"), isActive: true, hidden: "omit" };
const recipe = { id: "r-1", name: "Recipe", finishedProductId: "p-1", version: 3, baseCups: 100, isDefault: true, finishedProduct: product, items: [{ rawMaterialId: "m-1", quantityRequired: decimal("2.1234"), rawMaterial: material, hidden: "omit" }], hidden: "omit" };
const settlement = { id: "settle-1", receiptNumber: "ST-ONE", slipImageUrl: "/api/receipts/one.png", settlementDate: at, grossAmount: decimal("10.01"), storeCommissionAmount: decimal("3"), netPayableAmount: decimal("7.01"), previousBalance: decimal("100.01"), paidAmount: decimal("2.01"), closingBalance: decimal("105.01"), paymentStatus: "partial", paymentMethod: "cash", hidden: "omit" };
const store = { id: "s-1", name: "Shop", contactName: null, phone: "020", whatsapp: null, facebook: null, address: null, latitude: decimal("17.1234567"), longitude: decimal("102.1234567"), fridgeStartDate: at, commissionRate: decimal("0.3333"), monthlyElectricity: decimal("200000.01"), isActive: true, fridge: { id: "f-1", assetCode: "FR-1", model: null, serialNo: null, capacityCups: 100, status: "active" }, fridgeInventory: [{ id: "i-1", fridgeId: "f-1", finishedProductId: "p-1", currentStock: 20, lastAuditDate: at, finishedProduct: product }], refillRequests: [{ id: "refill-1", status: "waiting", requestedAt: at, deliveredAt: null, note: null, items: [{ finishedProductId: "p-1", quantity: 5, finishedProduct: product }] }], settlements: [settlement], restockVisits: [{ id: "v-1", visitDate: at, status: "completed" }], hidden: "omit" };
const expense = { id: "e-1", category: "fuel", amount: decimal("123456789012.34"), incurredAt: at, storeId: "s-1", store: { name: "Shop" }, note: null, receiptUrl: null, voidedAt: null, hidden: "omit" };

function load(path, imports) {
  const url = new URL(`../${path}`, import.meta.url);
  if (!existsSync(url)) return {};
  const source = ts.transpileModule(readFileSync(url, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, module: { exports }, URL, URLSearchParams, Date, Set, Map, console, process: { cwd: () => "/synthetic", env: { DATABASE_URL: "postgresql://synthetic" } }, require: name => {
    if (Object.hasOwn(imports, name)) return imports[name];
    throw new Error(`Unexpected import ${name} in ${path}`);
  } });
  return exports;
}

function fixture({ role = "admin", noSession = false, failure = false, source = "database", missing = false } = {}) {
  const calls = [];
  const read = (name, result) => async options => { calls.push({ name, options }); if (failure) throw new Error("postgresql://private:password@host/db"); return missing ? null : result; };
  const dashboard = { source, stores: [], settlements: [settlement], refills: [], lowMaterials: [{ id: "m-1", avgCost: 10 }], weeklyGross: 100, ownerNet: 90, outstanding: 20, cupsInStores: 5, dueStores: 1, totalCapacity: 100 };
  const helpers = {
    getDashboardData: read("dashboard", dashboard),
    getNotificationsData: async promise => { calls.push({ name: "notifications", options: promise }); return { source, alerts: [{ id: "stock", href: "/inventory" }, { id: "money", href: "/settlements" }, { id: "refills", href: "/refills" }, { id: "users", href: "/operations" }] }; },
    getStoresData: read("stores", { source, stores: [] }), getMapData: read("map", { source, stores: [] }), getRefillsData: read("refills", { source, refills: [] }),
    getRestockStoreData: read("restock", { source, data: missing ? null : { store: { id: "s-1", name: "Shop", address: "", phone: "020", latitude: 17, longitude: 102, commissionRate: 0.3333 }, fridge: { assetCode: "FR-1" }, previousBalance: 105.01, lines: [{ productId: "p-1", name: "Yogurt", color: "#abc", retailPrice: 12000.01, previousStock: 20, refilledSinceAudit: 5 }] } }),
    getInventoryData: read("inventory", { source, materials: [] }), getProductionData: read("production", { source, products: [], batches: [], adjustmentBatches: [], totalBatches: 0, historyPage: null, pageCount: 1, centralStockTotal: 0 }),
    getSettlementsData: read("settlements", { source, settlements: [{ id: "ST-ONE", gross: 10.01, commission: 3, net: 7.01, paid: 2.01, closingBalance: 105.01, status: "partial" }] }), getExpensesData: read("expenses", { source, expenses: [] }), getReportsData: read("reports", { source, netProfit: 1 }), getFridgesData: read("fridges", { source, fridges: [] }), getStoreOptions: read("storeOptions", { source, stores: [{ id: "s-1", name: "Shop" }] }),
  };
  const prisma = {
    store: { findUnique: read("store.findUnique", store), findMany: read("store.findMany", [{ id: "s-1", name: "Shop", fridge: { id: "f-1" }, hidden: "omit" }]) },
    refillRequest: { findUnique: read("refillRequest.findUnique", { ...store.refillRequests[0], status: "completed", storeId: "s-1", store }) },
    expense: { findUnique: read("expense.findUnique", expense) }, settlement: { findMany: read("settlement.findMany", [settlement]) }, rawMaterial: { findMany: read("rawMaterial.findMany", [material]) }, finishedProduct: { findMany: read("finishedProduct.findMany", [product]) }, recipe: { findMany: read("recipe.findMany", [recipe]) }, expenseCategory: { findMany: read("expenseCategory.findMany", [{ id: "cat-1", name: "fuel", hidden: "omit" }]) },
    auditLog: { count: read("auditLog.count", 51), findMany: read("auditLog.findMany", [{ id: "a-1", action: "update", entityType: "store", entityId: "s-1", storeId: "s-1", summary: "Changed", createdAt: at, user: { fullName: "Owner", role: "admin", passwordHash: "secret" }, store: { name: "Shop" }, metadata: { before: { name: "Old", passwordHash: "secret" }, after: { name: "New", password: "secret" }, token: "secret" }, passwordHash: "secret" }]) },
    dailyClosing: { findUnique: read("dailyClosing.findUnique", { id: "c-1", cashAmount: decimal("100.01"), bankAmount: decimal("2.02"), expenseAmount: decimal("3.03"), note: null }) },
  };
  const access = load("src/lib/native-access.ts", {});
  const policy = load("src/lib/access-policy.ts", { "./native-access.ts": access });
  const data = load("src/lib/native-data.ts", { "@/lib/prisma": { prisma }, "@/lib/db-data": helpers, "@/lib/access-policy": policy, "@/lib/native-access": access, "@/lib/date-only": { businessDateString, businessReportRange, parseDateOnly }, "@/lib/daily-closing": { dailyClosingSnapshot }, "@/lib/backup-readiness": { loadBackupReadiness: read("backup", { ok: true, ageHours: 1, restoreVerified: true, reasons: [] }) } });
  const route = load("src/app/api/native/v1/[resource]/route.ts", { "next/server": { NextResponse: { json: (body, options = {}) => ({ body: JSON.parse(JSON.stringify(body)), status: options.status ?? 200, headers: options.headers ?? {} }) } }, "@/lib/server-session": { getCurrentSession: async () => noSession ? null : { role, userId: "u-1" } }, "@/lib/native-access": access, "@/lib/native-data": data, "@/lib/logger": { logError() {} } });
  return { route, access, policy, calls, data, request: async (resource, query = "") => { assert.equal(typeof route.GET, "function", "native GET route must exist"); return route.GET(new Request(`http://127.0.0.1:43188/api/native/v1/${resource}${query}`), { params: Promise.resolve({ resource }) }); } };
}

test("native reads require a current session before loading any business data", async () => {
  const f = fixture({ noSession: true });
  assert.equal((await f.request("stores")).status, 401);
  assert.equal(f.calls.length, 0);
});

test("native role policy supports production refill reads and driver catalog choices without mutation access", async () => {
  const f = fixture({ role: "production" });
  assert.equal((await f.request("refills")).status, 200);
  assert.equal((await f.request("expenses")).status, 403);
  assert.deepEqual(Array.from(f.policy.rolesForApi("/api/refills", "POST")), ["admin", "driver"]);
  assert.deepEqual(Array.from(f.policy.rolesForApi("/api/native/v1/refills", "GET")), ["admin", "production", "driver"]);
  assert.deepEqual(Array.from(f.policy.rolesForApi("/api/native/v1/refills", "POST")), []);
  assert.equal((await fixture({ role: "driver" }).request("production")).status, 403);
});

test("unknown resources and invalid or duplicate filters never reach loaders", async () => {
  for (const [resource, query, status] of [["users", "", 404], ["store", "", 400], ["store", "?id=../../private", 400], ["expenses", "?page=1e3", 400], ["audit", "?filter=sql", 400], ["production", "?historyPage=0", 400], ["reports", "?period=year", 400], ["stores", "?model=User", 400], ["expenses", "?page=1&page=2", 400], ["closing", "?date=2026-02-30", 400]]) {
    const f = fixture();
    assert.equal((await f.request(resource, query)).status, status, `${resource}${query}`);
    assert.equal(f.calls.length, 0);
  }
});

test("every allowed read returns the versioned no-store envelope", async () => {
  for (const resource of ["overview", "stores", "store", "map", "refills", "restock", "inventory", "production", "settlements", "expenses", "expense", "reports", "notifications", "operations", "fridges", "audit", "catalog", "closing"]) {
    const query = ["store", "restock", "expense"].includes(resource) ? "?id=s-1" : resource === "closing" ? "?date=2026-10-29" : "";
    const response = await fixture().request(resource, query);
    assert.equal(response.status, 200, resource);
    assert.equal(response.body.version, 1);
    assert.equal(response.body.resource, resource);
    assert.equal(response.body.source, "database");
    assert.ok(Number.isFinite(Date.parse(response.body.generatedAt)));
    assert.equal(response.headers["Cache-Control"], "private, no-store, max-age=0");
  }
});

test("native error responses distinguish missing records and unavailable loaders without leaking secrets", async () => {
  for (const resource of ["store", "expense", "restock"]) assert.equal((await fixture({ missing: true }).request(resource, "?id=missing")).status, 404);
  const response = await fixture({ failure: true }).request("operations");
  assert.equal(response.status, 503);
  assert.doesNotMatch(JSON.stringify(response.body), /postgresql|password|private:/);
  assert.equal((await fixture({ source: "demo" }).request("stores")).body.source, "demo");
});

test("store reads retain exact editable values, current-fridge stock, bounded history and persisted receipts", async () => {
  const f = fixture();
  const { body: { data } } = await f.request("store", "?id=s-1");
  assert.equal(data.store.commissionRate, "0.3333");
  assert.equal(data.store.monthlyElectricity, "200000.01");
  assert.equal(data.store.latitude, "17.1234567");
  assert.equal(data.store.contactName, null);
  assert.equal(data.latestBalance, "105.01");
  assert.equal(data.inventory[0].currentStock, 20);
  assert.equal(data.settlements[0].paidAmount, "2.01");
  assert.equal(data.settlements[0].receiptNumber, "ST-ONE");
  assert.equal(data.settlements[0].receiptPath, "/api/receipts/one.png");
  assert.doesNotMatch(JSON.stringify(data), /hidden/);
  const query = f.calls.find(call => call.name === "store.findUnique").options;
  assert.deepEqual(JSON.parse(JSON.stringify(query.where)), { id: "s-1" });
  assert.equal(query.select.settlements.take, 8);
  assert.equal(query.select.refillRequests.take, 5);
  assert.equal(query.select.restockVisits.take, 6);
  assert.equal(query.select.fridgeInventory.where.fridge.currentStoreId, "s-1");
  assert.ok(!f.calls.some(call => call.name === "stores"));
});

test("restock projection supplies exact financial compare-and-swap values", async () => {
  const { body: { data } } = await fixture().request("restock", "?id=s-1");
  assert.equal(data.data.previousBalance, "105.01");
  assert.equal(data.data.store.commissionRate, "0.3333");
  assert.equal(data.data.lines[0].retailPrice, "12000.01");
  assert.deepEqual(data.data.expectedFinancialSnapshot, { previousBalance: "105.01", commissionRate: "0.3333", retailPrices: [{ productId: "p-1", retailPrice: "12000.01" }] });
});

test("expense edit reads return raw exact cents and the original nullable date-only snapshot", async () => {
  const { body: { data } } = await fixture().request("expense", "?id=e-1");
  assert.equal(data.expense.amount, "123456789012.34");
  assert.deepEqual(data.expense.expectedExpenseSnapshot, { category: "fuel", amount: "123456789012.34", incurredAt: "2026-10-29", storeId: "s-1", note: null, receiptUrl: null });
  assert.doesNotMatch(JSON.stringify(data), /hidden/);
});

test("catalog projection strips private fields and restricts costs and finance options by role", async () => {
  const driver = (await fixture({ role: "driver" }).request("catalog")).body.data;
  assert.deepEqual(driver.stores, [{ id: "s-1", name: "Shop", fridgeId: "f-1" }]);
  assert.equal(driver.products[0].retailPrice, "12000.01");
  assert.deepEqual(driver.materials, []);
  assert.deepEqual(driver.recipes, []);
  assert.deepEqual(driver.categories, []);
  const production = (await fixture({ role: "production" }).request("catalog")).body.data;
  assert.equal(production.materials[0].currentStock, "123.123456");
  assert.deepEqual(production.stores, []);
  assert.deepEqual(production.categories, []);
  assert.equal(production.recipes[0].items[0].quantityRequired, "2.1234");
  assert.doesNotMatch(JSON.stringify(production), /hidden/);
});

test("inventory and production expose exact stock/cost fields rather than rounded display values", async () => {
  const inventory = (await fixture().request("inventory")).body.data;
  assert.equal(inventory.rawMaterials[0].currentStock, "123.123456");
  assert.equal(inventory.rawMaterials[0].minStockAlert, "5.001");
  assert.equal(inventory.rawMaterials[0].avgCostPerUnit, "10.9091");
  const production = (await fixture().request("production", "?historyPage=2")).body.data;
  assert.equal(production.recipes[0].items[0].rawMaterial.avgCostPerUnit, "10.9091");
});

test("overview shares the dashboard load and filters inaccessible notification and dashboard data", async () => {
  const f = fixture({ role: "driver" });
  const response = await f.request("overview");
  assert.equal(f.calls.filter(call => call.name === "dashboard").length, 1);
  assert.deepEqual(response.body.data.dashboard.lowMaterials, []);
  assert.deepEqual(response.body.data.notifications.alerts.map(alert => alert.id), ["money", "refills"]);
});

test("week reports use seven Laos calendar days and validated pagination reaches authoritative helpers", async () => {
  const reports = fixture();
  await reports.request("reports", "?period=week");
  const range = reports.calls.find(call => call.name === "reports").options;
  assert.equal((range.to - range.from) / 86400000, 7);
  const settlements = fixture();
  await settlements.request("settlements", "?query=%20Shop%20&filter=partial&page=2");
  assert.deepEqual(JSON.parse(JSON.stringify(settlements.calls.find(call => call.name === "settlements").options)), { query: "Shop", filter: "partial", page: 2 });
});

test("audit data uses bounded explicit actor projections and removes sensitive metadata recursively", async () => {
  const f = fixture();
  const { body: { data } } = await f.request("audit", "?query=Shop&filter=update&page=2");
  assert.equal(data.page, 2);
  assert.equal(data.totalPages, 2);
  assert.equal(data.pageSize, 50);
  assert.equal(data.logs[0].user.fullName, "Owner");
  assert.equal(data.logs[0].metadata.before.name, "Old");
  assert.doesNotMatch(JSON.stringify(data), /secret|password|token/);
  const query = f.calls.find(call => call.name === "auditLog.findMany").options;
  assert.equal(query.take, 50);
  assert.equal(query.skip, 50);
  assert.deepEqual(Object.keys(query.select.user.select).sort(), ["fullName", "role"]);
});

test("daily closing reads keep precise existing CAS snapshots and remain admin-only", async () => {
  const { body: { data } } = await fixture().request("closing", "?date=2026-10-29");
  assert.deepEqual(data, { closingDate: "2026-10-29", snapshot: { id: "c-1", cashAmount: "100.01", bankAmount: "2.02", expenseAmount: "3.03", note: null } });
  assert.equal((await fixture({ role: "production" }).request("closing", "?date=2026-10-29")).status, 403);
});

test("settlement history retains display keys and adds only its persisted bounded receipt details", async () => {
  const f = fixture();
  const { body: { data } } = await f.request("settlements");
  assert.equal(data.settlements[0].gross, 10.01);
  assert.equal(data.settlements[0].receiptNumber, "ST-ONE");
  assert.equal(data.settlements[0].receiptPath, "/api/receipts/one.png");
  assert.equal(data.settlements[0].previousBalance, "100.01");
  assert.equal(data.settlements[0].grossAmount, "10.01");
  assert.equal(data.settlements[0].closingBalanceExact, "105.01");
  assert.equal(data.settlements[0].paymentMethod, "cash");
  assert.equal(data.settlements[0].settlementDate, "2026-10-28T20:30:00.000Z");
  assert.doesNotMatch(JSON.stringify(data), /hidden/);
});

test("exact refill reads reconcile a completed lifecycle command after it has left the active queue", async () => {
  const f = fixture({ role: "production" });
  const response = await f.request("refills", "?id=refill-1");
  assert.equal(response.status, 200);
  assert.equal(response.body.data.refills[0].status, "completed");
  assert.equal(response.body.data.refills[0].items[0].productId, "p-1");
  assert.ok(!f.calls.some(call => call.name === "refills"));
  assert.equal((await fixture({ missing: true }).request("refills", "?id=missing")).status, 404);
});

test("production store details expose only the old visible latest payment summary, with no receipt history", async () => {
  const f = fixture({ role: "production" });
  const { body: { data } } = await f.request("store", "?id=s-1");
  assert.deepEqual(data.settlements, []);
  assert.deepEqual(data.latestSettlement, { paidAmount: "2.01", closingBalance: "105.01", settlementDate: "2026-10-28T20:30:00.000Z" });
  const select = f.calls.find(call => call.name === "store.findUnique").options.select.settlements;
  assert.equal(select.take, 1);
  assert.deepEqual(Object.keys(select.select).sort(), ["closingBalance", "paidAmount", "settlementDate"]);
});

test("overview omits unused settlement records and only administrators receive owner net", async () => {
  for (const role of ["admin", "production", "driver"]) {
    const { body: { data } } = await fixture({ role }).request("overview");
    assert.deepEqual(data.dashboard.settlements, []);
    assert.equal(data.dashboard.ownerNet, role === "admin" ? 90 : 0);
    assert.equal(data.dashboard.weeklyGross, 100);
  }
});

test("report data carries the exact half-open Laos date range passed to the existing calculator", async () => {
  const f = fixture();
  const { body: { data } } = await f.request("reports", "?period=week");
  const range = f.calls.find(call => call.name === "reports").options;
  assert.deepEqual(data.range, { from: range.from.toISOString(), to: range.to.toISOString(), timeZone: "Asia/Vientiane" });
  assert.equal((Date.parse(data.range.to) - Date.parse(data.range.from)) / 86400000, 7);
});
