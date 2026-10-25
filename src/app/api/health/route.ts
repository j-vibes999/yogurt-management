import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type BackupState = { ok?: boolean; createdAt?: string; file?: string; bytes?: number };

async function backupState() {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), ".yogurt", "backups", "latest.json"), "utf8");
    const data = JSON.parse(raw) as BackupState;
    const created = data.createdAt ? Date.parse(data.createdAt) : NaN;
    const ageHours = Number.isFinite(created) ? Math.max(0, (Date.now() - created) / 3_600_000) : null;
    return { ok: Boolean(data.ok) && ageHours !== null && ageHours <= 36, ageHours: ageHours === null ? null : Math.round(ageHours * 10) / 10 };
  } catch {
    return { ok: false, ageHours: null };
  }
}

export async function GET() {
  const started = performance.now();
  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {}
  const dbMs = Math.round((performance.now() - started) * 10) / 10;
  const backup = await backupState();
  const status = dbOk ? (backup.ok ? "ok" : "degraded") : "down";
  return NextResponse.json({ status, db: { ok: dbOk, latencyMs: dbMs }, backup, uptimeSeconds: Math.round(process.uptime()) }, {
    status: dbOk ? 200 : 503,
    headers: { "Cache-Control": "no-store", "Server-Timing": `db;dur=${dbMs}` },
  });
}
