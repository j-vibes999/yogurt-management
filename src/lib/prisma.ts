import { PrismaClient } from "@prisma/client";
import { logWarn } from "@/lib/logger";
import { createReadRecovery } from "@/lib/database-recovery";

const makePrisma = () => new PrismaClient({
  log: [
    { emit: "event", level: "query" },
    { emit: "stdout", level: "error" },
    ...(process.env.NODE_ENV === "development" ? [{ emit: "stdout" as const, level: "warn" as const }] : []),
  ],
});

type PrismaSingleton = ReturnType<typeof makePrisma>;
const globalForPrisma = globalThis as unknown as { prisma?: PrismaSingleton; slowQueryHook?: boolean; desktopSessionRead?: ReturnType<typeof createReadRecovery> };

export const prisma = globalForPrisma.prisma ?? makePrisma();

if (!globalForPrisma.slowQueryHook) {
  const configured = Number(process.env.SLOW_QUERY_MS ?? 150);
  const threshold = Number.isFinite(configured) && configured >= 10 ? configured : 150;
  prisma.$on("query", (event) => {
    if (event.duration < threshold) return;
    const shape = event.query.replace(/\s+/g, " ").trim().slice(0, 220);
    logWarn("db.slow_query", { durationMs: event.duration, query: shape });
  });
  globalForPrisma.slowQueryHook = true;
}

const desktop = Boolean(process.env.YOGURT_DESKTOP_TOKEN);
if (process.env.NODE_ENV !== "production" || desktop) globalForPrisma.prisma = prisma;

// A warmed native pool can retain closed sockets after a database restart.
// Recover only authorization reads; financial commands retain their existing
// idempotency and uncertainty handling and are never automatically replayed here.
export const readSessionDatabase = desktop
  ? (globalForPrisma.desktopSessionRead ??= createReadRecovery(async () => { await prisma.$disconnect(); await prisma.$connect(); }))
  : async <T>(read: () => Promise<T>): Promise<T> => read();
