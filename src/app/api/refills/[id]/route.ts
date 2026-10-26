import { NextResponse } from "next/server";
import { withSerializableTransaction } from "@/lib/transaction";
import { writeAuditLog } from "@/lib/audit";
import { ensureFridgeLots } from "@/lib/stock-cost";
import { getCurrentSession } from "@/lib/server-session";
import { prisma } from "@/lib/prisma";

type RefillStatus = "waiting" | "preparing" | "delivering" | "completed" | "cancelled";

const allowed: Record<RefillStatus, RefillStatus[]> = {
  waiting: ["preparing", "delivering", "cancelled"],
  preparing: ["delivering", "cancelled"],
  delivering: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "ຖານຂໍ້ມູນຍັງບໍ່ໄດ້ຕັ້ງຄ່າ" }, { status: 503 });
  }

  try {
    const session=await getCurrentSession(); if(!session||!["admin","driver"].includes(session.role))return NextResponse.json({error:"ບໍ່ມີສິດເຮັດລາຍການນີ້"},{status:403});
    const { id } = await params;
    const body = await request.json();
    const nextStatus = String(body.status ?? "") as RefillStatus;
    if (!Object.prototype.hasOwnProperty.call(allowed, nextStatus)) {
      return NextResponse.json({ error: "ສະຖານະການເຕີມສິນຄ້າບໍ່ຖືກຕ້ອງ" }, { status: 400 });
    }

    const result = await withSerializableTransaction(async (tx) => {
      const refillDelegate = tx.refillRequest;
      const batchDelegate = tx.productionBatch;

      const refill = await tx.refillRequest.findUnique({ where: { id }, include: { items: true, store: true } });
      if (!refill) throw new Error("REFILL_NOT_FOUND");
      const currentStatus = refill.status as RefillStatus;
      if (currentStatus === nextStatus) return { id: refill.id, status: currentStatus, alreadyApplied: true };
      if (!allowed[currentStatus]?.includes(nextStatus)) throw new Error("INVALID_TRANSITION");

      const deductions: Array<{ productId: string; batchId: string; quantity: number }> = [];
      if (nextStatus === "completed") {
        if (!refill.store.isActive) throw new Error("STORE_INACTIVE");
        const fridge = await tx.fridge.findUnique({ where: { currentStoreId: refill.storeId }, include: { inventory: true } });
        if (!fridge) throw new Error("STORE_HAS_NO_FRIDGE");
        if (fridge.status !== "active") throw new Error("FRIDGE_MAINTENANCE");
        const currentTotal = fridge.inventory.reduce((sum, row) => sum + row.currentStock, 0);
        const incomingTotal = refill.items.reduce((sum, row) => sum + row.quantity, 0);
        if (currentTotal + incomingTotal > fridge.capacityCups) throw new Error(`FRIDGE_CAPACITY:${currentTotal}:${incomingTotal}:${fridge.capacityCups}`);
        const now = new Date();
        for (const item of refill.items) {
          const currentInventory = fridge.inventory.find(row => row.finishedProductId === item.finishedProductId);
          await ensureFridgeLots(tx, { storeId: refill.storeId, fridgeId: fridge.id, productId: item.finishedProductId, currentStock: currentInventory?.currentStock ?? 0 });
          let remainingNeed = item.quantity;
          const batches = await batchDelegate.findMany({
            where: {
              finishedProductId: item.finishedProductId,
              status: "completed",
              expDate: { gte: now },
              quantityRemaining: { gt: 0 },
            },
            orderBy: [{ expDate: "asc" }, { mfgDate: "asc" }, { id: "asc" }],
          });
          const available = batches.reduce((sum, batch) => sum + Number(batch.quantityRemaining), 0);
          if (available < remainingNeed) throw new Error(`INSUFFICIENT_STOCK:${item.finishedProductId}:${available}:${remainingNeed}`);

          for (const batch of batches) {
            if (remainingNeed <= 0) break;
            const take = Math.min(remainingNeed, Number(batch.quantityRemaining));
            await batchDelegate.update({ where: { id: batch.id }, data: { quantityRemaining: { decrement: take } } });
            await tx.fridgeStockLot.create({ data: { storeId: refill.storeId, fridgeId: fridge.id, finishedProductId: item.finishedProductId, productionBatchId: batch.id, refillRequestId: refill.id, quantityReceived: take, quantityRemaining: take, unitCost: batch.unitCost, costKnown: batch.costKnown, expDate: batch.expDate } });
            deductions.push({ productId: item.finishedProductId, batchId: batch.id, quantity: take });
            remainingNeed -= take;
          }
          await tx.fridgeInventory.upsert({
            where: { fridgeId_finishedProductId: { fridgeId: fridge.id, finishedProductId: item.finishedProductId } },
            create: { fridgeId: fridge.id, storeId: refill.storeId, finishedProductId: item.finishedProductId, currentStock: item.quantity },
            update: { storeId: refill.storeId, currentStock: { increment: item.quantity } },
          });
        }
      }

      const updated = await refillDelegate.update({
        where: { id: refill.id },
        data: {
          status: nextStatus,
          deliveredAt: nextStatus === "completed" ? new Date() : refill.deliveredAt,
        },
      });

      await writeAuditLog({ userId: session.userId, action: "status", entityType: "refill_request", entityId: updated.id, summary: `ເຕີມສິນຄ້າ → ${updated.status}` }, tx);
      return { id: updated.id, status: updated.status as RefillStatus, deductions, storeName: refill.store.name };
    });
    return NextResponse.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "REFILL_NOT_FOUND") return NextResponse.json({ error: "ບໍ່ພົບຄຳຂໍເຕີມສິນຄ້າ" }, { status: 404 });
    if (code === "INVALID_TRANSITION") return NextResponse.json({ error: "ບໍ່ສາມາດປ່ຽນໄປສະຖານະນີ້ໄດ້" }, { status: 409 });
    if (code === "STORE_HAS_NO_FRIDGE") return NextResponse.json({ error: "ຮ້ານນີ້ຍັງບໍ່ມີຕູ້ແຊ່" }, { status: 409 });
    if (code === "STORE_INACTIVE") return NextResponse.json({ error: "ຮ້ານນີ້ຖືກປິດໃຊ້" }, { status: 409 });
    if (code === "FRIDGE_MAINTENANCE") return NextResponse.json({ error: "ຕູ້ແຊ່ຢູ່ໃນສະຖານະບຳລຸງ" }, { status: 409 });
    if (code.startsWith("FRIDGE_CAPACITY:")) { const [, current, incoming, capacity] = code.split(":"); return NextResponse.json({ error: `ຕູ້ແຊ່ບັນຈຸບໍ່ພໍ: ມີແລ້ວ ${current} ຖ້ວຍ + ເຕີມ ${incoming} ຖ້ວຍ ເກີນຄວາມຈຸ ${capacity} ຖ້ວຍ` }, { status: 409 }); }
    if (code.startsWith("INSUFFICIENT_STOCK:")) {
      const [, productId, available, required] = code.split(":");
      const product = await prisma.finishedProduct.findUnique({ where: { id: productId }, select: { name: true } }).catch(() => null);
      return NextResponse.json({ error: `ສິນຄ້າໃນສາງບໍ່ພໍ: ${product?.name ?? productId} ມີ ${available} ຖ້ວຍ (ທີ່ຍັງບໍ່ໝົດອາຍຸ), ຕ້ອງການ ${required} ຖ້ວຍ` }, { status: 409 });
    }
    console.error("[refill-api] status update failed", error);
    return NextResponse.json({ error: "ບໍ່ສາມາດອັບເດດສະຖານະການເຕີມສິນຄ້າໄດ້" }, { status: 400 });
  }
}
