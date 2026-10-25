import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function withSerializableTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>, maxRetries = 12): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const target = error instanceof Prisma.PrismaClientKnownRequestError ? JSON.stringify(error.meta?.target ?? "") : "";
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || (error.code === "P2002" && target.includes("scope") && target.includes("key")));
      if (!retryable || attempt >= maxRetries) throw error;
      const baseDelay = Math.min(500, 12 * (2 ** Math.min(attempt, 5)));
      const jitter = Math.floor(Math.random() * 25);
      await new Promise((resolve) => setTimeout(resolve, baseDelay + jitter));
    }
  }
}
