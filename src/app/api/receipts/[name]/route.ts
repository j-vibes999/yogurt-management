import { NextResponse } from "next/server";
import { Readable } from "node:stream";
import { getCurrentSession } from "@/lib/server-session";
import { openReceipt } from "@/lib/receipt-storage";

export const runtime = "nodejs";
type Context = { params: Promise<{ name: string }> };
const privateHeaders = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" };

async function download(context: Context, head: boolean) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າລະບົບກ່ອນ" }, { status: 401, headers: privateHeaders });
  if (session.role !== "admin") return NextResponse.json({ error: "ບັນຊີນີ້ບໍ່ມີສິດເບິ່ງໃບບິນ" }, { status: 403, headers: privateHeaders });
  const { name } = await context.params;
  try {
    const receipt = await openReceipt(name);
    if (!receipt) return NextResponse.json({ error: "ບໍ່ພົບໃບບິນ" }, { status: 404, headers: privateHeaders });
    const headers = { ...privateHeaders, "Content-Type": receipt.mimeType, "Content-Length": String(receipt.size), "Content-Disposition": `inline; filename="${name}"` };
    if (head) {
      await receipt.handle.close();
      return new NextResponse(null, { headers });
    }
    const stream = Readable.toWeb(receipt.handle.createReadStream()) as ReadableStream<Uint8Array>;
    return new NextResponse(stream, { headers });
  } catch (error) {
    console.error("Unable to read receipt", error);
    return NextResponse.json({ error: "ເປີດໃບບິນບໍ່ໄດ້" }, { status: 500, headers: privateHeaders });
  }
}

export function GET(_request: Request, context: Context) { return download(context, false); }
export function HEAD(_request: Request, context: Context) { return download(context, true); }
