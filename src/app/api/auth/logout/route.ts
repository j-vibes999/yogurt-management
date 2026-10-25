import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSessionSecret, SESSION_COOKIE, verifySession } from "@/lib/auth-session";
import { prisma } from "@/lib/prisma";
import { logWarn } from "@/lib/logger";

export async function POST() {
  const secret = getSessionSecret();
  const payload = secret ? await verifySession((await cookies()).get(SESSION_COOKIE)?.value, secret) : null;
  if (payload) {
    // Deleting the row revokes this cookie even if someone kept a copy of it.
    try { await prisma.userSession.deleteMany({ where: { id: payload.sid, userId: payload.userId } }); }
    catch (error) { logWarn("auth.logout_revoke_failed", { error }); }
  }
  // A relative Location keeps the visitor on the host they used (public domain or 127.0.0.1).
  const response = new NextResponse(null, { status: 303, headers: { Location: "/login", "Cache-Control": "no-store" } });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  return response;
}
