import { cookies } from "next/headers";
import { getSessionSecret, SESSION_COOKIE, verifySession, verifySessionCredentials } from "@/lib/auth-session";
import { prisma } from "@/lib/prisma";

export async function getCurrentSession() {
  const secret = getSessionSecret();
  if (!secret) return null;
  const cookieStore = await cookies();
  const payload = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, secret);
  if (!payload) return null;
  try {
    const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { id:true,email:true,fullName:true,role:true,isActive:true,passwordHash:true } });
    if (!user?.isActive || !(await verifySessionCredentials(payload, user.passwordHash, secret))) return null;
    return { ...payload, email:user.email, fullName:user.fullName, role:user.role };
  } catch {
    return null;
  }
}
