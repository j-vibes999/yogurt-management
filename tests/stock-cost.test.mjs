import test from "node:test";
import assert from "node:assert/strict";
import { ensureFridgeLots, consumeFridgeLots } from "../src/lib/stock-cost.ts";

const identity = { storeId: "store", fridgeId: "fridge", productId: "product" };
const stock = (id, quantity, cost, extra = {}) => ({
  id, storeId: identity.storeId, fridgeId: identity.fridgeId, finishedProductId: identity.productId,
  quantityReceived: quantity, quantityRemaining: quantity, unitCost: cost,
  costKnown: true, isLegacy: false, expDate: new Date("2026-10-10T00:00:00Z"),
  createdAt: new Date("2026-10-01T00:00:00Z"), ...extra,
});
function fixture(initial) {
  const lots = structuredClone(initial);
  const matching = where => lots.filter(lot => Object.entries(where).every(([key, value]) =>
    key === "quantityRemaining" ? lot.quantityRemaining > value.gt : lot[key] === value));
  const tx = { fridgeStockLot: {
    aggregate: async ({ where }) => ({ _sum: { quantityRemaining: matching(where).reduce((sum, lot) => sum + lot.quantityRemaining, 0) } }),
    create: async ({ data }) => { const lot = { id: `legacy-${lots.length}`, expDate: null, createdAt: new Date("2026-10-02T00:00:00Z"), ...data }; lots.push(lot); return lot; },
    findMany: async ({ where, orderBy }) => matching(where).sort((left, right) => {
      for (const order of orderBy) {
        const [key, direction] = Object.entries(order)[0];
        const a = left[key], b = right[key];
        if (a === b || (a instanceof Date && b instanceof Date && a.getTime() === b.getTime())) continue;
        // PostgreSQL sorts null last in ascending expiry order.
        const comparison = a === null ? 1 : b === null ? -1 : a < b ? -1 : 1;
        return comparison * (direction === "asc" ? 1 : -1);
      }
      return 0;
    }),
    update: async ({ where, data }) => { const lot = lots.find(row => row.id === where.id); lot.quantityRemaining -= data.quantityRemaining.decrement; return lot; },
  } };
  return { tx, lots };
}

test("sold stock retains the delivered lot costs and FEFO returns do not become sold cost", async () => {
  const f = fixture([
    stock("early", 3, "10", { expDate: new Date("2026-10-09T00:00:00Z") }),
    stock("later", 7, "100"),
  ]);
  const result = await consumeFridgeLots(f.tx, { ...identity, currentStock: 10, unitsSold: 4, expiredReturned: 1 });
  // One early cup is returned; two early and two later cups are sold.
  assert.deepEqual(result, { subtotalCost: 220, unitCost: 55, costKnown: true, unknownCostUnits: 0 });
  assert.deepEqual(f.lots.map(lot => lot.quantityRemaining), [0, 5]);
  assert.equal(f.lots.reduce((sum, lot) => sum + lot.quantityRemaining, 0), 10 - 4 - 1);
});

test("an actual zero-cost lot is known and never becomes an unknown-cost estimate", async () => {
  const f = fixture([stock("free", 3, "0")]);
  const result = await consumeFridgeLots(f.tx, { ...identity, currentStock: 3, unitsSold: 2, expiredReturned: 0 });
  assert.deepEqual(result, { subtotalCost: 0, unitCost: 0, costKnown: true, unknownCostUnits: 0 });
  assert.equal(f.lots[0].quantityRemaining, 1);
});

test("missing legacy units remain explicitly unknown while new delivered costs stay known", async () => {
  const f = fixture([stock("new", 3, "10")]);
  await ensureFridgeLots(f.tx, { ...identity, currentStock: 8 });
  await ensureFridgeLots(f.tx, { ...identity, currentStock: 8 });
  assert.equal(f.lots.length, 2, "ensuring provenance twice must not create duplicate legacy units");
  assert.equal(f.lots[1].quantityRemaining, 5);
  assert.equal(f.lots[1].costKnown, false);
  const result = await consumeFridgeLots(f.tx, { ...identity, currentStock: 8, unitsSold: 7, expiredReturned: 0 });
  assert.equal(result.subtotalCost, 20);
  assert.equal(result.unknownCostUnits, 5);
  assert.equal(result.costKnown, false);
  assert.deepEqual(f.lots.map(lot => lot.quantityRemaining), [1, 0]);
});

test("lot reconciliation refuses more recorded stock than the audited inventory", async () => {
  const f = fixture([stock("excess", 9, "10")]);
  await assert.rejects(consumeFridgeLots(f.tx, { ...identity, currentStock: 8, unitsSold: 1, expiredReturned: 0 }), /STOCK_LOT_MISMATCH/);
  assert.equal(f.lots[0].quantityRemaining, 9);
});

test("sub-cent delivered costs accumulate before the sold-line total is rounded", async () => {
  const f = fixture([stock("small", 1000, "0.0040")]);
  const result = await consumeFridgeLots(f.tx, { ...identity, currentStock: 1000, unitsSold: 1000, expiredReturned: 0 });
  assert.deepEqual(result, { subtotalCost: 4, unitCost: .004, costKnown: true, unknownCostUnits: 0 });
});
