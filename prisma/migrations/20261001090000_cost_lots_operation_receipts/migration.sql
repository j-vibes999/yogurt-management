-- AlterTable
ALTER TABLE "production_batches" ADD COLUMN     "cost_known" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "restock_visit_items" ADD COLUMN     "cost_known" BOOLEAN,
ADD COLUMN     "unknown_cost_units" INTEGER;

-- CreateTable
CREATE TABLE "operation_receipts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operation_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fridge_stock_lots" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "fridge_id" TEXT NOT NULL,
    "finished_product_id" TEXT NOT NULL,
    "production_batch_id" TEXT,
    "refill_request_id" TEXT,
    "quantity_received" INTEGER NOT NULL,
    "quantity_remaining" INTEGER NOT NULL,
    "unit_cost" DECIMAL(14,4) NOT NULL,
    "cost_known" BOOLEAN NOT NULL DEFAULT false,
    "is_legacy" BOOLEAN NOT NULL DEFAULT false,
    "exp_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fridge_stock_lots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "operation_receipts_created_at_idx" ON "operation_receipts"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "operation_receipts_user_id_scope_key_key" ON "operation_receipts"("user_id", "scope", "key");

-- CreateIndex
CREATE INDEX "fridge_stock_lots_fridge_id_finished_product_id_quantity_re_idx" ON "fridge_stock_lots"("fridge_id", "finished_product_id", "quantity_remaining");

-- CreateIndex
CREATE INDEX "fridge_stock_lots_refill_request_id_idx" ON "fridge_stock_lots"("refill_request_id");

-- AddForeignKey
ALTER TABLE "operation_receipts" ADD CONSTRAINT "operation_receipts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fridge_stock_lots" ADD CONSTRAINT "fridge_stock_lots_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fridge_stock_lots" ADD CONSTRAINT "fridge_stock_lots_fridge_id_fkey" FOREIGN KEY ("fridge_id") REFERENCES "fridges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fridge_stock_lots" ADD CONSTRAINT "fridge_stock_lots_finished_product_id_fkey" FOREIGN KEY ("finished_product_id") REFERENCES "finished_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fridge_stock_lots" ADD CONSTRAINT "fridge_stock_lots_production_batch_id_fkey" FOREIGN KEY ("production_batch_id") REFERENCES "production_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fridge_stock_lots" ADD CONSTRAINT "fridge_stock_lots_refill_request_id_fkey" FOREIGN KEY ("refill_request_id") REFERENCES "refill_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Preserve recorded historical costs; legacy zero-cost batches remain unknown.
UPDATE production_batches SET cost_known = true WHERE unit_cost > 0 OR total_material_cost > 0;
ALTER TABLE fridge_stock_lots ADD CONSTRAINT fridge_stock_lot_quantities_check
  CHECK (quantity_received > 0 AND quantity_remaining >= 0 AND quantity_remaining <= quantity_received AND unit_cost >= 0);
ALTER TABLE restock_visit_items ADD CONSTRAINT restock_cost_provenance_check
  CHECK (unknown_cost_units IS NULL OR (unknown_cost_units >= 0 AND unknown_cost_units <= units_sold AND cost_known IS NOT NULL AND cost_known = (unknown_cost_units = 0)));
