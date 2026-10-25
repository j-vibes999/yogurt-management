import { NextResponse } from "next/server";
import { withSerializableTransaction } from "@/lib/transaction";
import { getCurrentSession } from "@/lib/server-session";
import { logError } from "@/lib/logger";
import { writeAuditLog } from "@/lib/audit";
import { moneyDecimalString, moneyNumber, parseMoneyCents, roundMoneyCents } from "@/lib/money";
import { runIdempotentOperation } from "@/lib/idempotency";

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session || !["admin","driver"].includes(session.role)) return NextResponse.json({ error: "ບໍ່ມີສິດເຮັດລາຍການນີ້" }, { status: 403 });
  try {
    const body = await request.json().catch(() => null) as { storeId?: unknown; paidAmount?: unknown; paymentMethod?: unknown } | null;
    const storeId = String(body?.storeId ?? "").trim();
    const paidCents = parseMoneyCents(body?.paidAmount);
    const paidAmount = paidCents === null ? 0 : moneyNumber(paidCents);
    const paymentMethod = body?.paymentMethod === "bank" ? "bank" : body?.paymentMethod === "cash" ? "cash" : null;
    if (!storeId || paidCents === null || paidCents <= BigInt(0)) return NextResponse.json({ error: "ກະລຸນາໃສ່ຈຳນວນເງິນຫຼາຍກວ່າ 0", retryable: false }, { status: 400 });
    if (!paymentMethod) return NextResponse.json({ error: "ກະລຸນາເລືອກວິທີຮັບເງິນ", retryable: false }, { status: 400 });
    const key = request.headers.get("idempotency-key");
    if (!key) return NextResponse.json({ error: "Payment request key is required", retryable: false }, { status: 400 });
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) return NextResponse.json({ error: "Invalid payment request key", retryable: false }, { status: 400 });
    const stableReceipt = `PM-${key.replaceAll("-", "").toUpperCase()}`;
    const requestNote = `payment_only:${JSON.stringify([storeId, paidAmount, paymentMethod])}`;

    const result = await withSerializableTransaction((tx) => runIdempotentOperation(tx, {
      key, userId: session.userId, scope: "settlement.pay", payload: { storeId, paidAmount: moneyDecimalString(paidCents), paymentMethod },
    }, async () => {
      const existing = await tx.settlement.findUnique({ where: { receiptNumber: stableReceipt }, include: { restockVisit: true } });
      if (existing) {
        if (existing.storeId !== storeId || existing.restockVisit.note !== requestNote) throw new Error("IDEMPOTENCY_CONFLICT");
        return { settlementId: existing.id, receiptNumber: stableReceipt, previousBalance: Number(existing.previousBalance), paidAmount: Number(existing.paidAmount), closingBalance: Number(existing.closingBalance), paymentStatus: existing.paymentStatus };
      }
      const store = await tx.store.findUnique({ where: { id: storeId }, include: { fridge: true, settlements: { orderBy: [{ settlementDate: "desc" }, { id: "desc" }], take: 1 } } });
      if (!store?.fridge) throw new Error("STORE_NOT_FOUND");
      const previousBalanceCents = roundMoneyCents(String(store.settlements[0]?.closingBalance ?? 0));
      const previousBalance = moneyNumber(previousBalanceCents);
      if (previousBalanceCents <= BigInt(0)) throw new Error("NO_BALANCE");
      if (paidCents! > previousBalanceCents) throw new Error("PAYMENT_EXCEEDS_BALANCE");
      const closingBalanceCents = previousBalanceCents - paidCents!;
      const closingBalance = moneyNumber(closingBalanceCents);
      const paymentStatus = closingBalanceCents === BigInt(0) ? "paid" : "partial";
      const now = new Date();
      const receiptNumber = stableReceipt;
      const visit = await tx.restockVisit.create({ data: { storeId, fridgeId: store.fridge.id, visitDate: now, status: "draft", driverUserId: session.userId, note: requestNote } });
      const settlement = await tx.settlement.create({ data: { restockVisitId: visit.id, storeId, grossAmount: 0, storeCommissionAmount: 0, netPayableAmount: 0, previousBalance: moneyDecimalString(previousBalanceCents), paidAmount: moneyDecimalString(paidCents!), closingBalance: moneyDecimalString(closingBalanceCents), paymentStatus, paymentMethod, receiptNumber, settlementDate: now } });
      await writeAuditLog({ userId: session.userId, action: "update", entityType: "settlement", entityId: settlement.id, storeId, summary: `ຮັບເງິນຄ້າງ ${paidAmount.toLocaleString()} LAK · ${receiptNumber}`, metadata: { before: { balance: previousBalance }, after: { balance: closingBalance } } }, tx);
      return { settlementId: settlement.id, receiptNumber, previousBalance, paidAmount, closingBalance, paymentStatus };
    }));
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (!["STORE_NOT_FOUND", "NO_BALANCE", "PAYMENT_EXCEEDS_BALANCE", "IDEMPOTENCY_CONFLICT"].includes(code)) logError("settlement.payment_failed", { error });
    const messages: Record<string,string> = { STORE_NOT_FOUND:"Store or fridge not found", NO_BALANCE:"This store has no outstanding balance", PAYMENT_EXCEEDS_BALANCE:"Paid amount cannot exceed outstanding balance", IDEMPOTENCY_CONFLICT:"This payment request key was used for a different payment" };
    return NextResponse.json({ error: messages[code] ?? "Unable to record payment", retryable: !messages[code] }, { status: code === "STORE_NOT_FOUND" ? 404 : code === "IDEMPOTENCY_CONFLICT" ? 409 : messages[code] ? 400 : 500 });
  }
}
