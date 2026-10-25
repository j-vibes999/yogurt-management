import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

export function stablePayload(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}

export async function runIdempotentOperation<T>(
  tx: Prisma.TransactionClient,
  input: { key: string | null; userId: string; scope: string; payload: unknown },
  work: () => Promise<T>,
): Promise<T> {
  if (!input.key) throw new Error("IDEMPOTENCY_KEY_REQUIRED");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.key)) throw new Error("INVALID_IDEMPOTENCY_KEY");
  const key = input.key.toLowerCase();
  const requestHash = createHash("sha256").update(stablePayload(input.payload)).digest("hex");
  const where = { userId_scope_key: { userId: input.userId, scope: input.scope, key } };
  const existing = await tx.operationReceipt.findUnique({ where });
  if (existing) {
    if (existing.requestHash !== requestHash) throw new Error("IDEMPOTENCY_CONFLICT");
    return existing.result as T;
  }
  const result = JSON.parse(JSON.stringify(await work())) as T;
  await tx.operationReceipt.create({ data: { userId: input.userId, scope: input.scope, key, requestHash, result: result as Prisma.InputJsonValue } });
  return result;
}
