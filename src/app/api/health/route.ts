import { timingSafeEqual } from "node:crypto";
import { performance } from "node:perf_hooks";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadBackupReadiness } from "@/lib/backup-readiness";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Requests that came through Cloudflare see only ok/degraded/down unless they present HEALTH_TOKEN. */
function wantsDetails(request: Request) {
  const viaCloudflare = request.headers.has("cf-connecting-ip") || request.headers.has("cf-ray");
  if (!viaCloudflare) return true;
  const expected = process.env.HEALTH_TOKEN ?? "";
  const given = request.headers.get("x-health-token") ?? "";
  return expected.length >= 16 && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export async function GET(request: Request) {
  const started = performance.now();
  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {}
  const dbMs = Math.round((performance.now() - started) * 10) / 10;
  const backup = await loadBackupReadiness(process.cwd(), process.env.DATABASE_URL ?? "");
  const status = dbOk ? (backup.ok ? "ok" : "degraded") : "down";
  if (!wantsDetails(request)) return NextResponse.json({ status }, { status: dbOk ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ status, availability: { ok: dbOk }, readiness: { ok: dbOk && backup.ok }, db: { ok: dbOk, latencyMs: dbMs }, backup, uptimeSeconds: Math.round(process.uptime()) }, {
    status: dbOk ? 200 : 503,
    headers: { "Cache-Control": "no-store", "Server-Timing": `db;dur=${dbMs}` },
  });
}
