import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentSession } from "@/lib/server-session";
import { writeAuditLog } from "@/lib/audit";
import { withSerializableTransaction } from "@/lib/transaction";
import { runIdempotentOperation } from "@/lib/idempotency";
import { createProductSchema } from "@/lib/product-input";
import { logError } from "@/lib/logger";

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "ບໍ່ມີສິດເຮັດລາຍການນີ້", retryable: false }, { status: 403 });
  const parsed = createProductSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "ຂໍ້ມູນສິນຄ້າບໍ່ຖືກຕ້ອງ; ລາຄາຕ້ອງມີທົດສະນິຍົມບໍ່ເກີນ 2 ຕຳແໜ່ງ", retryable: false }, { status: 400 });
  try {
    const result = await withSerializableTransaction(tx => runIdempotentOperation(tx, {
      key: request.headers.get("Idempotency-Key"), userId: session.userId, scope: "product.create", payload: parsed.data,
    }, async () => {
      const product = await tx.finishedProduct.create({ data: { ...parsed.data, sizeDescription: parsed.data.sizeDescription || null } });
      await writeAuditLog({ userId: session.userId, action: "create", entityType: "finished_product", entityId: product.id, summary: `ສ້າງສິນຄ້າ ${product.name}` }, tx);
      return { product: { id: product.id, code: product.code, name: product.name, sizeDescription: product.sizeDescription, retailPrice: Number(product.retailPrice), shelfLifeDays: product.shelfLifeDays, isActive: product.isActive } };
    }));
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "IDEMPOTENCY_KEY_REQUIRED" || code === "INVALID_IDEMPOTENCY_KEY") return NextResponse.json({ error: "ລະຫັດລາຍການບໍ່ຖືກຕ້ອງ", retryable: false }, { status: 400 });
    if (code === "IDEMPOTENCY_CONFLICT" || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) return NextResponse.json({ error: "ລະຫັດສິນຄ້າ ຫຼືລາຍການນີ້ມີແລ້ວ", retryable: false }, { status: 409 });
    logError("product.create_failed", { error });
    return NextResponse.json({ error: "ບັນທຶກບໍ່ສຳເລັດ; ກະລຸນາລອງລາຍການເດີມອີກຄັ້ງ", retryable: true }, { status: 503 });
  }
}
