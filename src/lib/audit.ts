import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type AuditInput = {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  storeId?: string | null;
  summary: string;
  metadata?: Prisma.InputJsonValue;
};

export async function writeAuditLog(input: AuditInput, tx?: Prisma.TransactionClient) {
  const client = tx ?? prisma;
  return client.auditLog.create({ data: {
    userId: input.userId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    storeId: input.storeId ?? null,
    summary: input.summary,
    metadata: input.metadata,
  }});
}
