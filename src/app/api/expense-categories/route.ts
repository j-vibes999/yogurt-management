import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/server-session";

const categorySchema = z.object({ name: z.string().trim().min(1).max(80) });

export async function GET() {
  if (!process.env.DATABASE_URL) return NextResponse.json({ categories: [] });
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າໃຊ້" }, { status: 401 });
  const categories = await prisma.expenseCategory.findMany({ orderBy: [{ createdAt: "asc" }, { name: "asc" }] });
  return NextResponse.json({ categories: categories.map((item) => item.name) });
}

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "ຖານຂໍ້ມູນຍັງບໍ່ໄດ້ຕັ້ງຄ່າ" }, { status: 503 });
  const session = await getCurrentSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "ບໍ່ມີສິດເຮັດລາຍການນີ້" }, { status: 403 });
  const parsed = categorySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "ຊື່ປະເພດບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  const category = await prisma.expenseCategory.upsert({
    where: { name: parsed.data.name },
    update: {},
    create: { name: parsed.data.name },
  });
  return NextResponse.json({ category: category.name }, { status: 201 });
}
