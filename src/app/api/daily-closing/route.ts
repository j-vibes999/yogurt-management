import { parseDateOnly } from "@/lib/date-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/server-session";
import { writeAuditLog } from "@/lib/audit";
import { withSerializableTransaction } from "@/lib/transaction";
import { runIdempotentOperation } from "@/lib/idempotency";
import { moneyDecimalString, moneyNumber, parseMoneyCents } from "@/lib/money";
import { logError } from "@/lib/logger";

const closingSchema = z.object({
  closingDate: z.string().refine((value) => parseDateOnly(value) !== null),
  cashAmount: z.unknown().optional(), bankAmount: z.unknown().optional(), expenseAmount: z.unknown().optional(),
  note: z.string().trim().max(1000).optional(),
});

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "ຖານຂໍ້ມູນຍັງບໍ່ໄດ້ຕັ້ງຄ່າ" }, { status: 503 });
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າລະບົບກ່ອນ" }, { status: 401 });
    if (session.role !== "admin") return NextResponse.json({ error: "ບໍ່ມີສິດເຮັດລາຍການນີ້" }, { status: 403 });
    const parsed = closingSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "ຂໍ້ມູນປິດຍອດບໍ່ຖືກຕ້ອງ", retryable: false }, { status: 400 });
    const body = parsed.data;
    const cash = parseMoneyCents(body.cashAmount === undefined ? 0 : body.cashAmount);
    const bank = parseMoneyCents(body.bankAmount === undefined ? 0 : body.bankAmount);
    const expense = parseMoneyCents(body.expenseAmount === undefined ? 0 : body.expenseAmount);
    if (cash === null || bank === null || expense === null) return NextResponse.json({ error: "ຈຳນວນເງິນຕ້ອງບໍ່ຕິດລົບ ແລະມີບໍ່ເກີນ 2 ຕຳແໜ່ງ", retryable: false }, { status: 400 });
    const closingDate = parseDateOnly(body.closingDate)!;
    const amounts = { cashAmount: moneyDecimalString(cash), bankAmount: moneyDecimalString(bank), expenseAmount: moneyDecimalString(expense) };
    const note = body.note || null;
    const result = await withSerializableTransaction((tx) => runIdempotentOperation(tx, {
      key: request.headers.get("idempotency-key"), userId: session.userId, scope: "daily_closing.save", payload: { closingDate: body.closingDate, ...amounts, note },
    }, async () => {
      const before = await tx.dailyClosing.findUnique({ where: { closingDate } });
      const data = { ...amounts, note, createdById: session.userId };
      const row = await tx.dailyClosing.upsert({ where: { closingDate }, create: { closingDate, ...data }, update: data });
      const fields = (value: typeof row) => ({ closingDate: value.closingDate.toISOString(), cashAmount: String(value.cashAmount), bankAmount: String(value.bankAmount), expenseAmount: String(value.expenseAmount), note: value.note });
      await writeAuditLog({ userId: session.userId, action: "close_day", entityType: "daily_closing", entityId: row.id,
        summary: `ປິດຍອດປະຈຳວັນ ${body.closingDate} · ${moneyNumber(cash + bank).toLocaleString()} LAK`,
        metadata: { before: before ? fields(before) : null, after: fields(row) },
      }, tx);
      return { id: row.id };
    }));
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    const messages: Record<string, string> = {
      IDEMPOTENCY_KEY_REQUIRED: "Daily closing request key is required", INVALID_IDEMPOTENCY_KEY: "Invalid daily closing request key",
      IDEMPOTENCY_CONFLICT: "This request key was used for a different daily closing",
    };
    if (!messages[code]) logError("daily_closing.save_failed", { error });
    return NextResponse.json({ error: messages[code] ?? "ບໍ່ສາມາດບັນທຶກການປິດຍອດປະຈຳວັນໄດ້", retryable: !messages[code] }, { status: code === "IDEMPOTENCY_CONFLICT" ? 409 : messages[code] ? 400 : 500 });
  }
}
