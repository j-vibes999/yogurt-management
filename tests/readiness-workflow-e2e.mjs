import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { assertLocalScratchDatabase } from "../src/lib/backup-readiness.ts";

const database = assertLocalScratchDatabase(process.env.DATABASE_URL || "");
assert.match(database.pathname, /^\/yogurt_e2e_/);
const origin = new URL(process.env.E2E_BASE_URL || "http://127.0.0.1:3101");
assert.ok(origin.protocol === "http:" && ["127.0.0.1", "localhost"].includes(origin.hostname) && ["3101", "3121"].includes(origin.port), "readiness E2E requires a local test server");
const prisma = new PrismaClient();
const tag = `READINESS-${randomUUID().slice(0, 8)}`;
const now = Date.now();
let cookie;

async function request(path, body, method = "POST", key = randomUUID()) {
  const response = await fetch(new URL(path, origin), {
    method, headers: { "content-type": "application/json", "Idempotency-Key": key, ...(cookie ? { cookie } : {}) },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
async function product(label) {
  const row = await prisma.finishedProduct.create({ data: { code: `${tag}-${label}`, name: `${tag} ${label}`, retailPrice: "100.00", shelfLifeDays: 14, recipes: { create: { name: "Readiness fixture recipe", version: 1, baseCups: 100, isDefault: true } } }, include: { recipes: true } });
  return { ...row, recipeId: row.recipes[0].id };
}
async function batch(item, label, quantity, unitCost, expiryDays) {
  return prisma.productionBatch.create({ data: { batchNumber: `${tag}-${label}`, recipeId: item.recipeId, finishedProductId: item.id, quantityProduced: quantity, quantityRemaining: quantity, totalMaterialCost: String(quantity * Number(unitCost)), unitCost, costKnown: true, mfgDate: new Date(now - 10 * 86400000), expDate: new Date(now + expiryDays * 86400000), status: "completed" } });
}
async function store(label, items) {
  const row = await prisma.store.create({ data: { name: `${tag} ${label}`, commissionRate: "0.30" } });
  const fridge = await prisma.fridge.create({ data: { assetCode: `${tag}-${label}`, capacityCups: 100, currentStoreId: row.id, inventory: { create: items.map(({ item, quantity }) => ({ storeId: row.id, finishedProductId: item.id, currentStock: quantity })) } } });
  return { ...row, fridge };
}
async function refill(target, items) {
  const result = await request("/api/refills", { storeId: target.id, items: items.map(({ item, quantity }) => ({ finishedProductId: item.id, quantity })), note: tag });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal((await request(`/api/refills/${result.body.id}`, { status: "delivering" }, "PATCH")).status, 200);
  return result.body.id;
}
const complete = id => request(`/api/refills/${id}`, { status: "completed" }, "PATCH");

try {
  const identity = await prisma.$queryRaw`SELECT current_database() AS name`;
  assert.equal(identity[0].name, decodeURIComponent(database.pathname.slice(1)));
  const login = await request("/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  assert.equal(login.status, 200, "temporary clone administrator login"); cookie = login.cookie; assert.ok(cookie);

  const item = await product("FEFO"), expired = await batch(item, "EXPIRED", 9, "7.00", -1), early = await batch(item, "EARLY", 3, "10.25", 1), late = await batch(item, "LATE", 8, "20.50", 3);
  const destination = await store("FEFO", [{ item, quantity: 0 }]);
  const id = await refill(destination, [{ item, quantity: 5 }]);
  const beforeAudit = await prisma.auditLog.count({ where: { entityType: "refill_request", entityId: id, action: "status" } });
  const completions = await Promise.all([complete(id), complete(id)]);
  assert.deepEqual(completions.map(value => value.status), [200, 200]);
  assert.equal(completions.filter(value => value.body.alreadyApplied).length, 1);
  const balances = await Promise.all([expired, early, late].map(row => prisma.productionBatch.findUniqueOrThrow({ where: { id: row.id } })));
  assert.deepEqual(balances.map(row => row.quantityRemaining), [9, 0, 6]);
  const lots = await prisma.fridgeStockLot.findMany({ where: { refillRequestId: id }, orderBy: { expDate: "asc" } });
  assert.deepEqual(lots.map(row => [row.productionBatchId, row.quantityReceived, row.quantityRemaining, row.unitCost.toString(), row.costKnown]), [[early.id, 3, 3, "10.25", true], [late.id, 2, 2, "20.5", true]]);
  assert.equal((await complete(id)).body.alreadyApplied, true);
  assert.equal(await prisma.fridgeStockLot.count({ where: { refillRequestId: id } }), 2);
  assert.equal(await prisma.auditLog.count({ where: { entityType: "refill_request", entityId: id, action: "status" } }), beforeAudit + 1);
  console.log("PASS successful FEFO, expired exclusion, exact lot costs and concurrent replay");

  const raceItem = await product("RACE"), central = await batch(raceItem, "RACE-BATCH", 10, "12.34", 5);
  const stores = await Promise.all(["RACE-A", "RACE-B"].map(label => store(label, [{ item: raceItem, quantity: 1 }])));
  const requests = await Promise.all(stores.map(target => refill(target, [{ item: raceItem, quantity: 7 }])));
  const raceAudits = await Promise.all(requests.map(entityId => prisma.auditLog.count({ where: { entityType: "refill_request", entityId, action: "status" } })));
  const outcomes = await Promise.all(requests.map(complete));
  assert.deepEqual(outcomes.map(value => value.status).sort(), [200, 409]);
  assert.equal((await prisma.productionBatch.findUniqueOrThrow({ where: { id: central.id } })).quantityRemaining, 3);
  for (const [index, result] of outcomes.entries()) {
    const inventory = await prisma.fridgeInventory.findUniqueOrThrow({ where: { fridgeId_finishedProductId: { fridgeId: stores[index].fridge.id, finishedProductId: raceItem.id } } });
    const row = await prisma.refillRequest.findUniqueOrThrow({ where: { id: requests[index] } });
    const recordedLots = await prisma.fridgeStockLot.findMany({ where: { fridgeId: stores[index].fridge.id } });
    const audits = await prisma.auditLog.count({ where: { entityType: "refill_request", entityId: requests[index], action: "status" } });
    if (result.status === 200) { assert.equal(inventory.currentStock, 8); assert.equal(row.status, "completed"); assert.equal(recordedLots.reduce((sum, lot) => sum + lot.quantityRemaining, 0), 8); assert.equal(audits, raceAudits[index] + 1); }
    else { assert.equal(inventory.currentStock, 1); assert.equal(row.status, "delivering"); assert.equal(row.deliveredAt, null); assert.equal(recordedLots.length, 0); assert.equal(audits, raceAudits[index]); }
  }
  console.log("PASS competing stock demand rolls back the rejected delivery, lots and audit");

  const available = await product("MULTI-GOOD"), missing = await product("MULTI-EMPTY"), goodBatch = await batch(available, "MULTI-BATCH", 10, "6.78", 4);
  const multiStore = await store("MULTI", [{ item: available, quantity: 1 }, { item: missing, quantity: 1 }]);
  const multiId = await refill(multiStore, [{ item: available, quantity: 2 }, { item: missing, quantity: 4 }]);
  assert.equal((await complete(multiId)).status, 409);
  assert.equal((await prisma.productionBatch.findUniqueOrThrow({ where: { id: goodBatch.id } })).quantityRemaining, 10);
  assert.deepEqual((await prisma.fridgeInventory.findMany({ where: { fridgeId: multiStore.fridge.id } })).map(row => row.currentStock), [1, 1]);
  assert.equal(await prisma.fridgeStockLot.count({ where: { fridgeId: multiStore.fridge.id } }), 0);
  console.log("PASS multi-SKU shortage rolls back every earlier deduction");

  const date = "2199-12-31";
  const creation = { closingDate: date, cashAmount: "100.00", bankAmount: "200.00", expenseAmount: "30.00", note: tag, expectedSnapshot: null };
  assert.equal((await request("/api/daily-closing", creation)).status, 201);
  assert.equal((await request("/api/daily-closing", { ...creation, cashAmount: "110", bankAmount: "0", expenseAmount: "0" })).status, 409);
  const loaded = await request(`/api/daily-closing?date=${date}`, null, "GET");
  assert.equal(loaded.status, 200);
  assert.deepEqual([loaded.body.snapshot.cashAmount, loaded.body.snapshot.bankAmount, loaded.body.snapshot.expenseAmount], ["100.00", "200.00", "30.00"]);
  const edit = { ...creation, cashAmount: "110.00", expectedSnapshot: loaded.body.snapshot };
  const editKey = randomUUID(), accepted = await request("/api/daily-closing", edit, "POST", editKey);
  assert.equal(accepted.status, 201);
  assert.deepEqual((await request("/api/daily-closing", edit, "POST", editKey)).body, accepted.body);
  assert.equal((await request("/api/daily-closing", { ...edit, cashAmount: "120.00" })).status, 409);
  const saved = await request(`/api/daily-closing?date=${date}`, null, "GET");
  assert.deepEqual([saved.body.snapshot.cashAmount, saved.body.snapshot.bankAmount, saved.body.snapshot.expenseAmount], ["110.00", "200.00", "30.00"]);
  console.log("PASS closing lookup, blind/stale conflict and durable edit replay preserve recorded money");
} finally { await prisma.$disconnect(); }
