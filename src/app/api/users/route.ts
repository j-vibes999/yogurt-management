import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { hashPassword, MIN_PASSWORD_LENGTH, passwordMeetsLength } from "@/lib/password";
import { getCurrentSession } from "@/lib/server-session";
import { writeAuditLog } from "@/lib/audit";
import { withSerializableTransaction } from "@/lib/transaction";
import { emailSchema } from "@/lib/user-input";

const schema = z.object({
  email: emailSchema,
  fullName: z.string().trim().min(1).max(120),
  password: z.string().max(256).refine(passwordMeetsLength),
  role: z.enum(["admin", "production", "driver"]),
});

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "ບໍ່ມີສິດເຮັດລາຍການນີ້" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: `ກະລຸນາໃສ່ຊື່, ອີເມວທີ່ຖືກຕ້ອງ, ບົດບາດ ແລະລະຫັດຜ່ານຢ່າງໜ້ອຍ ${MIN_PASSWORD_LENGTH} ຕົວ` }, { status: 400 });
  try {
    const passwordHash = await hashPassword(parsed.data.password);
    const user = await withSerializableTransaction(async (tx) => {
      const actor = await tx.user.findUnique({ where: { id: session.userId }, select: { role: true, isActive: true } });
      if (!actor?.isActive || actor.role !== "admin") return null;
      const created = await tx.user.create({ data: { email: parsed.data.email, fullName: parsed.data.fullName, role: parsed.data.role, passwordHash } });
      await writeAuditLog({ userId: session.userId, action: "create_user", entityType: "user", entityId: created.id, summary: `ສ້າງຜູ້ໃຊ້ ${created.fullName} · ${created.role}` }, tx);
      return created;
    });
    if (!user) return NextResponse.json({ error: "ບໍ່ມີສິດເຮັດລາຍການນີ້" }, { status: 403 });
    return NextResponse.json({ id: user.id }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "ອີເມວນີ້ມີຢູ່ແລ້ວ" }, { status: 409 });
    console.error("Unable to create user", error);
    return NextResponse.json({ error: "ບໍ່ສາມາດສ້າງຜູ້ໃຊ້ໄດ້" }, { status: 500 });
  }
}
