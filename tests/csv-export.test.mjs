import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import * as csv from "../src/lib/report-csv.ts";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const output = ts.transpileModule(readFileSync(new URL("../src/components/csv-export-button.tsx", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

test("generic download neutralizes formulas in headers and rows while preserving Lao, blanks and numbers", async () => {
  let downloaded;
  const exports = {};
  const context = { exports, module: { exports }, Blob, URL: { createObjectURL: blob => { downloaded = blob; return "blob:test"; }, revokeObjectURL() {} }, document: { body: { appendChild() {} }, createElement: () => ({ click() {}, remove() {} }) }, require: name => {
    if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === "@/lib/report-csv") return csv;
    throw new Error(`Unexpected import: ${name}`);
  } };
  vm.runInNewContext(output, context);
  const button = exports.CsvExportButton({ filename: "test", headers: ["=header", "ລາຍການ"], rows: [
    ["=1+1", "+SUM(1)", "-2+3", "@SUM(1)", "\tformula", "\rformula", "\n=1", "  =2", " \t@sum(1)"],
    [null, undefined, 0, -5, 1.25, "ຂວດນົມ", 'A,"B"'],
  ] });
  button.props.onClick();
  assert.equal(await downloaded.text(), [
    `"'=header","ລາຍການ"`,
    `"'=1+1","'+SUM(1)","'-2+3","'@SUM(1)","'\tformula","'\rformula","'\n=1","'  =2","' \t@sum(1)"`,
    `"","","0","-5","1.25","ຂວດນົມ","A,""B"""`,
  ].join("\n"));
});

test("report cells neutralize whitespace-prefixed formulas and accept empty optional values", () => {
  assert.equal(csv.csvCell("  =1+1"), `"'  =1+1"`);
  assert.equal(csv.csvCell("\n+SUM(1)"), `"'\n+SUM(1)"`);
  assert.equal(csv.csvCell(null), '""');
  assert.equal(csv.csvCell(undefined), '""');
  assert.equal(csv.csvCell(-5), '"-5.00"');
});
