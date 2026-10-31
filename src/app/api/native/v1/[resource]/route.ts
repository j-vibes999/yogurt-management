import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/server-session";
import { isNativeResource, nativeResourceRoles, parseNativeQuery } from "@/lib/native-access";
import { loadNativeData, NativeReadError } from "@/lib/native-data";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request, context: { params: Promise<{ resource: string }> }) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າລະບົບກ່ອນ" }, { status: 401, headers });
    const { resource } = await context.params;
    if (!isNativeResource(resource)) return NextResponse.json({ error: "ບໍ່ພົບໜ້າຂໍ້ມູນ" }, { status: 404, headers });
    if (!nativeResourceRoles[resource].includes(session.role)) return NextResponse.json({ error: "ບໍ່ມີສິດເບິ່ງຂໍ້ມູນນີ້" }, { status: 403, headers });
    const query = parseNativeQuery(resource, new URL(request.url).searchParams);
    if (!query) return NextResponse.json({ error: "ຕົວກອງຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400, headers });
    const { source, data } = await loadNativeData(resource, query, session.role);
    return NextResponse.json({ version: 1, resource, source, generatedAt: new Date().toISOString(), data }, { headers });
  } catch (error) {
    if (error instanceof NativeReadError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    // Do not log connection/credential-bearing database error messages.
    logError("native.read_failed", { errorType: error instanceof Error ? error.name : "Unknown" });
    return NextResponse.json({ error: "ໂຫຼດຂໍ້ມູນບໍ່ສຳເລັດ. ກະລຸນາລອງໃໝ່", retryable: true }, { status: 503, headers });
  }
}
