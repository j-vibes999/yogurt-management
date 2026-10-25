import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

const prisma = new PrismaClient();
const email = (process.env.ADMIN_EMAIL || "owner@yogurt.local").trim().toLowerCase();
try {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing?.passwordHash.startsWith("scrypt$")) {
    console.log(`Existing admin password preserved for ${email}.`);
  } else {
    const password = process.env.ADMIN_PASSWORD || "";
    if (Array.from(password).length < 15) throw new Error("ADMIN_PASSWORD must contain at least 15 characters for initial setup");
    const salt = randomBytes(16);
    const hash = scryptSync(password, salt, 64);
    const passwordHash = `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
    if (existing) {
      await prisma.user.update({ where: { email }, data: { passwordHash, role: "admin" } });
    } else {
      await prisma.user.create({ data: { email, passwordHash, role: "admin", fullName: "Owner" } });
    }
    console.log(`Initial admin password configured for ${email}.`);
  }
} finally {
  await prisma.$disconnect();
}
