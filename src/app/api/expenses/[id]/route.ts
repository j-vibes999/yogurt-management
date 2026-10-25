import { businessDateString, parseDateOnly } from "@/lib/date-only";
import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { getCurrentSession } from "@/lib/server-session";
import { logError } from "@/lib/logger";
import { z } from "zod";
import { moneyDecimalString, parseMoneyCents } from "@/lib/money";
import { withSerializableTransaction } from "@/lib/transaction";
import { runIdempotentOperation } from "@/lib/idempotency";

const expenseSnapshotSchema = z.object({
  category: z.string(), amount: z.union([z.string(), z.number()]), incurredAt: z.string(),
  storeId: z.string().nullable(), note: z.string().nullable(), receiptUrl: z.string().nullable(),
});
const editSchema = z.object({
  category: z.string().trim().min(1).max(80).optional(),
  amount: z.unknown().refine((value) => { const cents = parseMoneyCents(value); return cents !== null && cents > BigInt(0); }).optional(),
  incurredAt: z.string().refine((value) => parseDateOnly(value) !== null).optional(),
  storeId: z.string().trim().max(100).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  receiptUrl: z.string().trim().max(500).nullable().optional(),
  expectedExpenseSnapshot: expenseSnapshotSchema.optional(),
});

function mutationError(error: unknown, event: string) {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  const messages: Record<string, string> = {
    EXPENSE_NOT_FOUND: "ບໍ່ພົບລາຍຈ່າຍ", STORE_NOT_FOUND: "ບໍ່ພົບຮ້ານ",
    STORE_INACTIVE: "ຮ້ານນີ້ປິດໃຊ້ງານແລ້ວ", EXPENSE_VOIDED: "ລາຍຈ່າຍນີ້ຖືກຍົກເລີກແລ້ວ",
    STALE_EXPENSE: "Expense changed after the edit form was opened. Reload before saving.",
    IDEMPOTENCY_KEY_REQUIRED: "Expense request key is required", INVALID_IDEMPOTENCY_KEY: "Invalid expense request key",
    IDEMPOTENCY_CONFLICT: "This request key was used for a different expense operation",
  };
  if (!messages[code]) logError(event, { error });
  return NextResponse.json({ error: messages[code] ?? "ບໍ່ສາມາດບັນທຶກລາຍຈ່າຍໄດ້", retryable: !messages[code] }, {
    status: ["EXPENSE_NOT_FOUND", "STORE_NOT_FOUND"].includes(code) ? 404 : ["STORE_INACTIVE", "EXPENSE_VOIDED", "STALE_EXPENSE", "IDEMPOTENCY_CONFLICT"].includes(code) ? 409 : messages[code] ? 400 : 500,
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "ຖານຂໍ້ມູນຍັງບໍ່ໄດ້ຕັ້ງຄ່າ" }, { status: 503 });
  try {
    const session = await getCurrentSession();
    if (!session || session.role !== "admin") return NextResponse.json({ error: "ບໍ່ມີສິດເຮັດລາຍການນີ້" }, { status: 403 });
    const { id } = await params;
    const parsed = editSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "ຂໍ້ມູນລາຍຈ່າຍບໍ່ຖືກຕ້ອງ · ຈຳນວນເງິນຕ້ອງມີບໍ່ເກີນ 2 ຕຳແໜ່ງ", retryable: false }, { status: 400 });
    const body = parsed.data;
    const amount = body.amount === undefined ? undefined : moneyDecimalString(parseMoneyCents(body.amount)!);
    const storeId = body.storeId === undefined ? undefined : body.storeId || null;
    const result = await withSerializableTransaction((tx) => runIdempotentOperation(tx, {
      key: request.headers.get("idempotency-key"), userId: session.userId, scope: `expense.update:${id}`, payload: { ...body, ...(amount === undefined ? {} : { amount }) },
    }, async () => {
      const before = await tx.expense.findUnique({ where: { id } });
      if (!before) throw new Error("EXPENSE_NOT_FOUND");
      if (before.voidedAt) throw new Error("EXPENSE_VOIDED");
      const snapshot = body.expectedExpenseSnapshot;
      if (snapshot && (snapshot.category !== before.category || parseMoneyCents(snapshot.amount) !== parseMoneyCents(String(before.amount)) || snapshot.incurredAt !== businessDateString(before.incurredAt) || snapshot.storeId !== before.storeId || snapshot.note !== before.note || snapshot.receiptUrl !== before.receiptUrl)) throw new Error("STALE_EXPENSE");
      if (storeId && storeId !== before.storeId) {
        const store = await tx.store.findUnique({ where: { id: storeId } });
        if (!store) throw new Error("STORE_NOT_FOUND");
        if (!store.isActive) throw new Error("STORE_INACTIVE");
      }
      const expense = await tx.expense.update({ where: { id }, data: {
        ...(body.category === undefined ? {} : { category: body.category }),
        ...(amount === undefined ? {} : { amount }),
        ...(body.incurredAt === undefined ? {} : { incurredAt: parseDateOnly(body.incurredAt)! }),
        ...(body.note === undefined ? {} : { note: body.note || null }),
        ...(storeId === undefined ? {} : { storeId }),
        ...(body.receiptUrl === undefined ? {} : { receiptUrl: body.receiptUrl || null }),
      } });
      const auditFields = (row: typeof before) => ({ category: row.category, amount: String(row.amount), incurredAt: row.incurredAt.toISOString(), storeId: row.storeId, note: row.note, receiptUrl: row.receiptUrl });
      await writeAuditLog({ userId: session.userId, action: "update", entityType: "expense", entityId: expense.id, storeId: expense.storeId,
        summary: `ແກ້ໄຂລາຍຈ່າຍ ${expense.category === "other" ? "ອື່ນໆ" : expense.category}`,
        metadata: { before: auditFields(before), after: auditFields(expense) },
      }, tx);
      return { id: expense.id };
    }));
    return NextResponse.json(result);
  } catch (error) { return mutationError(error, "expenses.update_failed"); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "ຖານຂໍ້ມູນຍັງບໍ່ໄດ້ຕັ້ງຄ່າ" }, { status: 503 });
  try {
    const session = await getCurrentSession();
    if (!session || session.role !== "admin") return NextResponse.json({ error: "ບໍ່ມີສິດເຮັດລາຍການນີ້" }, { status: 403 });
    const { id } = await params;
    const parsed = z.object({ reason: z.string().trim().max(1000).optional() }).safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "ຂໍ້ມູນຍົກເລີກບໍ່ຖືກຕ້ອງ", retryable: false }, { status: 400 });
    const reason = parsed.data.reason || "Voided by user";
    const result = await withSerializableTransaction((tx) => runIdempotentOperation(tx, {
      key: request.headers.get("idempotency-key"), userId: session.userId, scope: `expense.void:${id}`, payload: { reason },
    }, async () => {
      const before = await tx.expense.findUnique({ where: { id } });
      if (!before) throw new Error("EXPENSE_NOT_FOUND");
      if (before.voidedAt) return { id, voided: true };
      const expense = await tx.expense.update({ where: { id }, data: { voidedAt: new Date(), voidReason: reason } });
      await writeAuditLog({ userId: session.userId, action: "void", entityType: "expense", entityId: expense.id, storeId: expense.storeId,
        summary: `Void ລາຍຈ່າຍ · ${reason}`,
        metadata: { before: { amount: String(before.amount), incurredAt: before.incurredAt.toISOString(), voidedAt: null }, after: { voidedAt: expense.voidedAt!.toISOString(), voidReason: reason } },
      }, tx);
      return { id: expense.id, voided: true };
    }));
    return NextResponse.json(result);
  } catch (error) { return mutationError(error, "expenses.void_failed"); }
}
