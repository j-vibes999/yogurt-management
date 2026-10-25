import fs from "node:fs";
import path from "node:path";

const directory = path.join(process.cwd(), ".yogurt", "metrics");
const files = fs.existsSync(directory) ? fs.readdirSync(directory).filter(name => /^web-vitals(?:-\d+)?\.ndjson$/.test(name)).map(name => ({ file: path.join(directory, name), modified: fs.statSync(path.join(directory, name)).mtimeMs })).sort((a, b) => a.modified - b.modified || a.file.localeCompare(b.file)) : [];
if (!files.length) { console.log("No Web Vitals collected yet."); process.exit(0); }

const publicPaths = new Set(["/", "/login", "/stores", "/stores/new", "/expenses", "/expenses/new", "/refills", "/refills/new", "/driver", "/settlements", "/inventory", "/inventory/adjust", "/inventory/receive", "/production", "/fridges", "/map", "/reports", "/notifications", "/operations", "/audit-log"]);
function metricPath(value) {
  const pathname = String(value || "/other").split(/[?#]/, 1)[0].replace(/\/$/, "") || "/";
  if (publicPaths.has(pathname)) return pathname;
  if (/^\/stores\/[^/]+(?:\/edit)?$/.test(pathname)) return pathname.endsWith("/edit") ? "/stores/[id]/edit" : "/stores/[id]";
  if (/^\/expenses\/[^/]+\/edit$/.test(pathname)) return "/expenses/[id]/edit";
  if (/^\/driver\/restock\/[^/]+$/.test(pathname)) return "/driver/restock/[storeId]";
  return "/other";
}

const finalMetrics = new Map();
let index = 0;
for (const { file } of files) {
  for (const line of fs.readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    try {
      const row = JSON.parse(line);
      if (!["CLS", "FCP", "FID", "INP", "LCP", "TTFB"].includes(row.name) || !Number.isFinite(row.value) || row.value < 0) continue;
      row.path = metricPath(row.path);
      const key = JSON.stringify([row.buildId || "unknown", row.provenance || "unknown", row.path, row.navigationId || row.navigationType || "unknown", row.name, row.id || `unidentified-${index++}`]);
      const previous = finalMetrics.get(key);
      const timestamp = Date.parse(row.ts);
      if (!previous || !Number.isFinite(timestamp) || !Number.isFinite(Date.parse(previous.ts)) || timestamp >= Date.parse(previous.ts)) finalMetrics.set(key, row);
    } catch { /* Ignore a partial or malformed append. */ }
  }
}
const rows = [...finalMetrics.values()];
const percentile = (values, fraction) => values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * fraction) - 1))];
const format = (value, metric) => value.toFixed(metric === "CLS" ? 3 : 1);
function summarize(columns, fractions, header) {
  const groups = new Map();
  for (const row of rows) {
    const context = columns.map(column => row[column] || "unknown");
    const key = JSON.stringify(context);
    const group = groups.get(key) || { context, values: [] };
    group.values.push(row.value);
    groups.set(key, group);
  }
  console.log(header);
  for (const [, { context, values }] of [...groups.entries()].sort()) {
    values.sort((a, b) => a - b);
    console.log([...context, values.length, ...fractions.map(fraction => format(percentile(values, fraction), context.at(-1)))].join("\t"));
  }
}

summarize(["buildId", "buildSource", "provenance", "path", "name"], [.5, .75, .95], "buildId\tbuildSource\tprovenance\tpath\tmetric\tn\tp50\tp75\tp95");
console.log("");
summarize(["buildId", "buildSource", "provenance", "viewport", "connection", "name"], [.75, .95], "buildId\tbuildSource\tprovenance\tviewport\tconnection\tmetric\tn\tp75\tp95");
