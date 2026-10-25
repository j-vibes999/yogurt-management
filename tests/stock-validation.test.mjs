import test from "node:test";
import assert from "node:assert/strict";
import {
  decimalAtScale,
  parseBaseCups,
  productionCosts,
  productionRequirement,
  receiptStockAndCost,
  RECIPE_SCALE,
  STOCK_SCALE,
  UNIT_COST_SCALE,
} from "../src/lib/stock-validation.ts";

test("recipe quantities must stay positive and unchanged at the stored precision", () => {
  for (const value of [0, -1, "0.00001", "0.00005", "1.23456", "", null, true, Infinity, "NaN"]) {
    assert.equal(decimalAtScale(value, RECIPE_SCALE, { positive: true }), null, String(value));
  }
  assert.equal(decimalAtScale("0.0001", RECIPE_SCALE, { positive: true }).toString(), "0.0001");
  assert.equal(decimalAtScale("1.25000", RECIPE_SCALE, { positive: true }).toString(), "1.25");
  assert.equal(decimalAtScale("1e-4", RECIPE_SCALE, { positive: true }).toString(), "0.0001");
});

test("stock movements reject amounts that the stock column cannot record", () => {
  for (const value of ["0.0000001", "-0.0000001", 0, "100000000", "1.1234567"]) {
    assert.equal(decimalAtScale(value, STOCK_SCALE, { allowNegative: true, nonzero: true }), null, value);
  }
  assert.equal(decimalAtScale("-0.000001", STOCK_SCALE, { allowNegative: true, nonzero: true }).toString(), "-0.000001");
  assert.equal(decimalAtScale("99999999.999999", STOCK_SCALE).toString(), "99999999.999999");
  assert.equal(decimalAtScale("10000000000", UNIT_COST_SCALE), null);
});

test("cup counts are finite positive integers in the database integer range", () => {
  for (const value of [0, -1, 1.5, "", "1.5", null, true, Infinity, 2147483648]) {
    assert.equal(parseBaseCups(value), null, String(value));
  }
  assert.equal(parseBaseCups("1000"), 1000);
  assert.equal(parseBaseCups(2147483647), 2147483647);
});

test("small production cannot create cups with a zero material decrement", () => {
  assert.equal(productionRequirement("0.0001", 1, 1000), null);
  assert.equal(productionRequirement("0.0001", 1, 201), null);
  assert.equal(productionRequirement("0.0001", 1, 100).toString(), "0.000001");
  assert.equal(productionRequirement("1", 1, 3).toString(), "0.333333");
  assert.equal(productionRequirement("1", 2, 3).toString(), "0.666667");
  assert.equal(productionRequirement("0", 100, 100), null);
  assert.equal(productionRequirement("1", 1.5, 100), null);
});

test("successive receipts use the same recorded stock and weighted cost", () => {
  const first = receiptStockAndCost("100", "10", "5", "20");
  assert.equal(first.newStock.toString(), "105");
  assert.equal(first.weightedAvg.toString(), "10.4762");
  assert.equal(first.totalPrice.toString(), "100");
  const second = receiptStockAndCost(first.newStock, first.weightedAvg, "7", "30");
  assert.equal(second.newStock.toString(), "112");
  assert.equal(second.weightedAvg.toString(), "11.6964");
  assert.equal(second.totalPrice.toString(), "210");
});

test("receipt arithmetic preserves tiny quantities and rounds only stored costs", () => {
  const result = receiptStockAndCost("0", "0", "0.000001", "1234.5678");
  assert.equal(result.newStock.toString(), "0.000001");
  assert.equal(result.weightedAvg.toString(), "1234.5678");
  assert.equal(result.totalPrice.toString(), "0");
  assert.throws(() => receiptStockAndCost("99999999.999999", "1", "0.000001", "1"), /STOCK_VALUE_OUT_OF_RANGE/);
});

test("per-cup production costs preserve precision before the batch total is rounded", () => {
  const smallBatch = productionCosts("0.004", 1);
  assert.equal(smallBatch.totalMaterialCost.toString(), "0");
  assert.equal(smallBatch.unitCost.toString(), "0.004");
  assert.equal(smallBatch.unitCost.times(1000).toString(), "4");
  const multiCup = productionCosts("1.0049", 2);
  assert.equal(multiCup.totalMaterialCost.toString(), "1");
  assert.equal(multiCup.unitCost.toString(), "0.5025");
  assert.equal(productionCosts("0", 10).unitCost.toString(), "0");
  assert.throws(() => productionCosts("1", 0), /STOCK_VALUE_OUT_OF_RANGE/);
  assert.throws(() => productionCosts("-1", 1), /STOCK_VALUE_OUT_OF_RANGE/);
});
