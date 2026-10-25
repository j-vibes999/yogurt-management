import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withSerializableTransaction } from "@/lib/transaction";
import { writeAuditLog } from "@/lib/audit";
import { getCurrentSession } from "@/lib/server-session";
import { runIdempotentOperation } from "@/lib/idempotency";
import { parseBaseCups, productionCosts, productionRequirement, stockDecimal } from "@/lib/stock-validation";
import { logError } from "@/lib/logger";

const schema = z.object({ productId: z.string().trim().min(1), cups: z.preprocess(parseBaseCups, z.number().int().positive().max(100000)) });
export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) return NextResponse.json({ retryable: false, error: "ຖານຂໍ້ມູນຍັງບໍ່ໄດ້ຕັ້ງຄ່າ" }, { status: 503 });
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ retryable: false, error: "ກະລຸນາເຂົ້າລະບົບກ່ອນ" }, { status: 401 });
    if (session.role !== "admin" && session.role !== "production") return NextResponse.json({ retryable: false, error: "ບໍ່ມີສິດເຮັດລາຍການນີ້" }, { status: 403 });
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ retryable: false, error: "ສິນຄ້າ ຫຼືຈຳນວນຜະລິດບໍ່ຖືກຕ້ອງ" }, { status: 400 });
    const { productId, cups } = parsed.data;
    const result = await withSerializableTransaction((tx) => runIdempotentOperation(tx, {
      key: request.headers.get("Idempotency-Key"), userId: session.userId, scope: "production.create", payload: { productId, cups },
    }, async () => {
      const product = await tx.finishedProduct.findUnique({ where: { id: productId }, include: { recipes: { where: { isDefault: true }, orderBy: { version: "desc" }, take: 1, include: { items: { include: { rawMaterial: true } } } } } });
      if (!product || !product.isActive || !product.recipes[0]) throw new Error("RECIPE_NOT_FOUND");
      const recipe = product.recipes[0];
      if (!recipe.items.length) throw new Error("INVALID_RECIPE_QUANTITY");
      const requirements = recipe.items.map((item) => {
        if (!item.rawMaterial.isActive) throw new Error("INACTIVE_MATERIAL");
        const required = productionRequirement(item.quantityRequired, cups, recipe.baseCups);
        if (!required) throw new Error("INVALID_RECIPE_QUANTITY");
        const avgCostPerUnit = stockDecimal(item.rawMaterial.avgCostPerUnit);
        return { rawMaterialId: item.rawMaterialId, name: item.rawMaterial.name, unit: item.rawMaterial.unit, available: stockDecimal(item.rawMaterial.currentStock), required, avgCostPerUnit, materialCost: required.times(avgCostPerUnit) };
      });
      const shortages = requirements.filter((item) => item.available.lt(item.required)).map((item) => ({ rawMaterialId: item.rawMaterialId, name: item.name, unit: item.unit, available: item.available.toNumber(), required: item.required.toNumber() }));
      if (shortages.length) {
        const error = new Error("INSUFFICIENT_RAW_MATERIALS") as Error & { shortages?: unknown };
        error.shortages = shortages;
        throw error;
      }
      const { totalMaterialCost, unitCost } = productionCosts(requirements.reduce((sum, item) => sum.plus(item.materialCost), stockDecimal(0)), cups);
      for (const item of [...requirements].sort((left, right) => left.rawMaterialId.localeCompare(right.rawMaterialId))) {
        await tx.rawMaterial.update({ where: { id: item.rawMaterialId }, data: { currentStock: { decrement: item.required } } });
      }
      const now = new Date();
      const mfgDate = now;
      const expDate = new Date(mfgDate.getTime() + product.shelfLifeDays * 86400000);
      const prefix = (product.code.replace(/[^A-Za-z0-9]/g, "").slice(0, 6) || "BATCH").toUpperCase();
      const stamp = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
      const batchNumber = `${prefix}-${stamp}-${randomUUID().slice(0, 8).toUpperCase()}`;
      const batch = await tx.productionBatch.create({ data: { batchNumber, recipeId: recipe.id, finishedProductId: product.id, quantityProduced: cups, quantityRemaining: cups, totalMaterialCost, unitCost, costKnown: true, mfgDate, expDate, status: "completed" } });
      const result = { id: batch.id, batchNumber: batch.batchNumber, productId: product.id, productName: product.name, recipeVersion: recipe.version, quantityProduced: batch.quantityProduced, quantityRemaining: batch.quantityRemaining,
        totalMaterialCost: Number(batch.totalMaterialCost), unitCost: Number(batch.unitCost), costKnown: true, mfgDate: batch.mfgDate.toISOString(), expDate: batch.expDate.toISOString(),
        materialsUsed: requirements.map(({ name, unit, required, avgCostPerUnit, materialCost }) => ({ name, unit, quantity: required.toNumber(), avgCostPerUnit: avgCostPerUnit.toNumber(), materialCost: materialCost.toNumber() })),
      };
      await writeAuditLog({ userId: session.userId, action: "create", entityType: "production_batch", entityId: result.id, summary: `ຜະລິດ ${result.productName} · ${result.quantityProduced} ຖ້ວຍ`, metadata: { productId: result.productId, batchNumber: result.batchNumber, unitCost: result.unitCost, costKnown: true } }, tx);
      return result;
    }));
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "RECIPE_NOT_FOUND") return NextResponse.json({ retryable: false, error: "ບໍ່ພົບສິນຄ້າທີ່ເປີດໃຊ້ ຫຼືສູດຫຼັກ" }, { status: 404 });
    if (code === "INACTIVE_MATERIAL") return NextResponse.json({ retryable: false, error: "ສູດນີ້ມີວັດຖຸດິບທີ່ຖືກປິດໃຊ້" }, { status: 409 });
    if (code === "INVALID_RECIPE_QUANTITY") return NextResponse.json({ retryable: false, error: "ຈຳນວນວັດຖຸດິບໃນສູດນ້ອຍເກີນໄປສຳລັບການຜະລິດຄັ້ງນີ້" }, { status: 400 });
    if (code === "INSUFFICIENT_RAW_MATERIALS") return NextResponse.json({ retryable: false, error: "ວັດຖຸດິບບໍ່ພໍສຳລັບການຜະລິດຄັ້ງນີ້", shortages: (error as Error & { shortages?: unknown }).shortages }, { status: 409 });
    if (code === "IDEMPOTENCY_CONFLICT") return NextResponse.json({ retryable: false, error: "ລະຫັດລາຍການນີ້ຖືກໃຊ້ກັບຂໍ້ມູນອື່ນແລ້ວ" }, { status: 409 });
    if (code === "INVALID_IDEMPOTENCY_KEY" || code === "IDEMPOTENCY_KEY_REQUIRED") return NextResponse.json({ retryable: false, error: "ກະລຸນາໃສ່ລະຫັດລາຍການທີ່ຖືກຕ້ອງ" }, { status: 400 });
    if (code === "STOCK_VALUE_OUT_OF_RANGE") return NextResponse.json({ retryable: false, error: "ມູນຄ່າການຜະລິດເກີນຂອບເຂດທີ່ຮອງຮັບ" }, { status: 400 });
    logError("production.create_failed", { error });
    return NextResponse.json({ retryable: true, error: "ບໍ່ສາມາດສ້າງລັອດຜະລິດໄດ້" }, { status: 503 });
  }
}
