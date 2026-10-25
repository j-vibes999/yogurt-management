ALTER TABLE "raw_materials" ALTER COLUMN "current_stock" TYPE DECIMAL(14,6);
ALTER TABLE "purchase_order_items" ALTER COLUMN "quantity" TYPE DECIMAL(14,6);
ALTER TABLE "raw_material_adjustments" ALTER COLUMN "quantity_delta" TYPE DECIMAL(14,6);
