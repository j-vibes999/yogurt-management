import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createCredentialTag, getSessionSecret, SESSION_COOKIE, signSession } from "@/lib/auth-session";
import { verifyPassword } from "@/lib/password";
import { checkLoginRateLimit, loginIpRateKey, loginRateKey, recordLoginFailure, recordLoginSuccess } from "@/lib/login-rate-limit";
import { logInfo, logWarn } from "@/lib/logger";
import { emailSchema } from "@/lib/user-input";

const inputSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
});

export async function POST(request: Request) {
  const secret = getSessionSecret();
  if (!secret) return NextResponse.json({ error: "ການຕັ້ງຄ່າຄວາມປອດໄພຂອງລະບົບຍັງບໍ່ສົມບູນ" }, { status: 503 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const accountKey = loginRateKey(ip, parsed.success ? parsed.data.email : undefined);
  const ipKey = loginIpRateKey(ip);
  const accountLimit = checkLoginRateLimit(accountKey);
  const ipLimit = checkLoginRateLimit(ipKey);
  if (!accountLimit.allowed || !ipLimit.allowed) {
    const retryAfter = Math.max(accountLimit.retryAfter, ipLimit.retryAfter);
    logWarn("auth.login_rate_limited");
    return NextResponse.json({ error: "ລອງເຂົ້າລະບົບຫຼາຍເກີນໄປ ກະລຸນາລໍຖ້າແລ້ວລອງໃໝ່" }, { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } });
  }
  const recordFailure = () => { recordLoginFailure(accountKey); recordLoginFailure(ipKey); };
  if (!parsed.success) { recordFailure(); return NextResponse.json({ error: "ອີເມວ ຫຼືລະຫັດຜ່ານບໍ່ຖືກຕ້ອງ" }, { status: 400, headers: { "Cache-Control": "no-store" } }); }
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !user.isActive || !(await verifyPassword(parsed.data.password, user.passwordHash))) { recordFailure(); return NextResponse.json({ error: "ອີເມວ ຫຼືລະຫັດຜ່ານບໍ່ຖືກຕ້ອງ" }, { status: 401, headers: { "Cache-Control": "no-store" } }); }
  recordLoginSuccess(accountKey);
  logInfo("auth.login_success", { role: user.role });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const maxAge = 60 * 60 * 12;
  const credentialTag = await createCredentialTag(user.id, user.passwordHash, secret);
  const token = await signSession({ userId: user.id, email: user.email, fullName: user.fullName, role: user.role, credentialTag, exp: Math.floor(Date.now() / 1000) + maxAge }, secret);
  const response = NextResponse.json({ ok: true, role: user.role, fullName: user.fullName }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge, priority: "high" });
  return response;
}
