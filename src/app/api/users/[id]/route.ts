import { NextResponse } from "next/server";
import { z } from "zod";
import { hashPassword, passwordMeetsLength } from "@/lib/password";
import { getCurrentSession } from "@/lib/server-session";
import { writeAuditLog } from "@/lib/audit";
import { withSerializableTransaction } from "@/lib/transaction";

const schema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  role: z.enum(["admin", "production", "driver"]).optional(),
  isActive: z.boolean().optional(),
  password: z.string().max(256).refine(passwordMeetsLength).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "ບໍ່ມີສິດເຮັດລາຍການນີ້" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "ຂໍ້ມູນຜູ້ໃຊ້ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  const { id } = await params;
  try {
    const passwordHash = parsed.data.password ? await hashPassword(parsed.data.password) : undefined;
    const result = await withSerializableTransaction(async (tx) => {
      const actor = await tx.user.findUnique({ where: { id: session.userId }, select: { role: true, isActive: true } });
      if (!actor?.isActive || actor.role !== "admin") return { error: "ບໍ່ມີສິດເຮັດລາຍການນີ້", status: 403 } as const;
      const before = await tx.user.findUnique({ where: { id } });
      if (!before) return { error: "ບໍ່ພົບຜູ້ໃຊ້", status: 404 } as const;
      const removesActiveAdmin = before.role === "admin" && before.isActive && (parsed.data.isActive === false || (parsed.data.role !== undefined && parsed.data.role !== "admin"));
      if (removesActiveAdmin && await tx.user.count({ where: { role: "admin", isActive: true } }) <= 1) {
        return { error: "ບໍ່ສາມາດປິດ ຫຼືຫຼຸດບົດບາດຜູ້ດູແລຄົນສຸດທ້າຍທີ່ຍັງໃຊ້ງານ", status: 409 } as const;
      }
      const after = await tx.user.update({ where: { id }, data: {
        ...(parsed.data.fullName === undefined ? {} : { fullName: parsed.data.fullName }),
        ...(parsed.data.role === undefined ? {} : { role: parsed.data.role }),
        ...(parsed.data.isActive === undefined ? {} : { isActive: parsed.data.isActive }),
        ...(passwordHash === undefined ? {} : { passwordHash }),
      } });
      await writeAuditLog({
        userId: session.userId, action: "update", entityType: "user", entityId: id, summary: `ແກ້ໄຂຜູ້ໃຊ້ ${after.email}`,
        metadata: { before: { fullName: before.fullName, role: before.role, isActive: before.isActive }, after: { fullName: after.fullName, role: after.role, isActive: after.isActive, passwordReset: Boolean(passwordHash) } },
      }, tx);
      return { id: after.id } as const;
    });
    return "error" in result ? NextResponse.json({ error: result.error }, { status: result.status }) : NextResponse.json({ id: result.id });
  } catch (error) {
    console.error("Unable to update user", error);
    return NextResponse.json({ error: "ບໍ່ສາມາດແກ້ໄຂຜູ້ໃຊ້ໄດ້" }, { status: 500 });
  }
}
