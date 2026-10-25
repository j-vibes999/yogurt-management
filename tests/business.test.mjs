import test from "node:test";
import assert from "node:assert/strict";
import { calculateRestockLine, calculateLiveRestockLine, calculateSettlement } from "../src/lib/business.ts";
import { latestSettlementsByStore } from "../src/lib/latest-settlements.ts";

test("weekly restock formula includes delivered refills and excludes expired returns", () => {
  const result = calculateRestockLine({
    previousStock: 20,
    countRefilled: 15,
    countRemaining: 8,
    countExpiredReturned: 2,
    retailPrice: 20000,
  });
  assert.equal(result.unitsSold, 25);
  assert.equal(result.subtotalGross, 500000);
  assert.equal(result.hasNegativeSale, false);
});

test("negative reconciliation remains visible as a warning", () => {
  const result = calculateRestockLine({
    previousStock: 5,
    countRefilled: 0,
    countRemaining: 8,
    countExpiredReturned: 0,
    retailPrice: 20000,
  });
  assert.equal(result.unitsSold, -3);
  assert.equal(result.hasNegativeSale, true);
});

test("live fridge stock already includes delivered refills", () => {
  const result = calculateLiveRestockLine({ previousStock: 35, countRefilled: 15, countRemaining: 8, countExpiredReturned: 2, retailPrice: 20000 });
  assert.equal(result.countRefilled, 15);
  assert.equal(result.unitsSold, 25);
  assert.equal(result.subtotalGross, 500000);
});

test("current receivables ignore older unsettled rows after a later payment", () => {
  const rows = [
    { storeId: "one", closingBalance: 0, status: "paid" },
    { storeId: "two", closingBalance: 100, status: "partial" },
    { storeId: "one", closingBalance: 500, status: "pending" },
  ];
  assert.deepEqual(latestSettlementsByStore(rows), [rows[0], rows[1]]);
});

test("settlement preserves the 30/70 consignment split", () => {
  const result = calculateSettlement(1000000, 0.3);
  assert.equal(result.storeCommissionAmount, 300000);
  assert.equal(result.netPayableAmount, 700000);
});

test("commission is bounded between zero and one", () => {
  assert.equal(calculateSettlement(100, 9).netPayableAmount, 0);
  assert.equal(calculateSettlement(100, -1).netPayableAmount, 100);
});
