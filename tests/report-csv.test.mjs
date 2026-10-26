import assert from "node:assert/strict";
import test from "node:test";
import { buildReportCsv, csvCell } from "../src/lib/report-csv.ts";
import { businessDateString, businessReportRange } from "../src/lib/date-only.ts";

const row = { storeName: "Shop A", gross: 1000, storeShare: 300, electricity: 50, transport: 20, otherExpenses: 0, expenseTotal: 70, electricityBudget: 200, productCost: 280, wasteCost: 10, profit: 340 };
const summary = { gross: 1000, storeShare: 300, productCost: 280, wasteCost: 10, centralWasteCost: 0, expenses: 70, netProfit: 340, unallocatedExpenses: 0, electricityBudget: 200 };
const lines = (csv) => csv.replace(/^﻿/, "").split("\n");

test("report CSV states its period, time zone, data source and cost basis before the figures", () => {
  const csv = lines(buildReportCsv([row], summary, { from: "2026-10-01", to: "2026-10-31", timeZone: "Asia/Vientiane", source: "database", costMode: "estimated" }));
  assert.match(csv[0], /^"Report period[^"]*","2026-10-01 – 2026-10-31"$/);
  assert.equal(csv[1], '"Time zone","Asia/Vientiane"');
  assert.equal(csv[2], '"Data source","Database"');
  assert.match(csv[3], /Partly estimated.*28%/);
  assert.equal(csv[4], "");
  assert.match(csv[5], /^"Store","Gross"/);
  assert.match(csv[6], /^"Shop A","1000.00"/);
  assert.match(csv.at(-1), /^"TOTAL","1000.00".*"340.00"$/);
});

test("report CSV marks actual costs and sample data plainly", () => {
  const actual = buildReportCsv([row], summary, { from: "2026-10-25", to: "2026-10-25", timeZone: "Asia/Vientiane", source: "database", costMode: "actual" });
  assert.match(actual, /"Cost basis[^"]*","Actual recorded cost/);
  const demo = buildReportCsv([row], summary, { from: "2026-10-25", to: "2026-10-25", timeZone: "Asia/Vientiane", source: "demo", costMode: "estimated" });
  assert.match(demo, /"Data source","Sample data/);
});

test("report CSV without context keeps the header on the first line, and formulas stay text", () => {
  assert.match(lines(buildReportCsv([row]))[0], /^"Store","Gross"/);
  assert.equal(csvCell("=HYPERLINK(1)"), `"'=HYPERLINK(1)"`);
  assert.equal(csvCell(-5), '"-5.00"');
});

test("the CSV period uses the last day inside the report range", () => {
  const range = businessReportRange("month", new Date("2026-10-25T08:00:00Z"));
  assert.equal(businessDateString(range.from), "2026-10-01");
  assert.equal(businessDateString(new Date(range.to.getTime() - 1)), "2026-10-31");
});
