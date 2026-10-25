import { parseDateOnly } from "@/lib/date-only";
import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { getCurrentSession } from "@/lib/server-session";
import { withSerializableTransaction } from "@/lib/transaction";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { moneyDecimalString, parseCommissionRate, parseMoneyCents } from "@/lib/money";
import { logError } from "@/lib/logger";

const editSchema = z.object({
  name: z.string().trim().min(1).max(160),
  contactName: z.string().trim().max(160).optional().nullable(),
  phone: z.string().trim().max(80).optional().nullable(),
  whatsapp: z.string().trim().max(80).optional().nullable(),
  facebook: z.string().trim().max(240).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
  latitude: z.union([z.number(), z.string()]).optional().nullable(),
  longitude: z.union([z.number(), z.string()]).optional().nullable(),
  fridgeStartDate: z.string().optional().nullable(),
  monthlyElectricity: z.unknown().refine(value => parseMoneyCents(value) !== null).optional(),
  commissionRate: z.unknown().refine(value => parseCommissionRate(value) !== null).optional(),
  isActive: z.boolean().optional(),
});

async function ensureStoreCanDeactivate(tx: Prisma.TransactionClient, id: string) {
  const store = await tx.store.findUnique({
    where: { id },
    include: {
      refillRequests: { where: { status: { notIn: ["completed", "cancelled"] } }, take: 1 },
      settlements: { orderBy: [{ settlementDate: "desc" }, { id: "desc" }], take: 1 },
    },
  });
  if (!store) throw new Error("STORE_NOT_FOUND");
  if (store.refillRequests.length) throw new Error("STORE_HAS_PENDING_REFILLS");
  if (Number(store.settlements[0]?.closingBalance ?? 0) > 0) throw new Error("STORE_HAS_BALANCE");
  return store;
}

function storeError(error: unknown) {
  const code = (error as { code?: string })?.code === "P2025" ? "STORE_NOT_FOUND" : error instanceof Error ? error.message : "UNKNOWN";
  const messages: Record<string, string> = {
    STORE_NOT_FOUND: "ບໍ່ພົບຮ້ານ",
    STORE_HAS_PENDING_REFILLS: "ກະລຸນາສົ່ງໃຫ້ສຳເລັດ ຫຼືຍົກເລີກຄຳຂໍເຕີມສິນຄ້າທີ່ຍັງຄ້າງກ່ອນປິດຮ້ານ",
    STORE_HAS_BALANCE: "ຮ້ານຍັງມີຍອດຄ້າງ. ກະລຸນາຮັບເງິນກ່ອນປິດຮ້ານ",
  };
  return code in messages ? NextResponse.json({ error: messages[code], retryable: false }, { status: code === "STORE_NOT_FOUND" ? 404 : 409 }) : null;
}

