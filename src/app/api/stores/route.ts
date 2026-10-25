import { businessDateOnly, parseDateOnly } from "@/lib/date-only";
import { NextResponse } from "next/server";
import { withSerializableTransaction } from "@/lib/transaction";
import { runIdempotentOperation } from "@/lib/idempotency";
import { moneyDecimalString, parseCommissionRate, parseMoneyCents, parseWholeCount } from "@/lib/money";
import { logError } from "@/lib/logger";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { getCurrentSession } from "@/lib/server-session";

const storeSchema = z.object({
  name: z.string().trim().min(1).max(160),
  assetCode: z.string().trim().min(1).max(80),
  contactName: z.string().trim().max(160).optional().nullable(),
  phone: z.string().trim().max(80).optional().nullable(),
  whatsapp: z.string().trim().max(80).optional().nullable(),
  facebook: z.string().trim().max(240).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
  latitude: z.union([z.number(), z.string()]).optional().nullable(),
  longitude: z.union([z.number(), z.string()]).optional().nullable(),
  fridgeStartDate: z.string().optional().nullable(),
  monthlyElectricity: z.union([z.number(), z.string()]).optional().nullable(),
  commissionRate: z.union([z.number(), z.string()]).optional().nullable(),
  fridgeModel: z.string().trim().max(160).optional().nullable(),
  serialNo: z.string().trim().max(160).optional().nullable(),
  capacityCups: z.union([z.number(), z.string()]).optional().nullable(),
});

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "ຖານຂໍ້ມູນຍັງບໍ່ໄດ້ຕັ້ງຄ່າ" }, { status: 503 });
  try {
    const session = await getCurrentSession();
    if (!session || session.role !== "admin") return NextResponse.json({ error: "ບໍ່ມີສິດເຮັດລາຍການນີ້" }, { status: 403 });
    const parsed = storeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "ຂໍ້ມູນຮ້ານບໍ່ຖືກຕ້ອງ", retryable: false }, { status: 400 });
    const body = parsed.data;
    const name = body.name;
    const assetCode = body.assetCode;
    const latitude = body.latitude === "" || body.latitude == null ? null : Number(body.latitude);
    const longitude = body.longitude === "" || body.longitude == null ? null : Number(body.longitude);
    if ((latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) || (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))) return NextResponse.json({ error: "ຄ່າເສັ້ນຂະໜານ ຫຼືເສັ້ນແວງບໍ່ຖືກຕ້ອງ" , retryable: false }, { status: 400 });
    const fridgeStartDate = body.fridgeStartDate ? parseDateOnly(body.fridgeStartDate) : businessDateOnly();
    if (!fridgeStartDate) return NextResponse.json({ error: "ວັນທີເລີ່ມໃຊ້ຕູ້ແຊ່ບໍ່ຖືກຕ້ອງ" , retryable: false }, { status: 400 });
    const monthlyCents = parseMoneyCents(body.monthlyElectricity ?? 200000);
    const capacityCups = parseWholeCount(body.capacityCups ?? 100);
    const commissionRate = parseCommissionRate(body.commissionRate ?? "0.30");
    if (monthlyCents === null || capacityCups === null || capacityCups < 1 || capacityCups > 10000 || commissionRate === null) return NextResponse.json({ error: "ຄ່າໄຟຕ້ອງມີບໍ່ເກີນ 2 ຕຳແໜ່ງ, ອັດຕາສ່ວນແບ່ງມີບໍ່ເກີນ 4 ຕຳແໜ່ງ ແລະຄວາມຈຸຕູ້ຕ້ອງເປັນຈຳນວນເຕັມ", retryable: false }, { status: 400 });
    const monthlyElectricity = moneyDecimalString(monthlyCents);
    const result = await withSerializableTransaction((tx) => runIdempotentOperation(tx, {
      key: request.headers.get("idempotency-key"), userId: session.userId, scope: "store.create", payload: { ...body, monthlyElectricity, capacityCups, commissionRate },
    }, async () => {
      const products = await tx.finishedProduct.findMany({ where: { isActive: true }, select: { id: true } });
      const store = await tx.store.create({ data: {
        name,
        contactName: String(body.contactName ?? "").trim() || null,
        phone: String(body.phone ?? "").trim() || null,
        whatsapp: body.whatsapp?.trim() || body.phone?.trim() || null,
        facebook: String(body.facebook ?? "").trim() || null,
        address: String(body.address ?? "").trim() || null,
        latitude, longitude,
        fridgeStartDate,
        commissionRate,
        monthlyElectricity,
        isActive: true,
      }});
      const fridge = await tx.fridge.create({ data: {
        assetCode,
        model: String(body.fridgeModel ?? "Yogurt Display 100").trim() || "Yogurt Display 100",
        serialNo: String(body.serialNo ?? "").trim() || null,
        capacityCups,
        currentStoreId: store.id,
        status: "active",
      }});
      for (const product of products) await tx.fridgeInventory.create({ data: { storeId: store.id, fridgeId: fridge.id, finishedProductId: product.id, currentStock: 0 } });
      await writeAuditLog({ userId: session.userId, action: "create", entityType: "store", entityId: store.id, storeId: store.id, summary: `ເພີ່ມຮ້ານ ${store.name}`, metadata: { after: { name: store.name, commissionRate, monthlyElectricity, fridgeStartDate: fridgeStartDate.toISOString(), fridge: fridge.assetCode, capacityCups } } }, tx);
      return { id: store.id, name: store.name, fridge: fridge.assetCode };
    }));
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    const unique = (error as { code?: string })?.code === "P2002";
    const messages: Record<string, string> = { IDEMPOTENCY_KEY_REQUIRED: "Store request key is required", INVALID_IDEMPOTENCY_KEY: "Invalid store request key", IDEMPOTENCY_CONFLICT: "This request key was used for a different store" };
    if (!unique && !messages[code]) logError("stores.create_failed", { error });
    return NextResponse.json({ error: unique ? "Fridge asset code or serial number is already in use" : messages[code] ?? "Unable to create store", retryable: !unique && !messages[code] }, { status: unique || code === "IDEMPOTENCY_CONFLICT" ? 409 : messages[code] ? 400 : 500 });
  }
}
