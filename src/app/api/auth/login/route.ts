import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { createCredentialTag, createSessionId, getSessionSecret, SESSION_COOKIE, signSession } from "@/lib/auth-session";
import { hashPassword, verifyPassword } from "@/lib/password";
import { checkLoginRateLimit, loginIpRateKey, recordLoginFailure } from "@/lib/login-rate-limit";
import { clientIp, lockoutUntil, oneAttemptAtATime, recordUnknownEmailFailure, unknownEmailLockedUntil } from "@/lib/login-security";
import { logInfo, logWarn } from "@/lib/logger";
import { emailSchema } from "@/lib/user-input";

const inputSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
});

const SESSION_SECONDS = 60 * 60 * 12;
const NO_STORE = { "Cache-Control": "no-store" };
const INVALID_LOGIN = "ອີເມວ ຫຼືລະຫັດຜ່ານບໍ່ຖືກຕ້ອງ";
const TOO_MANY_ATTEMPTS = "ລອງເຂົ້າລະບົບຫຼາຍເກີນໄປ ກະລຸນາລໍຖ້າແລ້ວລອງໃໝ່";

// Checked when the email is unknown, so the response time does not reveal which accounts exist.
let decoyHash: Promise<string> | undefined;
const getDecoyHash = () => (decoyHash ??= hashPassword(`${randomUUID()}${randomUUID()}`));

function tooManyAttempts(seconds: number) {
  return NextResponse.json({ error: TOO_MANY_ATTEMPTS }, { status: 429, headers: { ...NO_STORE, "Retry-After": String(Math.max(1, Math.ceil(seconds))) } });
}

export async function POST(request: Request) {
  const secret = getSessionSecret();
  if (!secret) return NextResponse.json({ error: "ການຕັ້ງຄ່າຄວາມປອດໄພຂອງລະບົບຍັງບໍ່ສົມບູນ" }, { status: 503 });
  const ip = clientIp(request.headers);
  const ipKey = loginIpRateKey(ip);
  const ipLimit = checkLoginRateLimit(ipKey);
  if (!ipLimit.allowed) {
    logWarn("auth.login_rate_limited", { ip });
    return tooManyAttempts(ipLimit.retryAfter);
  }
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    recordLoginFailure(ipKey);
    return NextResponse.json({ error: INVALID_LOGIN }, { status: 400, headers: NO_STORE });
  }
  const { email, password } = parsed.data;
  const userAgent = request.headers.get("user-agent")?.slice(0, 200) || null;

  return oneAttemptAtATime(email, () => attempt({ email, password, ip, ipKey, userAgent, secret }));
}

type Attempt = { email: string; password: string; ip: string; ipKey: string; userAgent: string | null; secret: string };

async function attempt({ email, password, ip, ipKey, userAgent, secret }: Attempt) {
  const now = new Date();
  const user = await prisma.user.findUnique({ where: { email } });
  // Real accounts lock in the database (so an admin password reset unlocks them); unknown emails lock the same way in memory.
  const lockedUntil = user ? user.lockedUntil : unknownEmailLockedUntil(email, now.getTime());
  if (lockedUntil && lockedUntil > now) {
    recordLoginFailure(ipKey);
    logWarn("auth.login_locked", { userId: user?.id ?? null, ip });
    return tooManyAttempts((lockedUntil.getTime() - now.getTime()) / 1000);
  }

  // Accounts without a real password (seed placeholders) are checked against the decoy too, for equal timing.
  const hasPassword = Boolean(user?.passwordHash.startsWith("scrypt$"));
  const passwordMatches = await verifyPassword(password, hasPassword ? user!.passwordHash : await getDecoyHash()) && hasPassword;
  if (!user || !user.isActive || !passwordMatches) {
    recordLoginFailure(ipKey);
    let newLock: Date | null;
    if (user) {
      const { failedLoginCount } = await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: { increment: 1 } }, select: { failedLoginCount: true } });
      newLock = lockoutUntil(failedLoginCount, now.getTime());
      if (newLock) await prisma.user.update({ where: { id: user.id }, data: { lockedUntil: newLock } });
      await writeAuditLog({
        userId: user.id, action: "login_failed", entityType: "user", entityId: user.id,
        summary: newLock ? `ເຂົ້າລະບົບບໍ່ສຳເລັດ ${failedLoginCount} ຄັ້ງ · ລັອກບັນຊີຊົ່ວຄາວ · ${ip}` : `ເຂົ້າລະບົບບໍ່ສຳເລັດ · ${ip}`,
        metadata: { ip, userAgent, failedLoginCount, lockedUntil: newLock?.toISOString() ?? null },
      });
    } else {
      newLock = recordUnknownEmailFailure(email, now.getTime());
    }
    logWarn("auth.login_failed", { userId: user?.id ?? null, ip, reason: !user ? "unknown_email" : !user.isActive ? "inactive" : "wrong_password", locked: Boolean(newLock) });
    return NextResponse.json({ error: INVALID_LOGIN }, { status: 401, headers: NO_STORE });
  }

  const sid = createSessionId();
  const expiresAt = new Date(now.getTime() + SESSION_SECONDS * 1000);
  await prisma.$transaction([
    prisma.userSession.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.userSession.create({ data: { id: sid, userId: user.id, expiresAt, ip, userAgent } }),
    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: now, failedLoginCount: 0, lockedUntil: null } }),
  ]);
  await writeAuditLog({ userId: user.id, action: "login", entityType: "user", entityId: user.id, summary: `ເຂົ້າລະບົບ · ${ip}`, metadata: { ip, userAgent } });
  logInfo("auth.login_success", { userId: user.id, role: user.role, ip });
  const credentialTag = await createCredentialTag(user.id, user.passwordHash, secret);
  const token = await signSession({ userId: user.id, sid, email: user.email, fullName: user.fullName, role: user.role, credentialTag, exp: Math.floor(expiresAt.getTime() / 1000) }, secret);
  const response = NextResponse.json({ ok: true, role: user.role, fullName: user.fullName }, { headers: NO_STORE });
  response.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_SECONDS, priority: "high" });
  return response;
}
