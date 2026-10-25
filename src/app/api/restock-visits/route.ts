import { NextResponse } from "next/server";
import { withSerializableTransaction } from "@/lib/transaction";
import { writeAuditLog } from "@/lib/audit";
import { getCurrentSession } from "@/lib/server-session";
import { calculateLiveRestockLine } from "@/lib/business";
import { createHash } from "node:crypto";
import { assertMoneyRange, calculateSettlementCents, moneyDecimalString, moneyNumber, parseMoneyCents, parseWholeCount, roundMoneyCents } from "@/lib/money";
import { consumeFridgeLots } from "@/lib/stock-cost";
import { runIdempotentOperation } from "@/lib/idempotency";
import { refilledSinceAudit } from "@/lib/refill-summary";

import { logError } from "@/lib/logger";
type RestockDelegate = {
  create(args: unknown): Promise<{ id: string }>;
};

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "ຖານຂໍ້ມູນຍັງບໍ່ໄດ້ຕັ້ງຄ່າ" }, { status: 503 });
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "ຂໍ້ມູນການກວດຮ້ານບໍ່ຖືກຕ້ອງ", retryable: false }, { status: 400 });
    const storeId = String(body.storeId ?? "").trim();
    const fridgeAssetCode = String(body.fridgeAssetCode ?? "").trim();
    const inputLines = Array.isArray(body.lines) ? body.lines : [];
    const requestedPaidCents = body.paidAmount === undefined ? BigInt(0) : parseMoneyCents(body.paidAmount);
    if (requestedPaidCents === null) return NextResponse.json({ error: "ຈຳນວນເງິນທີ່ຮັບຕ້ອງບໍ່ຕິດລົບ ແລະມີທົດສະນິຍົມບໍ່ເກີນ 2 ຕຳແໜ່ງ", retryable: false }, { status: 400 });
    const requestedPaidAmount = moneyNumber(requestedPaidCents);
    const expectedFinancialSnapshot = body.expectedFinancialSnapshot;
    const requestedMethod = body.paymentMethod === "bank" ? "bank" : body.paymentMethod === "cash" ? "cash" : null;

    if (!storeId || !fridgeAssetCode || inputLines.length === 0) {
      return NextResponse.json({ error: "ຂໍ້ມູນຮ້ານ, ຕູ້ແຊ່ ຫຼືລາຍການກວດບໍ່ຄົບ", retryable: false }, { status: 400 });
    }
    if (requestedPaidAmount > 0 && !requestedMethod) {
      return NextResponse.json({ error: "ກະລຸນາເລືອກວິທີຮັບເງິນເມື່ອຈຳນວນຮັບຫຼາຍກວ່າ 0", retryable: false }, { status: 400 });
    }

    const session = await getCurrentSession();
    if (!session || !["admin", "driver"].includes(session.role)) return NextResponse.json({ error: "ບໍ່ມີສິດເຮັດລາຍການນີ້" }, { status: 403 });
    const key = request.headers.get("idempotency-key");
    if (!key) return NextResponse.json({ error: "ບໍ່ພົບລະຫັດຄຳຂໍ; ກະລຸນາໂຫຼດໜ້າຄືນແລ້ວລອງໃໝ່", retryable: false }, { status: 400 });
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) return NextResponse.json({ error: "ລະຫັດຄຳຂໍບໍ່ຖືກຕ້ອງ; ກະລຸນາໂຫຼດໜ້າຄືນແລ້ວລອງໃໝ່", retryable: false }, { status: 400 });
    const stableReceipt = `ST-${key.replaceAll("-", "").toUpperCase()}`;
    const requestPayload = [storeId, fridgeAssetCode, inputLines, requestedPaidAmount, requestedMethod];
    if (expectedFinancialSnapshot !== undefined) requestPayload.push(expectedFinancialSnapshot);
    const requestNote = `restock:${createHash("sha256").update(JSON.stringify(requestPayload)).digest("hex")}`;
    const result = await withSerializableTransaction((tx) => runIdempotentOperation(tx, {
      key, userId: session.userId, scope: "restock.complete", payload: requestPayload,
    }, async () => {
      const existing = await tx.settlement.findUnique({ where: { receiptNumber: stableReceipt }, include: { restockVisit: { include: { items: true } } } });
      if (existing) {
        if (existing.storeId !== storeId || existing.restockVisit.note !== requestNote) throw new Error("IDEMPOTENCY_CONFLICT");
        const totalCostCents = existing.restockVisit.items.reduce((sum, item) => sum + roundMoneyCents(String(item.subtotalCost)), BigInt(0));
        const totalCost = moneyNumber(totalCostCents);
        return { visitId: existing.restockVisitId, settlementId: existing.id, receiptNumber: stableReceipt,
          grossAmount: Number(existing.grossAmount), totalCost, grossMarginBeforeStoreShare: moneyNumber(roundMoneyCents(String(existing.grossAmount)) - totalCostCents),
          storeCommissionAmount: Number(existing.storeCommissionAmount), netPayableAmount: Number(existing.netPayableAmount),
          previousBalance: Number(existing.previousBalance), paidAmount: Number(existing.paidAmount),
          closingBalance: Number(existing.closingBalance), paymentStatus: existing.paymentStatus };
      }
      const store = await tx.store.findUnique({
        where: { id: storeId },
        include: {
          fridge: true,
          // Only the rows of the fridge that stands in this store now. Rows left behind by a fridge
          // that moved away must not be counted again.
          fridgeInventory: { where: { fridge: { currentStoreId: storeId } }, include: { finishedProduct: true } },
          settlements: { orderBy: [{ settlementDate: "desc" }, { id: "desc" }], take: 1 },
        },
      });
      if (!store || !store.fridge || store.fridge.assetCode !== fridgeAssetCode) {
        throw new Error("STORE_OR_FRIDGE_NOT_FOUND");
      }
      if (!store.isActive) throw new Error("STORE_INACTIVE");
      const refilledByProduct = await refilledSinceAudit(store.id, tx);

      if (inputLines.some((line: unknown) => !line || typeof line !== "object" || Array.isArray(line))) throw new Error("INCOMPLETE_AUDIT_LINES");
      const inputByProduct = new Map<string, Record<string, unknown>>(inputLines.map((line: Record<string, unknown>) => [String(line.productId ?? ""), line]));
      if (inputByProduct.size !== inputLines.length || inputByProduct.size !== store.fridgeInventory.length) throw new Error("INCOMPLETE_AUDIT_LINES");
      const previousBalanceCents = roundMoneyCents(String(store.settlements[0]?.closingBalance ?? 0));
      if (expectedFinancialSnapshot !== undefined) {
        const snapshot = expectedFinancialSnapshot;
        if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.retailPrices)) throw new Error("INVALID_FINANCIAL_SNAPSHOT");
        const prices = new Map<string, bigint | null>();
        for (const price of snapshot.retailPrices) {
          if (!price || typeof price.productId !== "string" || prices.has(price.productId)) throw new Error("INVALID_FINANCIAL_SNAPSHOT");
          prices.set(price.productId, parseMoneyCents(price.retailPrice));
        }
        const expectedBalance = parseMoneyCents(snapshot.previousBalance);
        if (expectedBalance === null || (typeof snapshot.commissionRate !== "number" && typeof snapshot.commissionRate !== "string") || !/^\d+(?:\.\d+)?$/.test(String(snapshot.commissionRate)) || !Number.isFinite(Number(snapshot.commissionRate)) || Number(snapshot.commissionRate) > 1 || prices.size !== store.fridgeInventory.length || [...prices.values()].some((price) => price === null)) throw new Error("INVALID_FINANCIAL_SNAPSHOT");
        if (expectedBalance !== previousBalanceCents || Number(snapshot.commissionRate) !== Number(store.commissionRate) || store.fridgeInventory.some((inventory) => prices.get(inventory.finishedProductId) !== roundMoneyCents(String(inventory.finishedProduct.retailPrice)))) throw new Error("STALE_FINANCIAL_SNAPSHOT");
      }

      const restockDelegate = tx.restockVisit as unknown as RestockDelegate;
      let grossCents = BigInt(0);
      let totalCostCents = BigInt(0);
      const visitItems: Array<Record<string, unknown>> = [];
      const inventoryUpdates: Array<{ id: string; currentStock: number }> = [];

      for (const inventory of store.fridgeInventory) {
        const input = inputByProduct.get(inventory.finishedProductId) as Record<string, unknown> | undefined;
        if (!input) throw new Error("INCOMPLETE_AUDIT_LINES");

        const expectedPreviousStock = parseWholeCount(input.previousStock);
        const countRemaining = parseWholeCount(input.countRemaining);
        const countExpiredReturned = parseWholeCount(input.countExpiredReturned);
        const expectedRefilled = parseWholeCount(input.countRefilled);
        if (expectedPreviousStock === null || countRemaining === null || countExpiredReturned === null || expectedRefilled === null) {
          throw new Error("INVALID_AUDIT_COUNTS");
        }

        const countRefilled = refilledByProduct.get(inventory.finishedProductId) ?? 0;
        if (expectedPreviousStock !== inventory.currentStock || expectedRefilled !== countRefilled) throw new Error("STALE_INVENTORY");

        const retailPrice = Number(inventory.finishedProduct.retailPrice);
        const line = calculateLiveRestockLine({ previousStock: inventory.currentStock, countRefilled, countRemaining, countExpiredReturned, retailPrice });
        if (line.hasNegativeSale) throw new Error("NEGATIVE_SALES");
        const { unitsSold } = line;
        const lineGrossCents = assertMoneyRange(roundMoneyCents(String(inventory.finishedProduct.retailPrice)) * BigInt(unitsSold));

        const { unitCost, subtotalCost, costKnown, unknownCostUnits, expiredCost, expiredUnknownUnits } = await consumeFridgeLots(tx, {
          storeId: store.id, fridgeId: store.fridge.id, productId: inventory.finishedProductId,
          currentStock: inventory.currentStock, unitsSold, expiredReturned: countExpiredReturned,
        });
        const lineCostCents = assertMoneyRange(roundMoneyCents(subtotalCost));
        grossCents = assertMoneyRange(grossCents + lineGrossCents);
        totalCostCents = assertMoneyRange(totalCostCents + lineCostCents);
        visitItems.push({
          finishedProductId: inventory.finishedProductId,
          previousStock: inventory.currentStock,
          countRemaining,
          countExpiredReturned,
          countRefilled,
          unitsSold,
          retailPrice,
          subtotalGross: moneyDecimalString(lineGrossCents),
          unitCost,
          subtotalCost: moneyDecimalString(lineCostCents),
          costKnown,
          unknownCostUnits,
          expiredCost: moneyDecimalString(assertMoneyRange(roundMoneyCents(expiredCost))),
          expiredUnknownUnits,
        });
        inventoryUpdates.push({ id: inventory.id, currentStock: countRemaining });
      }

      const amounts = calculateSettlementCents(grossCents, String(store.commissionRate));
      const totalDueCents = assertMoneyRange(previousBalanceCents + amounts.netPayableCents);
      if (requestedPaidCents > totalDueCents) throw new Error("PAYMENT_EXCEEDS_BALANCE");
      const closingBalanceCents = totalDueCents - requestedPaidCents;
      const paymentStatus = closingBalanceCents === BigInt(0) ? "paid" : requestedPaidCents > BigInt(0) ? "partial" : "pending";
      const grossAmount = moneyNumber(grossCents);
      const totalCost = moneyNumber(totalCostCents);
      const storeCommissionAmount = moneyNumber(amounts.storeCommissionCents);
      const netPayableAmount = moneyNumber(amounts.netPayableCents);
      const previousBalance = moneyNumber(previousBalanceCents);
      const closingBalance = moneyNumber(closingBalanceCents);
      const now = new Date();
      const receiptNumber = stableReceipt;

      const visit = await restockDelegate.create({
        data: {
          storeId: store.id,
          fridgeId: store.fridge.id,
          visitDate: now,
          status: "completed",
          driverUserId: session.userId,
          note: requestNote,
          items: { create: visitItems },
        },
      });

      for (const update of inventoryUpdates) {
        await tx.fridgeInventory.update({ where: { id: update.id }, data: { currentStock: update.currentStock, lastAuditDate: now } });
      }

      const settlement = await tx.settlement.create({
        data: {
          restockVisitId: visit.id,
          storeId: store.id,
          grossAmount: moneyDecimalString(grossCents),
          storeCommissionAmount: moneyDecimalString(amounts.storeCommissionCents),
          netPayableAmount: moneyDecimalString(amounts.netPayableCents),
          paymentStatus,
          paymentMethod: requestedPaidAmount > 0 ? requestedMethod : null,
          previousBalance: moneyDecimalString(previousBalanceCents),
          paidAmount: moneyDecimalString(requestedPaidCents),
          closingBalance: moneyDecimalString(closingBalanceCents),
          receiptNumber,
          settlementDate: now,
        },
      });

      await writeAuditLog({ userId: session.userId, action: "complete", entityType: "restock_visit", entityId: visit.id, storeId, summary: `ປິດຮອບກວດ ແລະບັນທຶກ ${receiptNumber}` }, tx);
      return {
        visitId: visit.id,
        settlementId: settlement.id,
        receiptNumber,
        grossAmount,
        totalCost,
        grossMarginBeforeStoreShare: moneyNumber(grossCents - totalCostCents),
        storeCommissionAmount,
        netPayableAmount,
        previousBalance,
        paidAmount: requestedPaidAmount,
        closingBalance,
        paymentStatus,
      };
    }));

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    const status = ["STALE_INVENTORY", "STALE_FINANCIAL_SNAPSHOT"].includes(code) ? 409 : code === "STORE_OR_FRIDGE_NOT_FOUND" ? 404 : 400;
    // Drivers read Lao, so every message shown on the audit screen is in Lao.
    const messages: Record<string, string> = {
      INVALID_FINANCIAL_SNAPSHOT: "ຂໍ້ມູນລາຄາ ແລະຍອດເງິນທີ່ສົ່ງມາບໍ່ຄົບ ຫຼືບໍ່ຖືກຕ້ອງ; ກະລຸນາໂຫຼດໜ້າຄືນ",
      STALE_FINANCIAL_SNAPSHOT: "ລາຄາ, ອັດຕາສ່ວນແບ່ງ ຫຼືຍອດຄ້າງເດີມປ່ຽນແປງຫຼັງຈາກເປີດໜ້ານີ້; ກະລຸນາໂຫຼດໜ້າຄືນ ແລະກວດຍອດໃໝ່ກ່ອນປິດຮອບ",
      MONEY_OUT_OF_RANGE: "ຈຳນວນເງິນເກີນຂອບເຂດທີ່ລະບົບຮອງຮັບ",
      STALE_INVENTORY: "ຈຳນວນສິນຄ້າໃນຕູ້ ຫຼືການເຕີມສິນຄ້າປ່ຽນແປງຫຼັງຈາກເປີດໜ້ານີ້; ກະລຸນາໂຫຼດໜ້າຄືນກ່ອນປິດຮອບ",
      STORE_OR_FRIDGE_NOT_FOUND: "ບໍ່ພົບຮ້ານ ຫຼືຕູ້ແຊ່ທີ່ຕິດຕັ້ງຢູ່ຮ້ານນີ້",
      STORE_INACTIVE: "ຮ້ານນີ້ຖືກປິດໃຊ້ແລ້ວ",
      INCOMPLETE_AUDIT_LINES: "ກະລຸນານັບສິນຄ້າທຸກລາຍການໃນຕູ້ກ່ອນປິດຮອບ",
      INVALID_AUDIT_COUNTS: "ຈຳນວນທີ່ນັບຕ້ອງເປັນຈຳນວນເຕັມທີ່ບໍ່ຕິດລົບ",
      NEGATIVE_SALES: "ຈຳນວນທີ່ນັບເຮັດໃຫ້ຍອດຂາຍຕິດລົບ; ກະລຸນາກວດຈຳນວນອີກຄັ້ງ",
      PAYMENT_EXCEEDS_BALANCE: "ຈຳນວນເງິນທີ່ຮັບເກີນຍອດທີ່ຕ້ອງຮັບ",
      IDEMPOTENCY_CONFLICT: "ລະຫັດຄຳຂໍນີ້ຖືກໃຊ້ກັບການກວດຮ້ານອື່ນແລ້ວ; ກະລຸນາໂຫຼດໜ້າຄືນ",
      STOCK_LOT_MISMATCH: "ຂໍ້ມູນລັອດສິນຄ້າບໍ່ກົງກັບຈຳນວນໃນຕູ້; ກະລຸນາໂຫຼດໜ້າຄືນ ແລະແຈ້ງຜູ້ຈັດການ",
    };
    logError("restock.complete_failed", { error });
    return NextResponse.json({ error: messages[code] ?? "ບໍ່ສາມາດປິດຮອບກວດໄດ້; ກະລຸນາລອງໃໝ່", code: messages[code] ? code : undefined, retryable: !messages[code] }, { status: ["IDEMPOTENCY_CONFLICT", "STORE_INACTIVE", "STOCK_LOT_MISMATCH"].includes(code) ? 409 : messages[code] ? status : 500 });
  }
}
