import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withSerializableTransaction } from "@/lib/transaction";
import { writeAuditLog } from "@/lib/audit";
import { getCurrentSession } from "@/lib/server-session";
import { logError } from "@/lib/logger";
import { runIdempotentOperation } from "@/lib/idempotency";

const schema = z.object({
  storeId: z.string().trim().min(1),
  note: z.string().trim().max(1000).optional().nullable(),
  items: z.array(z.object({ finishedProductId: z.string().trim().min(1), quantity: z.coerce.number().int().positive().max(100000) })).min(1).optional(),
  cheeseQty: z.coerce.number().int().min(0).max(100000).optional(),
  mangoQty: z.coerce.number().int().min(0).max(100000).optional(),
});

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "ຖານຂໍ້ມູນຍັງບໍ່ໄດ້ຕັ້ງຄ່າ" }, { status: 503 });
  try {
    const session=await getCurrentSession(); if(!session||!["admin","driver"].includes(session.role))return NextResponse.json({error:"ບໍ່ມີສິດເຮັດລາຍການນີ້"},{status:403});
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "ຂໍ້ມູນຄຳຂໍເຕີມສິນຄ້າບໍ່ຖືກຕ້ອງ" }, { status: 400 });
    const body = parsed.data;
    let items = body.items ?? [];
    if (!items.length && ((body.cheeseQty ?? 0) + (body.mangoQty ?? 0) > 0)) {
      const legacy = await prisma.finishedProduct.findMany({ where: { code: { in: ["YG-CHS-74", "YG-MNG-74"] }, isActive: true } });
      const cheese = legacy.find((p) => p.code === "YG-CHS-74");
      const mango = legacy.find((p) => p.code === "YG-MNG-74");
      items = [
        ...(cheese && (body.cheeseQty ?? 0) > 0 ? [{ finishedProductId: cheese.id, quantity: body.cheeseQty! }] : []),
        ...(mango && (body.mangoQty ?? 0) > 0 ? [{ finishedProductId: mango.id, quantity: body.mangoQty! }] : []),
      ];
    }
    if (!items.length) return NextResponse.json({ error: "ກະລຸນາໃສ່ຈຳນວນສິນຄ້າຢ່າງໜ້ອຍ 1 ລາຍການ" }, { status: 400 });
    const ids = [...new Set(items.map((item) => item.finishedProductId))];
    if (ids.length !== items.length) return NextResponse.json({ error: "ມີສິນຄ້າຊ້ຳໃນຄຳຂໍເຕີມສິນຄ້າ" }, { status: 400 });

    const total = items.reduce((sum, item) => sum + item.quantity, 0);
    const refill = await withSerializableTransaction(tx => runIdempotentOperation(tx, {key:request.headers.get("Idempotency-Key"),userId:session.userId,scope:"refill_create",payload:{storeId:body.storeId,note:body.note??null,items}}, async () => {
      const products = await tx.finishedProduct.count({where:{id:{in:ids},isActive:true}});
      if(products!==ids.length)throw new Error("PRODUCT_NOT_AVAILABLE");
      const store = await tx.store.findUnique({ where: { id: body.storeId }, include: { fridge: true } });
      if (!store || !store.isActive) throw new Error("STORE_NOT_FOUND");
      if (!store.fridge) throw new Error("STORE_HAS_NO_FRIDGE");
      const created = await tx.refillRequest.create({ data: { storeId: body.storeId, status: "waiting", note: body.note || null, items: { create: items } } });
      await writeAuditLog({ userId: session.userId, action: "create", entityType: "refill_request", entityId: created.id, storeId: body.storeId, summary: `ສ້າງຄຳຂໍເຕີມສິນຄ້າ · ${total} ຖ້ວຍ`, metadata: { items } }, tx);
      return {id:created.id,status:created.status};
    }));
    return NextResponse.json({ id: refill.id, status: refill.status }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "IDEMPOTENCY_KEY_REQUIRED" || code === "INVALID_IDEMPOTENCY_KEY") return NextResponse.json({error:"ລະຫັດລາຍການບໍ່ຖືກຕ້ອງ",retryable:false},{status:400});
    if (code === "IDEMPOTENCY_CONFLICT" || code === "PRODUCT_NOT_AVAILABLE") return NextResponse.json({error:"ລາຍການປ່ຽນແປງ ຫຼືສິນຄ້າບໍ່ພ້ອມ; ກະລຸນາໂຫຼດຄືນ",retryable:false},{status:409});
    if (code === "STORE_NOT_FOUND") return NextResponse.json({ error: "ບໍ່ພົບຮ້ານ or inactive" }, { status: 404 });
    if (code === "STORE_HAS_NO_FRIDGE") return NextResponse.json({ error: "ຮ້ານນີ້ຍັງບໍ່ມີຕູ້ແຊ່" }, { status: 409 });
    logError("refill.create_failed", { error });
    return NextResponse.json({ error: "ບໍ່ສາມາດສ້າງຄຳຂໍເຕີມສິນຄ້າໄດ້; ກະລຸນາລອງລາຍການເດີມອີກຄັ້ງ", retryable:true }, { status: 503 });
  }
}
