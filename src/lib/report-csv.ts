export type ReportCsvRow = { storeName: string; gross: number; storeShare: number; electricity: number; transport: number; otherExpenses: number; expenseTotal: number; electricityBudget: number; productCost: number; wasteCost?: number; profit: number };
export type ReportCsvSummary = { gross: number; storeShare: number; productCost: number; wasteCost?: number; centralWasteCost?: number; expenses: number; netProfit: number; unallocatedExpenses: number; electricityBudget: number };
/** What the figures rest on. The file travels without the web page, so it has to say this itself. */
export type ReportCsvContext = { from: string; to: string; timeZone: string; source: "database" | "demo"; costMode: "actual" | "estimated" };

/** Quoted cell; text that a spreadsheet would run as a formula gets a leading apostrophe. */
export type CsvCellValue = string | number | null | undefined;
export function csvCell(value: CsvCellValue, numberFormat: "fixed" | "plain" = "fixed") {
  const raw = typeof value === "number" && numberFormat === "fixed" ? value.toFixed(2) : String(value ?? "");
  const formula = typeof value === "string" && /^(?:\s*[=+@-]|[\t\r\n])/.test(raw);
  const text = (formula ? "'" : "") + raw.replace(/"/g, '""');
  return `"${text}"`;
}

const line = (cells: Array<string | number>) => cells.map(value => csvCell(value)).join(",");

// Same wording as the notice on the reports page.
const ESTIMATED_COST = "Partly estimated: cups with no recorded cost are counted at 28% of sales (ຕົ້ນທຶນບາງລາຍການໃຊ້ຕົວເລກປະຫວັດທີ່ບັນທຶກໄວ້. ສິນຄ້າທີ່ຍັງບໍ່ຮູ້ຕົ້ນທຶນໃຊ້ 28% ຂອງຍອດຂາຍເພື່ອປະເມີນ.)";

export function buildReportCsv(rows: ReportCsvRow[], summary?: ReportCsvSummary, context?: ReportCsvContext) {
  const lines: string[] = [];
  if (context) {
    lines.push(line(["Report period (ໄລຍະເວລາລາຍງານ)", `${context.from} – ${context.to}`]));
    lines.push(line(["Time zone", context.timeZone]));
    lines.push(line(["Data source", context.source === "demo" ? "Sample data: the database was not available (ຂໍ້ມູນຕົວຢ່າງ)" : "Database"]));
    lines.push(line(["Cost basis (ຕົ້ນທຶນ)", context.costMode === "actual" ? "Actual recorded cost (ຕົ້ນທຶນຈິງ)" : ESTIMATED_COST]));
    lines.push("");
  }
  lines.push(line(["Store", "Gross", "Store share", "Actual electricity", "Actual transport", "Other actual expenses", "Total actual expenses", "Monthly electricity budget", "Product cost (ຕົ້ນທຶນສິນຄ້າ)", "Waste cost (ສິນຄ້າເສຍ / ໝົດອາຍຸ)", "Profit"]));
  for (const r of rows) lines.push(line([r.storeName, r.gross, r.storeShare, r.electricity, r.transport, r.otherExpenses, r.expenseTotal, r.electricityBudget, r.productCost, r.wasteCost ?? 0, r.profit]));
  if (summary) {
    if (summary.unallocatedExpenses) lines.push(line(["Central expenses", 0, 0, "", "", "", summary.unallocatedExpenses, 0, 0, 0, -summary.unallocatedExpenses]));
    if (summary.centralWasteCost) lines.push(line(["Central stock write-offs", 0, 0, "", "", "", 0, 0, 0, summary.centralWasteCost, -summary.centralWasteCost]));
    lines.push(line(["TOTAL", summary.gross, summary.storeShare, rows.reduce((sum, row) => sum + row.electricity, 0), rows.reduce((sum, row) => sum + row.transport, 0), "", summary.expenses, summary.electricityBudget, summary.productCost, summary.wasteCost ?? 0, summary.netProfit]));
  }
  return "﻿" + lines.join("\n");
}
