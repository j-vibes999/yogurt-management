import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { withSerializableTransaction } from "@/lib/transaction";
import { writeAuditLog } from "@/lib/audit";
import { getCurrentSession } from "@/lib/server-session";
import { logError } from "@/lib/logger";
import { runIdempotentOperation } from "@/lib/idempotency";
import { decimalAtScale, stockDecimal, STOCK_SCALE, UNIT_COST_SCALE } from "@/lib/stock-validation";

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) return NextResponse.json({ retryable: false, error: "ຖານຂໍ້ມູນຍັງບໍ່ໄດ້ຕັ້ງຄ່າ" }, { status: 503 });
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ retryable: false, error: "ກະລຸນາເຂົ້າລະບົບກ່ອນ" }, { status: 401 });
    if (session.role !== "admin" && session.role !== "production") return NextResponse.json({ retryable: false, error: "ບໍ່ມີສິດເຮັດລາຍການນີ້" }, { status: 403 });
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ", retryable: false }, { status: 400 });
    const rawMaterialId = String(body.rawMaterialId ?? "").trim();
    const key = request.headers.get("Idempotency-Key");

    if (body.action === "update_material") {
      const stockPresent = Object.hasOwn(body, "stock");
      const pricePresent = Object.hasOwn(body, "avgCostPerUnit");
      const minStockPresent = Object.hasOwn(body, "minStock");
      const namePresent = Object.hasOwn(body, "name");
      const unitPresent = Object.hasOwn(body, "unit");
      const stock = stockPresent ? decimalAtScale(body.stock, STOCK_SCALE) : null;
      const expectedStock = stockPresent ? decimalAtScale(body.expectedStock, STOCK_SCALE) : null;
      const avgCostPerUnit = pricePresent ? decimalAtScale(body.avgCostPerUnit, UNIT_COST_SCALE) : null;
      const minStock = minStockPresent ? decimalAtScale(body.minStock, 3) : null;
      const name = namePresent ? String(body.name ?? "").trim() : "";
      const unit = unitPresent ? String(body.unit ?? "").trim() : "";
      const stockReason = String(body.stockReason ?? "").trim();
      if (!rawMaterialId || (!stockPresent && !pricePresent && !minStockPresent && !namePresent && !unitPresent)
        || (stockPresent && (!stock || !expectedStock)) || (pricePresent && !avgCostPerUnit)
        || (minStockPresent && !minStock) || (namePresent && !name) || (unitPresent && !unit)) {
        return NextResponse.json({ retryable: false, error: "ຂໍ້ມູນວັດຖຸດິບບໍ່ຖືກຕ້ອງ" }, { status: 400 });
      }
      const updated = await withSerializableTransaction(async (tx) => {
        const work = async () => {
          const before = await tx.rawMaterial.findUnique({ where: { id: rawMaterialId } });
          if (!before) throw new Error("MATERIAL_NOT_FOUND");
          if (stock && !stockDecimal(before.currentStock).eq(expectedStock!)) throw new Error("STALE_STOCK");
          if (unitPresent && unit !== before.unit) throw new Error("UNIT_CHANGE_NOT_ALLOWED");
          const data: Prisma.RawMaterialUpdateInput = {};
          if (namePresent) data.name = name;
          if (avgCostPerUnit) data.avgCostPerUnit = avgCostPerUnit;
          if (minStock) data.minStockAlert = minStock;
          if (stock && !stock.eq(before.currentStock)) {
            if (!stockReason) throw new Error("STOCK_REASON_REQUIRED");
            const delta = stock.minus(before.currentStock);
            await tx.rawMaterialAdjustment.create({ data: { rawMaterialId, quantityDelta: delta, reason: "manual_correction", note: stockReason } });
            data.currentStock = stock;
          }
          const material = await tx.rawMaterial.update({ where: { id: rawMaterialId }, data });
          await writeAuditLog({ userId: session.userId, action: "update", entityType: "raw_material", entityId: material.id,
            summary: `ແກ້ໄຂ ${material.name} · ຈຳນວນຄົງເຫຼືອ ${before.currentStock.toString()} → ${material.currentStock.toString()} ${material.unit} · ຕົ້ນທຶນ ${Number(material.avgCostPerUnit).toLocaleString()} LAK/${material.unit}`,
            metadata: { before: { name: before.name, unit: before.unit, stock: Number(before.currentStock), minStock: Number(before.minStockAlert), cost: Number(before.avgCostPerUnit) }, after: { name: material.name, unit: material.unit, stock: Number(material.currentStock), minStock: Number(material.minStockAlert), cost: Number(material.avgCostPerUnit) } },
          }, tx);
          return { id: material.id, stock: Number(material.currentStock), minStock: Number(material.minStockAlert), avgCostPerUnit: Number(material.avgCostPerUnit) };
        };
        return runIdempotentOperation(tx, { key, userId: session.userId, scope: "inventory.update_material", payload: body }, work);
      });
      return NextResponse.json(updated);
    }

    const quantityDelta = decimalAtScale(body.quantityDelta, STOCK_SCALE, { allowNegative: true, nonzero: true });
    const reason = String(body.reason ?? "").trim();
    const note = String(body.note ?? "").trim() || null;
    if (!rawMaterialId || !quantityDelta || !reason) {
      return NextResponse.json({ retryable: false, error: "ກະລຸນາເລືອກວັດຖຸດິບ, ໃສ່ຈຳນວນທີ່ຈະປັບ ແລະເຫດຜົນ" }, { status: 400 });
    }
    const result = await withSerializableTransaction((tx) => runIdempotentOperation(tx, {
      key, userId: session.userId, scope: "inventory.adjust", payload: { rawMaterialId, quantityDelta: quantityDelta.toString(), reason, note },
    }, async () => {
      const material = await tx.rawMaterial.findUnique({ where: { id: rawMaterialId } });
      if (!material) throw new Error("MATERIAL_NOT_FOUND");
      const before = stockDecimal(material.currentStock);
      const after = decimalAtScale(before.plus(quantityDelta).toString(), STOCK_SCALE);
      if (!after) throw new Error(before.plus(quantityDelta).isNegative() ? "NEGATIVE_STOCK" : "STOCK_VALUE_OUT_OF_RANGE");
      const adjustment = await tx.rawMaterialAdjustment.create({ data: { rawMaterialId, quantityDelta, reason, note } });
      await tx.rawMaterial.update({ where: { id: rawMaterialId }, data: { currentStock: after } });
      const result = { id: adjustment.id, materialId: rawMaterialId, before: before.toNumber(), delta: quantityDelta.toNumber(), after: after.toNumber() };
      await writeAuditLog({ userId: session.userId, action: "adjust", entityType: "raw_material", entityId: rawMaterialId,
        summary: `ປັບຈຳນວນຄົງເຫຼືອ ${quantityDelta.gt(0) ? "+" : ""}${quantityDelta.toString()} · ${reason}`,
        metadata: { before: result.before, delta: result.delta, after: result.after, reason, note },
      }, tx);
      return result;
    }));
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "MATERIAL_NOT_FOUND") return NextResponse.json({ retryable: false, error: "ບໍ່ພົບວັດຖຸດິບ" }, { status: 404 });
    if (code === "NEGATIVE_STOCK") return NextResponse.json({ retryable: false, error: "ການປັບນີ້ຈະເຮັດໃຫ້ຈຳນວນຄົງເຫຼືອຕິດລົບ" }, { status: 409 });
    if (code === "STALE_STOCK") return NextResponse.json({ retryable: false, error: "ຈຳນວນຄົງເຫຼືອປ່ຽນແປງແລ້ວ ກະລຸນາໂຫຼດໜ້າໃໝ່ແລ້ວລອງອີກຄັ້ງ" }, { status: 409 });
    if (code === "UNIT_CHANGE_NOT_ALLOWED") return NextResponse.json({ retryable: false, error: "ບໍ່ສາມາດປ່ຽນຫົວໜ່ວຍຂອງວັດຖຸດິບທີ່ມີແລ້ວ" }, { status: 409 });
    if (code === "STOCK_REASON_REQUIRED") return NextResponse.json({ retryable: false, error: "ກະລຸນາໃສ່ເຫດຜົນເມື່ອປ່ຽນຈຳນວນຄົງເຫຼືອ" }, { status: 400 });
    if (code === "IDEMPOTENCY_CONFLICT") return NextResponse.json({ retryable: false, error: "ລະຫັດລາຍການນີ້ຖືກໃຊ້ກັບຂໍ້ມູນອື່ນແລ້ວ" }, { status: 409 });
    if (code === "INVALID_IDEMPOTENCY_KEY" || code === "IDEMPOTENCY_KEY_REQUIRED") return NextResponse.json({ retryable: false, error: "ກະລຸນາໃສ່ລະຫັດລາຍການທີ່ຖືກຕ້ອງ" }, { status: 400 });
    if (code === "STOCK_VALUE_OUT_OF_RANGE") return NextResponse.json({ retryable: false, error: "ຈຳນວນວັດຖຸດິບເກີນຂອບເຂດທີ່ຮອງຮັບ" }, { status: 400 });
    logError("inventory.adjust_failed", { error });
    return NextResponse.json({ retryable: true, error: "ບໍ່ສາມາດປັບຈຳນວນວັດຖຸດິບໄດ້" }, { status: 503 });
  }
}
