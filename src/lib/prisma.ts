import { PrismaClient } from "@prisma/client";
import { logWarn } from "@/lib/logger";

const makePrisma = () => new PrismaClient({
  log: [
    { emit: "event", level: "query" },
    { emit: "stdout", level: "error" },
    ...(process.env.NODE_ENV === "development" ? [{ emit: "stdout" as const, level: "warn" as const }] : []),
  ],
});

type PrismaSingleton = ReturnType<typeof makePrisma>;
const globalForPrisma = globalThis as unknown as { prisma?: PrismaSingleton; slowQueryHook?: boolean };

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

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
