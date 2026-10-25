import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { getCurrentSession } from "@/lib/server-session";
import { withSerializableTransaction } from "@/lib/transaction";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "ຍັງບໍ່ໄດ້ເຊື່ອມຕໍ່ Database" }, { status: 503 });
  try {
    const session = await getCurrentSession();
    if (!session || session.role !== "admin") return NextResponse.json({ error: "ບັນຊີນີ້ບໍ່ມີສິດແກ້ໄຂຕູ້ແຊ່" }, { status: 403 });
    const { id } = await params;
    const body = await request.json();

    const assetCode = body.assetCode === undefined ? undefined : String(body.assetCode).trim();
    const serialNo = body.serialNo === undefined ? undefined : String(body.serialNo).trim();
    const model = body.model === undefined ? undefined : String(body.model).trim();
    if (assetCode !== undefined && !assetCode) return NextResponse.json({ error: "ລະຫັດຕູ້ຫ້າມວ່າງ" }, { status: 400 });

    const status = body.status === undefined ? undefined : String(body.status);
    if (status !== undefined && !["active", "maintenance"].includes(status)) return NextResponse.json({ error: "ສະຖານະຕູ້ແຊ່ບໍ່ຖືກຕ້ອງ" }, { status: 400 });

    const capacityCups = body.capacityCups === undefined ? undefined : Number(body.capacityCups);
    if (capacityCups !== undefined && (!Number.isInteger(capacityCups) || capacityCups <= 0)) return NextResponse.json({ error: "ຄວາມຈຸຕ້ອງເປັນຈຳນວນເຕັມຫຼາຍກວ່າ 0" }, { status: 400 });

    const result = await withSerializableTransaction(async (tx) => {
      const fridge = await tx.fridge.findUnique({ where: { id }, include: { inventory: true } });
      if (!fridge) throw new Error("FRIDGE_NOT_FOUND");
      const stockTotal = fridge.inventory.reduce((sum, row) => sum + row.currentStock, 0);
      if (capacityCups !== undefined && capacityCups < stockTotal) throw new Error("FRIDGE_CAPACITY_BELOW_STOCK");

      let currentStoreId = fridge.currentStoreId;
      if (body.currentStoreId !== undefined) {
        const raw = String(body.currentStoreId ?? "").trim();
        const requestedStoreId = raw || null;
        if (requestedStoreId !== fridge.currentStoreId && stockTotal > 0) throw new Error("FRIDGE_HAS_STOCK");
        if (requestedStoreId) {
          const target = await tx.store.findUnique({ where: { id: requestedStoreId }, include: { fridge: true } });
          if (!target || !target.isActive) throw new Error("STORE_NOT_FOUND");
          if (target.fridge && target.fridge.id !== fridge.id) throw new Error("STORE_HAS_FRIDGE");
        }
        currentStoreId = requestedStoreId;
      }

      if (status === "maintenance" && fridge.status !== "maintenance" && stockTotal > 0) throw new Error("FRIDGE_HAS_STOCK");

      const updated = await tx.fridge.update({
        where: { id },
        data: {
          ...(assetCode === undefined ? {} : { assetCode }),
          ...(model === undefined ? {} : { model: model || null }),
          ...(serialNo === undefined ? {} : { serialNo: serialNo || null }),
          ...(capacityCups === undefined ? {} : { capacityCups }),
          ...(status === undefined ? {} : { status: status as "active" | "maintenance" }),
          currentStoreId,
        },
      });

      if (currentStoreId && currentStoreId !== fridge.currentStoreId) {
        await tx.fridgeInventory.updateMany({ where: { fridgeId: fridge.id }, data: { storeId: currentStoreId } });
      }
      await writeAuditLog({
        userId: session.userId, action: "update", entityType: "fridge", entityId: updated.id,
        storeId: updated.currentStoreId, summary: `ແກ້ໄຂຕູ້ ${updated.assetCode}`,
        metadata: {
          before: { assetCode: fridge.assetCode, status: fridge.status, capacityCups: fridge.capacityCups, currentStoreId: fridge.currentStoreId },
          after: { assetCode: updated.assetCode, status: updated.status, capacityCups: updated.capacityCups, currentStoreId: updated.currentStoreId },
        },
      }, tx);
      return updated;
    });
    return NextResponse.json({ id: result.id, assetCode: result.assetCode, storeId: result.currentStoreId, status: result.status });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = Array.isArray(error.meta?.target) ? error.meta?.target.join(" ") : String(error.meta?.target ?? "");
      const message = target.includes("serial") ? "Serial ນີ້ຖືກໃຊ້ກັບຕູ້ອື່ນແລ້ວ" : "Asset Code ນີ້ຖືກໃຊ້ກັບຕູ້ອື່ນແລ້ວ";
      return NextResponse.json({ error: message }, { status: 409 });
    }
    const code = error instanceof Error ? error.message : "UNKNOWN";
    const messages: Record<string, string> = {
      FRIDGE_NOT_FOUND: "ບໍ່ພົບຕູ້ແຊ່ນີ້",
      STORE_NOT_FOUND: "ບໍ່ພົບຮ້ານປາຍທາງ ຫຼືຮ້ານຖືກປິດໃຊ້",
      STORE_HAS_FRIDGE: "ຮ້ານປາຍທາງມີຕູ້ແຊ່ອື່ນຢູ່ແລ້ວ",
      FRIDGE_HAS_STOCK: "ຕູ້ຍັງມີ Stock. ກະລຸນາເຄລຍ Stock ໃຫ້ເຫຼືອ 0 ກ່ອນຍ້າຍຮ້ານ ຫຼືເຂົ້າບຳລຸງ",
      FRIDGE_CAPACITY_BELOW_STOCK: "ຄວາມຈຸໃໝ່ຕ່ຳກວ່າຈຳນວນສິນຄ້າໃນຕູ້",
    };
    console.error("[fridges-api] update failed", error);
    return NextResponse.json({ error: messages[code] ?? "ບໍ່ສາມາດບັນທຶກຕູ້ແຊ່ໄດ້" }, { status: code === "FRIDGE_NOT_FOUND" || code === "STORE_NOT_FOUND" ? 404 : 409 });
  }
}