function optionalNumber(value: unknown) {
  if ((typeof value === "string" && !value.trim()) || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.NaN;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "ຖານຂໍ້ມູນຍັງບໍ່ໄດ້ຕັ້ງຄ່າ" }, { status: 503 });
  try {
    const session = await getCurrentSession();
    if (!session || session.role !== "admin") return NextResponse.json({ error: "ບໍ່ມີສິດເຮັດລາຍການນີ້" }, { status: 403 });
    const { id } = await params;
    const parsed = editSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "ຂໍ້ມູນຮ້ານບໍ່ຖືກຕ້ອງ · ຄ່າໄຟມີບໍ່ເກີນ 2 ຕຳແໜ່ງ ແລະອັດຕາສ່ວນແບ່ງມີບໍ່ເກີນ 4 ຕຳແໜ່ງ", retryable: false }, { status: 400 });
    const body = parsed.data;
    const latitude = optionalNumber(body.latitude);
    const longitude = optionalNumber(body.longitude);
    const commissionRate = body.commissionRate === undefined ? undefined : parseCommissionRate(body.commissionRate)!;
    const monthlyElectricity = body.monthlyElectricity === undefined ? undefined : moneyDecimalString(parseMoneyCents(body.monthlyElectricity)!);
    if (Number.isNaN(latitude) || Number.isNaN(longitude) || (latitude !== null && (latitude < -90 || latitude > 90)) || (longitude !== null && (longitude < -180 || longitude > 180))) return NextResponse.json({ error: "ຄ່າເສັ້ນຂະໜານ ຫຼືເສັ້ນແວງບໍ່ຖືກຕ້ອງ", retryable: false }, { status: 400 });
    if (body.fridgeStartDate && !parseDateOnly(body.fridgeStartDate)) return NextResponse.json({ error: "ວັນທີເລີ່ມໃຊ້ຕູ້ແຊ່ບໍ່ຖືກຕ້ອງ", retryable: false }, { status: 400 });

    const store = await withSerializableTransaction(async (tx) => {
      const before = body.isActive === false ? await ensureStoreCanDeactivate(tx, id) : await tx.store.findUnique({ where: { id } });
      if (!before) throw new Error("STORE_NOT_FOUND");
      const updated = await tx.store.update({
        where: { id },
        data: {
          name: body.name,
          ...(body.contactName === undefined ? {} : { contactName: body.contactName || null }),
          ...(body.phone === undefined ? {} : { phone: body.phone || null }),
          ...(body.whatsapp === undefined ? {} : { whatsapp: body.whatsapp || body.phone || null }),
          ...(body.facebook === undefined ? {} : { facebook: body.facebook || null }),
          ...(body.address === undefined ? {} : { address: body.address || null }),
          ...(body.latitude === undefined ? {} : { latitude }),
          ...(body.longitude === undefined ? {} : { longitude }),
          ...(body.fridgeStartDate === undefined ? {} : { fridgeStartDate: body.fridgeStartDate ? parseDateOnly(body.fridgeStartDate) : null }),
          ...(commissionRate === undefined ? {} : { commissionRate }),
          ...(monthlyElectricity === undefined ? {} : { monthlyElectricity }),
          ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
        },
      });
      const fields = (row: typeof before) => ({ name: row.name, commissionRate: String(row.commissionRate), monthlyElectricity: String(row.monthlyElectricity), isActive: row.isActive });
      await writeAuditLog({ userId: session.userId, action: "update", entityType: "store", entityId: updated.id, storeId: updated.id, summary: `ແກ້ໄຂຮ້ານ ${updated.name}`, metadata: { before: fields(before), after: fields(updated) } }, tx);
      return updated;
    });
    return NextResponse.json({ id: store.id, name: store.name, isActive: store.isActive });
  } catch (error) {
    const known = storeError(error); if (known) return known;
    logError("stores.update_failed", { error });
    return NextResponse.json({ error: "ບໍ່ສາມາດແກ້ໄຂຮ້ານໄດ້", retryable: true }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "ຖານຂໍ້ມູນຍັງບໍ່ໄດ້ຕັ້ງຄ່າ" }, { status: 503 });
  try {
    const session = await getCurrentSession();
    if (!session || session.role !== "admin") return NextResponse.json({ error: "ບໍ່ມີສິດເຮັດລາຍການນີ້" }, { status: 403 });
    const { id } = await params;
    await withSerializableTransaction(async (tx) => {
      const store = await ensureStoreCanDeactivate(tx, id);
      await tx.store.update({ where: { id }, data: { isActive: false } });
      await writeAuditLog({ userId: session.userId, action: "deactivate", entityType: "store", entityId: id, storeId: id, summary: `ປິດຮ້ານ ${store.name}` }, tx);
    });
    return NextResponse.json({ id, isActive: false });
  } catch (error) {
    const known = storeError(error); if (known) return known;
    logError("stores.deactivate_failed", { error });
    return NextResponse.json({ error: "ບໍ່ສາມາດປິດໃຊ້ຮ້ານໄດ້", retryable: true }, { status: 500 });
  }
}
