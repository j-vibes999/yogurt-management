import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/server-session";
import { writeAuditLog } from "@/lib/audit";
import { withSerializableTransaction } from "@/lib/transaction";
import { runIdempotentOperation } from "@/lib/idempotency";
import { decimalAtScale, parseBaseCups, RECIPE_SCALE } from "@/lib/stock-validation";
import { logError } from "@/lib/logger";

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) return NextResponse.json({ retryable: false, error: "ຖານຂໍ້ມູນຍັງບໍ່ໄດ້ຕັ້ງຄ່າ" }, { status: 503 });
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ retryable: false, error: "ກະລຸນາເຂົ້າລະບົບກ່ອນ" }, { status: 401 });
    if (session.role !== "admin" && session.role !== "production") return NextResponse.json({ retryable: false, error: "ບໍ່ມີສິດເຮັດລາຍການນີ້" }, { status: 403 });
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "ຂໍ້ມູນສູດບໍ່ຖືກຕ້ອງ", retryable: false }, { status: 400 });
    const recipeId = String(body.recipeId ?? "").trim();
    const finishedProductId = String(body.finishedProductId ?? "").trim();
    const baseCups = parseBaseCups(body.baseCups);
    const sourceItems: unknown[] = Array.isArray(body.items) ? body.items : [];
    if ((!recipeId && !finishedProductId) || !baseCups || !sourceItems.length || sourceItems.length > 200) return NextResponse.json({ retryable: false, error: "ຂໍ້ມູນສູດບໍ່ຖືກຕ້ອງ" }, { status: 400 });
    const items = sourceItems.map((source) => {
      const item = source && typeof source === "object" ? source as Record<string, unknown> : {};
      return { rawMaterialId: String(item.rawMaterialId ?? "").trim(), quantityRequired: decimalAtScale(item.quantityRequired, RECIPE_SCALE, { positive: true }) };
    });
    if (items.some((item) => !item.rawMaterialId || !item.quantityRequired) || new Set(items.map((item) => item.rawMaterialId)).size !== items.length) {
      return NextResponse.json({ retryable: false, error: "ວັດຖຸດິບໃນສູດຫ້າມຊ້ຳ ແລະຈຳນວນທຸກລາຍການຕ້ອງຫຼາຍກວ່າ 0" }, { status: 400 });
    }
    const name = String(body.name ?? "").trim();
    const payload = { recipeId, finishedProductId, baseCups, name, items: items.map((item) => ({ rawMaterialId: item.rawMaterialId, quantityRequired: item.quantityRequired!.toString() })) };
    const result = await withSerializableTransaction((tx) => runIdempotentOperation(tx, {
      key: request.headers.get("Idempotency-Key"), userId: session.userId, scope: "recipes.create", payload,
    }, async () => {
      const old = recipeId ? await tx.recipe.findUnique({ where: { id: recipeId } }) : null;
      if (recipeId && !old) throw new Error("NOT_FOUND");
      const productId = old?.finishedProductId || finishedProductId;
      const product = await tx.finishedProduct.findUnique({ where: { id: productId } });
      if (!product || !product.isActive) throw new Error("NOT_FOUND");
      // A row write makes a concurrent first-recipe creator retry its stale
      // Serializable snapshot. A lock alone cannot refresh that snapshot.
      await tx.finishedProduct.update({ where: { id: productId }, data: { id: productId }, select: { id: true } });
      const activeMaterials = await tx.rawMaterial.count({ where: { id: { in: items.map((item) => item.rawMaterialId) }, isActive: true } });
      if (activeMaterials !== items.length) throw new Error("INACTIVE_MATERIAL");
      const max = await tx.recipe.aggregate({ where: { finishedProductId: productId }, _max: { version: true } });
      await tx.recipe.updateMany({ where: { finishedProductId: productId }, data: { isDefault: false } });
      const recipe = await tx.recipe.create({ data: { finishedProductId: productId, name: name || old?.name || product.name, version: (max._max.version || 0) + 1, baseCups, isDefault: true,
        items: { create: items.map((item) => ({ rawMaterialId: item.rawMaterialId, quantityRequired: item.quantityRequired! })) },
      } });
      await writeAuditLog({ userId: session.userId, action: "recipe_version", entityType: "recipe", entityId: recipe.id, summary: `ສ້າງສະບັບສູດ ${recipe.version} · ${recipe.name}` }, tx);
      return { id: recipe.id, version: recipe.version };
    }));
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return NextResponse.json({ retryable: false, error: "ບໍ່ພົບສິນຄ້າ ຫຼືສູດທີ່ເປີດໃຊ້" }, { status: 404 });
    if (code === "INACTIVE_MATERIAL") return NextResponse.json({ retryable: false, error: "ບໍ່ພົບວັດຖຸດິບ ຫຼືວັດຖຸດິບຖືກປິດໃຊ້" }, { status: 409 });
    if (code === "IDEMPOTENCY_CONFLICT") return NextResponse.json({ retryable: false, error: "ລະຫັດລາຍການນີ້ຖືກໃຊ້ກັບຂໍ້ມູນອື່ນແລ້ວ" }, { status: 409 });
    if (code === "INVALID_IDEMPOTENCY_KEY" || code === "IDEMPOTENCY_KEY_REQUIRED") return NextResponse.json({ retryable: false, error: "ກະລຸນາໃສ່ລະຫັດລາຍການທີ່ຖືກຕ້ອງ" }, { status: 400 });
    logError("recipes.create_failed", { error });
    return NextResponse.json({ retryable: true, error: "ບໍ່ສາມາດບັນທຶກສະບັບສູດໄດ້" }, { status: 503 });
  }
}
