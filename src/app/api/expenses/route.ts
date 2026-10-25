import { businessDateOnly, parseDateOnly } from "@/lib/date-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { getCurrentSession } from "@/lib/server-session";
import { logError } from "@/lib/logger";
import { moneyDecimalString, moneyNumber, parseMoneyCents } from "@/lib/money";
import { withSerializableTransaction } from "@/lib/transaction";
import { runIdempotentOperation } from "@/lib/idempotency";

const expenseSchema = z.object({
  category: z.string().trim().min(1).max(80).default("other"),
  amount: z.unknown().refine((value) => { const cents = parseMoneyCents(value); return cents !== null && cents > BigInt(0); }),
  storeId: z.string().trim().max(100).optional().nullable(),
  incurredAt: z.string().optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
  receiptUrl: z.string().trim().max(500).optional().nullable(),
});

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "ຖານຂໍ້ມູນຍັງບໍ່ໄດ້ຕັ້ງຄ່າ" }, { status: 503 });
  try {
    const session = await getCurrentSession();
    if (!session || session.role !== "admin") return NextResponse.json({ error: "ບໍ່ມີສິດເຮັດລາຍການນີ້" }, { status: 403 });
    const parsed = expenseSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "ຂໍ້ມູນລາຍຈ່າຍບໍ່ຖືກຕ້ອງ · ຈຳນວນເງິນຕ້ອງມີບໍ່ເກີນ 2 ຕຳແໜ່ງ", retryable: false }, { status: 400 });
    const body = parsed.data;
    const cents = parseMoneyCents(body.amount)!;
    const amount = moneyDecimalString(cents);
    if (body.incurredAt && !parseDateOnly(body.incurredAt)) return NextResponse.json({ error: "ວັນທີລາຍຈ່າຍບໍ່ຖືກຕ້ອງ", retryable: false }, { status: 400 });
    const payload = { ...body, amount };
    const result = await withSerializableTransaction((tx) => runIdempotentOperation(tx, {
      key: request.headers.get("idempotency-key"), userId: session.userId, scope: "expense.create", payload,
    }, async () => {
      const storeId = body.storeId || null;
      if (storeId) {
        const store = await tx.store.findUnique({ where: { id: storeId } });
        if (!store) throw new Error("STORE_NOT_FOUND");
        if (!store.isActive) throw new Error("STORE_INACTIVE");
      }
      const incurredAt = body.incurredAt ? parseDateOnly(body.incurredAt)! : businessDateOnly();
      const expense = await tx.expense.create({ data: { storeId, category: body.category, amount, incurredAt, note: body.note || null, receiptUrl: body.receiptUrl || null } });
      await writeAuditLog({ userId: session.userId, action: "create", entityType: "expense", entityId: expense.id, storeId,
        summary: `ບັນທຶກລາຍຈ່າຍ ${body.category === "other" ? "ອື່ນໆ" : body.category} · ${moneyNumber(cents).toLocaleString()} LAK`,
        metadata: { after: { category: expense.category, amount, incurredAt: expense.incurredAt.toISOString(), storeId, note: expense.note, receiptUrl: expense.receiptUrl } },
      }, tx);
      return { id: expense.id };
    }));
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    const messages: Record<string, string> = {
      STORE_NOT_FOUND: "ບໍ່ພົບຮ້ານ", STORE_INACTIVE: "ຮ້ານນີ້ປິດໃຊ້ງານແລ້ວ",
      IDEMPOTENCY_KEY_REQUIRED: "Expense request key is required", INVALID_IDEMPOTENCY_KEY: "Invalid expense request key",
      IDEMPOTENCY_CONFLICT: "This request key was used for a different expense",
    };
    if (!messages[code]) logError("expenses.create_failed", { error });
    return NextResponse.json({ error: messages[code] ?? "ບໍ່ສາມາດບັນທຶກລາຍຈ່າຍໄດ້", retryable: !messages[code] }, { status: code === "STORE_NOT_FOUND" ? 404 : ["STORE_INACTIVE", "IDEMPOTENCY_CONFLICT"].includes(code) ? 409 : messages[code] ? 400 : 500 });
  }
}
