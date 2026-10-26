-- AlterTable
ALTER TABLE "finished_goods_adjustments" ADD COLUMN     "cost_known" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "unit_cost" DECIMAL(14,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "restock_visit_items" ADD COLUMN     "expired_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "expired_unknown_units" INTEGER NOT NULL DEFAULT 0;

-- Integrity: write-off and returned-cup costs are never negative.
ALTER TABLE finished_goods_adjustments ADD CONSTRAINT finished_goods_adjustments_unit_cost_check CHECK (unit_cost >= 0);
ALTER TABLE restock_visit_items ADD CONSTRAINT restock_expired_cost_check
  CHECK (expired_cost >= 0 AND expired_unknown_units >= 0 AND expired_unknown_units <= count_expired_returned);
