CREATE TABLE "finished_goods_adjustments" (
  "id" TEXT NOT NULL, "production_batch_id" TEXT NOT NULL, "finished_product_id" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL, "reason" TEXT NOT NULL, "note" TEXT, "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "finished_goods_adjustments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "finished_goods_adjustments_production_batch_id_created_at_idx" ON "finished_goods_adjustments"("production_batch_id", "created_at");
ALTER TABLE "finished_goods_adjustments" ADD CONSTRAINT "finished_goods_adjustments_production_batch_id_fkey" FOREIGN KEY ("production_batch_id") REFERENCES "production_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "finished_goods_adjustments" ADD CONSTRAINT "finished_goods_adjustments_finished_product_id_fkey" FOREIGN KEY ("finished_product_id") REFERENCES "finished_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "finished_goods_adjustments" ADD CONSTRAINT "finished_goods_adjustments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE TABLE "daily_closings" (
  "id" TEXT NOT NULL, "closing_date" TIMESTAMP(3) NOT NULL, "cash_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "bank_amount" DECIMAL(14,2) NOT NULL DEFAULT 0, "expense_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "note" TEXT, "created_by" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_closings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "daily_closings_closing_date_key" ON "daily_closings"("closing_date");
CREATE INDEX "daily_closings_closing_date_idx" ON "daily_closings"("closing_date");
ALTER TABLE "daily_closings" ADD CONSTRAINT "daily_closings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
