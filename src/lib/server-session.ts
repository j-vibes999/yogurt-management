import { cookies } from "next/headers";
import { getSessionSecret, SESSION_COOKIE, verifySession, verifySessionCredentials, type UserRole } from "@/lib/auth-session";
import { prisma, readSessionDatabase } from "@/lib/prisma";

/**
 * The signed cookie alone is not enough: its session row must still exist (logout deletes it),
 * belong to an active user and match the user's current password hash.
 */
export async function getCurrentSession() {
  const secret = getSessionSecret();
  if (!secret) return null;
  const cookieStore = await cookies();
  const payload = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, secret);
  if (!payload) return null;
  try {
    const row = await readSessionDatabase(() => prisma.userSession.findUnique({
      where: { id: payload.sid },
      select: { userId: true, expiresAt: true, user: { select: { id: true, email: true, fullName: true, role: true, isActive: true, passwordHash: true } } },
    }));
    const user = row?.user;
    if (!row || !user || row.userId !== payload.userId || row.expiresAt.getTime() <= Date.now() || !user.isActive) return null;
    if (!(await verifySessionCredentials(payload, user.passwordHash, secret))) return null;
    return { ...payload, email: user.email, fullName: user.fullName, role: user.role };
  } catch {
    return null;
  }
}

/**
 * Role used to decide what a page shows. Middleware has already rejected revoked sessions,
 * so a missing database session here means PostgreSQL is unreachable (read-only demo mode).
 */
export async function getViewerRole(): Promise<UserRole | null> {
  const session = await getCurrentSession();
  if (session) return session.role;
  const secret = getSessionSecret();
  if (!secret) return null;
  try {
    await prisma.$queryRaw`SELECT 1`;
    return null; // The database answers, so the session really is gone.
  } catch {
    const payload = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, secret);
    return payload?.role ?? null;
  }
}
