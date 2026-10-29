import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { runtimeDataDirectory } from "@/lib/runtime-paths";

const metricSchema = z.object({
  name: z.enum(["CLS", "FCP", "FID", "INP", "LCP", "TTFB"]),
  value: z.number().finite().nonnegative().max(1_000_000),
  rating: z.enum(["good", "needs-improvement", "poor"]).optional(),
  delta: z.number().finite().optional(),
  id: z.string().max(160).optional(),
  navigationType: z.string().max(80).optional(),
  navigationId: z.string().regex(/^[0-9.]+$/).max(80).optional(),
  buildId: z.string().regex(/^[a-zA-Z0-9._-]+$/).max(160).optional(),
  provenance: z.enum(["field", "synthetic", "development"]).optional(),
  path: z.string().startsWith("/").max(240),
  ts: z.string().datetime().optional(),
  viewport: z.enum(["mobile", "tablet", "desktop"]).optional(),
  connection: z.string().max(32).optional(),
  saveData: z.boolean().optional(),
});

const publicPaths = new Set(["/", "/login", "/stores", "/stores/new", "/expenses", "/expenses/new", "/refills", "/refills/new", "/driver", "/settlements", "/inventory", "/inventory/adjust", "/inventory/receive", "/production", "/fridges", "/map", "/reports", "/notifications", "/operations", "/audit-log"]);
function metricPath(value: string) {
  const pathname = value.split(/[?#]/, 1)[0].replace(/\/$/, "") || "/";
  if (publicPaths.has(pathname)) return pathname;
  if (/^\/stores\/[^/]+(?:\/edit)?$/.test(pathname)) return pathname.endsWith("/edit") ? "/stores/[id]/edit" : "/stores/[id]";
  if (/^\/expenses\/[^/]+\/edit$/.test(pathname)) return "/expenses/[id]/edit";
  if (/^\/driver\/restock\/[^/]+$/.test(pathname)) return "/driver/restock/[storeId]";
  return "/other";
}

let collectorBuild: Promise<string> | undefined;
function getCollectorBuild() {
  collectorBuild ??= fs.readFile(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8")
    .then(value => /^[a-zA-Z0-9._-]{1,160}$/.test(value.trim()) ? value.trim() : "unknown")
    .catch(() => "unknown");
  return collectorBuild;
}

async function appendMetric(line: string) {
  const dir = path.join(runtimeDataDirectory(), "metrics");
  const file = path.join(dir, "web-vitals.ndjson");
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    const stat = await fs.stat(file);
    if (stat.size > 5 * 1024 * 1024) await fs.rename(file, path.join(dir, `web-vitals-${Date.now()}.ndjson`));
  } catch {}
  await fs.appendFile(file, `${line}\n`, { encoding: "utf8", mode: 0o600 });
}

export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > 4096) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return NextResponse.json({ error: "Invalid metric" }, { status: 400 }); }
  const parsed = metricSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid metric" }, { status: 400 });
  const collectorBuildId = await getCollectorBuild();
  await appendMetric(JSON.stringify({ ...parsed.data, path: metricPath(parsed.data.path), buildId: parsed.data.buildId ?? collectorBuildId, buildSource: parsed.data.buildId ? "client" : "collector", collectorBuildId, provenance: parsed.data.provenance ?? "unknown" }));
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
