import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/server-session";
import { MAX_RECEIPT_BYTES, storeReceipt, validReceiptContent } from "@/lib/receipt-storage";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າລະບົບກ່ອນ" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "ບໍ່ມີສິດເຮັດລາຍການນີ້" }, { status: 403 });
  let file: FormDataEntryValue | null;
  let bytes: Buffer;
  try {
    file = (await request.formData()).get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "ກະລຸນາແນບໄຟລ໌ໃບເສັດ ຫຼືຫຼັກຖານ" }, { status: 400 });
    if (file.size === 0 || file.size > MAX_RECEIPT_BYTES) return NextResponse.json({ error: "ໄຟລ໌ໃບເສັດຕ້ອງມີຂໍ້ມູນ ແລະບໍ່ເກີນ 5 MB" }, { status: 400 });
    bytes = Buffer.from(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນໄຟລ໌ໃບເສັດບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }
  if (!validReceiptContent(bytes, file.type)) return NextResponse.json({ error: "ຮອງຮັບສະເພາະໄຟລ໌ JPG, PNG, WEBP ຫຼື PDF ທີ່ຖືກຕ້ອງ" }, { status: 400 });
  try {
    const receipt = await storeReceipt(bytes, file.type);
    return NextResponse.json({ url: receipt.url }, { status: 201 });
  } catch (error) {
    console.error("Unable to store receipt", error);
    return NextResponse.json({ error: "ບໍ່ສາມາດບັນທຶກໄຟລ໌ໃບເສັດໄດ້" }, { status: 500 });
  }
}
