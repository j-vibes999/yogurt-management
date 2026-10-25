import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";
const prisma = new PrismaClient();
const email = (process.env.ADMIN_EMAIL || "owner@yogurt.local").trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || "";
if (Array.from(password).length < 15) throw new Error("ADMIN_PASSWORD must contain at least 15 characters");
const salt = randomBytes(16);
const hash = scryptSync(password, salt, 64);
const passwordHash = `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
try {
  await prisma.user.upsert({ where: { email }, update: { passwordHash, role: "admin" }, create: { email, passwordHash, role: "admin", fullName: "Owner" } });
  console.log(`Admin password updated for ${email}`);
} finally { await prisma.$disconnect(); }
