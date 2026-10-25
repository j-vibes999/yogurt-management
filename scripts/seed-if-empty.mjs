import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
try {
  // Migrations insert expense categories even before the first business seed.
  const operationalModels = Prisma.dmmf.datamodel.models.filter((model) => model.name !== "ExpenseCategory");
  const counts = await Promise.all(operationalModels.map((model) => {
    const delegate = prisma[model.name[0].toLowerCase() + model.name.slice(1)];
    return delegate.count();
  }));
  const defaults = new Map([
    ["default-electricity", "ຄ່າໄຟ"], ["default-fuel", "ຄ່ານ້ຳມັນ"],
    ["default-transport", "ຄ່າຂົນສົ່ງ"], ["default-maintenance", "ຄ່າສ້ອມແປງ"],
    ["default-rent", "ຄ່າເຊົ່າ"], ["default-equipment", "ຄ່າອຸປະກອນ"],
    ["default-other", "ອື່ນໆ"],
  ]);
  const categories = await prisma.expenseCategory.findMany({ select: { id: true, name: true } });
  const categoriesChanged = categories.some((row) => defaults.get(row.id) !== row.name);
  if (counts.some((count) => count > 0) || categoriesChanged) {
    console.log("Existing data detected; demo seed skipped.");
  } else {
    await import("../prisma/seed.mjs");
  }
} finally {
  await prisma.$disconnect();
}
