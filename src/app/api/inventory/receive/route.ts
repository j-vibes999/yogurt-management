import { businessDateOnly, parseDateOnly } from "@/lib/date-only";
import { NextResponse } from "next/server";
import { withSerializableTransaction } from "@/lib/transaction";
import { writeAuditLog } from "@/lib/audit";
import { getCurrentSession } from "@/lib/server-session";
import { logError } from "@/lib/logger";
import { runIdempotentOperation } from "@/lib/idempotency";
import { decimalAtScale, receiptStockAndCost, STOCK_SCALE, UNIT_COST_SCALE } from "@/lib/stock-validation";

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) return NextResponse.json({ retryable: false, error: "ຖານຂໍ້ມູນຍັງບໍ່ໄດ້ຕັ້ງຄ່າ" }, { status: 503 });
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ retryable: false, error: "ກະລຸນາເຂົ້າລະບົບກ່ອນ" }, { status: 401 });
    if (session.role !== "admin" && session.role !== "production") return NextResponse.json({ retryable: false, error: "ບໍ່ມີສິດເຮັດລາຍການນີ້" }, { status: 403 });
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ", retryable: false }, { status: 400 });
    const supplierName = String(body.supplierName ?? "").trim();
    const rawMaterialId = String(body.rawMaterialId ?? "").trim();
    const quantity = decimalAtScale(body.quantity, STOCK_SCALE, { positive: true });
    const unitPrice = decimalAtScale(body.unitPrice, UNIT_COST_SCALE);
    const note = String(body.note ?? "").trim() || null;
    if (!supplierName || !rawMaterialId || !quantity || !unitPrice) return NextResponse.json({ retryable: false, error: "ກະລຸນາໃສ່ຜູ້ສະໜອງ, ວັດຖຸດິບ, ຈຳນວນ ແລະລາຄາຕໍ່ຫົວໜ່ວຍທີ່ຖືກຕ້ອງ" }, { status: 400 });
    const purchaseDate = body.purchaseDate === undefined ? businessDateOnly() : parseDateOnly(body.purchaseDate);
    if (!purchaseDate) return NextResponse.json({ retryable: false, error: "ວັນທີຊື້ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
    // Hash the submitted date, so a retry without a date does not change identity.
    const payload = { supplierName, rawMaterialId, quantity: quantity.toString(), unitPrice: unitPrice.toString(), note, purchaseDate: body.purchaseDate ?? null };
    const result = await withSerializableTransaction((tx) => runIdempotentOperation(tx, {
      key: request.headers.get("Idempotency-Key"), userId: session.userId, scope: "inventory.receive", payload,
    }, async () => {
      const material = await tx.rawMaterial.findUnique({ where: { id: rawMaterialId } });
      if (!material) throw new Error("MATERIAL_NOT_FOUND");
      if (!material.isActive) throw new Error("INACTIVE_MATERIAL");
      const { newStock, weightedAvg, totalPrice } = receiptStockAndCost(material.currentStock, material.avgCostPerUnit, quantity, unitPrice);
      const purchase = await tx.purchaseOrder.create({ data: { supplierName, purchaseDate, totalCost: totalPrice, note, createdById: session.userId, items: { create: [{ rawMaterialId, quantity, unitPrice, totalPrice }] } } });
      await tx.rawMaterial.update({ where: { id: rawMaterialId }, data: { currentStock: newStock, avgCostPerUnit: weightedAvg } });
      await writeAuditLog({ userId: session.userId, action: "receive", entityType: "purchase_order", entityId: purchase.id, summary: `ຮັບ ${material.name} ຈາກ ${supplierName} · ${quantity.toString()} ${material.unit}` }, tx);
      return { id: purchase.id, newStock: newStock.toNumber(), weightedAvg: weightedAvg.toNumber(), totalPrice: totalPrice.toNumber(), materialName: material.name, unit: material.unit };
    }));
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "MATERIAL_NOT_FOUND") return NextResponse.json({ retryable: false, error: "ບໍ່ພົບວັດຖຸດິບ" }, { status: 404 });
    if (code === "INACTIVE_MATERIAL") return NextResponse.json({ retryable: false, error: "ວັດຖຸດິບນີ້ຖືກປິດໃຊ້" }, { status: 409 });
    if (code === "IDEMPOTENCY_CONFLICT") return NextResponse.json({ retryable: false, error: "ລະຫັດລາຍການນີ້ຖືກໃຊ້ກັບຂໍ້ມູນອື່ນແລ້ວ" }, { status: 409 });
    if (code === "INVALID_IDEMPOTENCY_KEY" || code === "IDEMPOTENCY_KEY_REQUIRED") return NextResponse.json({ retryable: false, error: "ລະຫັດລາຍການບໍ່ຖືກຕ້ອງ" }, { status: 400 });
    if (code === "STOCK_VALUE_OUT_OF_RANGE") return NextResponse.json({ retryable: false, error: "ຈຳນວນ ຫຼືມູນຄ່າວັດຖຸດິບເກີນຂອບເຂດທີ່ຮອງຮັບ" }, { status: 400 });
    logError("inventory.receive_failed", { error });
    return NextResponse.json({ retryable: true, error: "ບໍ່ສາມາດຮັບວັດຖຸດິບໄດ້" }, { status: 503 });
  }
}
