// Used by "Change Password.command": sets a new password (15+ characters) for one account,
// signs out the account's earlier sessions and lifts a login lockout.
// Input comes from the environment: YOGURT_EMAIL and YOGURT_PASSWORD.
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

const email = (process.env.YOGURT_EMAIL || "").trim().toLowerCase();
const password = process.env.YOGURT_PASSWORD || "";
if (!email) { console.error("No email was given. Nothing was changed."); process.exit(2); }
if (Array.from(password).length < 15) { console.error("The password must have at least 15 characters. Nothing was changed."); process.exit(2); }

const prisma = new PrismaClient();
try {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) { console.error(`There is no account with the email ${email}. Nothing was changed.`); process.exitCode = 1; }
  else {
    const salt = randomBytes(16);
    const passwordHash = `scrypt$${salt.toString("base64url")}$${scryptSync(password, salt, 64).toString("base64url")}`;
    const [, signedOut] = await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash, failedLoginCount: 0, lockedUntil: null } }),
      prisma.userSession.deleteMany({ where: { userId: user.id } }),
      prisma.auditLog.create({ data: { userId: user.id, action: "update", entityType: "user", entityId: user.id, summary: `ປ່ຽນລະຫັດຜ່ານ ${user.email}`, metadata: { passwordReset: true, source: "Change Password.command" } } }),
    ]);
    console.log(`Password changed for ${user.email}. ${signedOut.count} earlier session(s) signed out.`);
  }
} finally {
  await prisma.$disconnect();
}
