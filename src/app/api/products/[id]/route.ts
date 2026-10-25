import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentSession } from "@/lib/server-session";
import { writeAuditLog } from "@/lib/audit";
import { withSerializableTransaction } from "@/lib/transaction";
import { runIdempotentOperation } from "@/lib/idempotency";
import { updateProductSchema } from "@/lib/product-input";
import { logError } from "@/lib/logger";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "ບໍ່ມີສິດເຮັດລາຍການນີ້", retryable: false }, { status: 403 });
  const parsed = updateProductSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "ຂໍ້ມູນສິນຄ້າບໍ່ຖືກຕ້ອງ; ລາຄາຕ້ອງມີທົດສະນິຍົມບໍ່ເກີນ 2 ຕຳແໜ່ງ", retryable: false }, { status: 400 });
  const { id } = await params;
  try {
    const result = await withSerializableTransaction(tx => runIdempotentOperation(tx, {
      key: request.headers.get("Idempotency-Key"), userId: session.userId, scope: "product.update", payload: { id, ...parsed.data },
    }, async () => {
      const before = await tx.finishedProduct.findUnique({ where: { id } });
      if (!before) throw new Error("PRODUCT_NOT_FOUND");
      const product = await tx.finishedProduct.update({ where: { id }, data: parsed.data });
      const view = (value: typeof product) => ({ id: value.id, code: value.code, name: value.name, sizeDescription: value.sizeDescription, retailPrice: Number(value.retailPrice), shelfLifeDays: value.shelfLifeDays, isActive: value.isActive });
      await writeAuditLog({ userId: session.userId, action: "update", entityType: "finished_product", entityId: id, summary: `ແກ້ໄຂສິນຄ້າ ${product.name}`, metadata: { before: view(before), after: view(product) } }, tx);
      return { product: view(product) };
    }));
    return NextResponse.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "PRODUCT_NOT_FOUND") return NextResponse.json({ error: "ບໍ່ພົບສິນຄ້າ", retryable: false }, { status: 404 });
    if (code === "IDEMPOTENCY_KEY_REQUIRED" || code === "INVALID_IDEMPOTENCY_KEY") return NextResponse.json({ error: "ລະຫັດລາຍການບໍ່ຖືກຕ້ອງ", retryable: false }, { status: 400 });
    if (code === "IDEMPOTENCY_CONFLICT" || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) return NextResponse.json({ error: "ລະຫັດສິນຄ້າ ຫຼືລາຍການນີ້ມີແລ້ວ", retryable: false }, { status: 409 });
    logError("product.update_failed", { error });
    return NextResponse.json({ error: "ບັນທຶກບໍ່ສຳເລັດ; ກະລຸນາລອງລາຍການເດີມອີກຄັ້ງ", retryable: true }, { status: 503 });
  }
}
