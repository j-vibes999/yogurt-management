import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/server-session";
import { cookies } from "next/headers";
import { getSessionSecret, SESSION_COOKIE, verifySession } from "@/lib/auth-session";
import { prisma } from "@/lib/prisma";
export async function GET() {
  const session = await getCurrentSession();
  if (session) return NextResponse.json({ userId: session.userId, fullName: session.fullName, email: session.email, role: session.role, source: "database" }, { headers: { "Cache-Control": "no-store" } });
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    const secret = getSessionSecret();
    const cookieStore = await cookies();
    const payload = secret ? await verifySession(cookieStore.get(SESSION_COOKIE)?.value, secret) : null;
    if (payload) return NextResponse.json({ userId: payload.userId, fullName: payload.fullName, email: payload.email, role: payload.role, source: "offline" }, { headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ error: "ກະລຸນາເຂົ້າລະບົບກ່ອນ" }, { status: 401, headers: { "Cache-Control": "no-store" } });
}
