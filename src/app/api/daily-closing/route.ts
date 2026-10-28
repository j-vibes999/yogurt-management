import { parseDateOnly } from "@/lib/date-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/server-session";
import { writeAuditLog } from "@/lib/audit";
import { withSerializableTransaction } from "@/lib/transaction";
import { runIdempotentOperation } from "@/lib/idempotency";
import { moneyDecimalString, moneyNumber, parseMoneyCents } from "@/lib/money";
import { logError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { dailyClosingSnapshot, matchesDailyClosingSnapshot } from "@/lib/daily-closing";

const snapshotSchema = z.object({
  id: z.string().min(1),
  cashAmount: z.string().refine(value => parseMoneyCents(value) !== null),
  bankAmount: z.string().refine(value => parseMoneyCents(value) !== null),
  expenseAmount: z.string().refine(value => parseMoneyCents(value) !== null),
  note: z.string().max(1000).nullable(),
});

const closingSchema = z.object({
  closingDate: z.string().refine((value) => parseDateOnly(value) !== null),
  cashAmount: z.unknown().optional(), bankAmount: z.unknown().optional(), expenseAmount: z.unknown().optional(),
  note: z.string().trim().max(1000).optional(),
  expectedSnapshot: snapshotSchema.nullable().optional(),
});

export async function GET(request: Request) {
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "ຖານຂໍ້ມູນຍັງໃຊ້ບໍ່ໄດ້" }, { status: 503 });
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າລະບົບກ່ອນ" }, { status: 401 });
    if (session.role !== "admin") return NextResponse.json({ error: "ບໍ່ມີສິດເບິ່ງຍອດນີ້" }, { status: 403 });
    const date = new URL(request.url).searchParams.get("date");
    const closingDate = parseDateOnly(date);
    if (!closingDate) return NextResponse.json({ error: "ກະລຸນາເລືອກວັນທີທີ່ຖືກຕ້ອງ" }, { status: 400 });
    const row = await prisma.dailyClosing.findUnique({ where: { closingDate } });
    return NextResponse.json({ closingDate: closingDate.toISOString().slice(0, 10), snapshot: row ? dailyClosingSnapshot(row) : null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logError("daily_closing.load_failed", { error });
    return NextResponse.json({ error: "ໂຫຼດຍອດເກົ່າບໍ່ໄດ້. ກະລຸນາລອງໃໝ່ກ່ອນບັນທຶກ" }, { status: 503 });
  }
}

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
      key: request.headers.get("idempotency-key"), userId: session.userId, scope: "daily_closing.save", payload: { closingDate: body.closingDate, ...amounts, note, ...(body.expectedSnapshot !== undefined ? { expectedSnapshot: body.expectedSnapshot } : {}) },
    }, async () => {
      const before = await tx.dailyClosing.findUnique({ where: { closingDate } });
      if (!matchesDailyClosingSnapshot(before ? dailyClosingSnapshot(before) : null, body.expectedSnapshot)) throw new Error("STALE_CLOSING");
      const data = { ...amounts, note, createdById: session.userId };
      const row = await tx.dailyClosing.upsert({ where: { closingDate }, create: { closingDate, ...data }, update: data });
      const fields = (value: typeof row) => ({ closingDate: value.closingDate.toISOString(), cashAmount: String(value.cashAmount), bankAmount: String(value.bankAmount), expenseAmount: String(value.expenseAmount), note: value.note });
      await writeAuditLog({ userId: session.userId, action: "close_day", entityType: "daily_closing", entityId: row.id,
        summary: `ປິດຍອດປະຈຳວັນ ${body.closingDate} · ${moneyNumber(cash + bank).toLocaleString()} LAK`,
        metadata: { before: before ? fields(before) : null, after: fields(row) },
      }, tx);
      return { id: row.id, snapshot: dailyClosingSnapshot(row) };
    }));
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    const messages: Record<string, string> = {
      IDEMPOTENCY_KEY_REQUIRED: "Daily closing request key is required", INVALID_IDEMPOTENCY_KEY: "Invalid daily closing request key",
      IDEMPOTENCY_CONFLICT: "This request key was used for a different daily closing",
      STALE_CLOSING: "ຍອດຂອງວັນນີ້ປ່ຽນແລ້ວ. ກະລຸນາໂຫຼດຍອດລ່າສຸດ ແລະກວດກ່ອນບັນທຶກໃໝ່",
    };
    if (!messages[code]) logError("daily_closing.save_failed", { error });
    return NextResponse.json({ error: messages[code] ?? "ບໍ່ສາມາດບັນທຶກການປິດຍອດປະຈຳວັນໄດ້", retryable: !messages[code], ...(code === "STALE_CLOSING" ? { code } : {}) }, { status: code === "IDEMPOTENCY_CONFLICT" || code === "STALE_CLOSING" ? 409 : messages[code] ? 400 : 500 });
  }
}
