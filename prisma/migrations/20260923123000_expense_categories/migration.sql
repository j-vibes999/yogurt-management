CREATE TABLE "expense_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "expense_categories_name_key" ON "expense_categories"("name");

INSERT INTO "expense_categories" ("id", "name") VALUES
  ('default-electricity', 'ຄ່າໄຟ'),
  ('default-fuel', 'ຄ່ານ້ຳມັນ'),
  ('default-transport', 'ຄ່າຂົນສົ່ງ'),
  ('default-maintenance', 'ຄ່າສ້ອມແປງ'),
  ('default-rent', 'ຄ່າເຊົ່າ'),
  ('default-equipment', 'ຄ່າອຸປະກອນ'),
  ('default-other', 'ອື່ນໆ')
ON CONFLICT ("name") DO NOTHING;
