ALTER TABLE "raw_materials"
  ADD CONSTRAINT "raw_materials_nonnegative_stock_cost_ck" CHECK ("current_stock" >= 0 AND "avg_cost_per_unit" >= 0 AND "min_stock_alert" >= 0);

ALTER TABLE "production_batches"
  ADD CONSTRAINT "production_batches_quantity_cost_ck" CHECK (
    "quantity_produced" > 0 AND
    "quantity_remaining" >= 0 AND
    "quantity_remaining" <= "quantity_produced" AND
    "total_material_cost" >= 0 AND
    "unit_cost" >= 0 AND
    "exp_date" >= "mfg_date"
  );

ALTER TABLE "fridge_inventory"
  ADD CONSTRAINT "fridge_inventory_nonnegative_stock_ck" CHECK ("current_stock" >= 0);

ALTER TABLE "purchase_order_items"
  ADD CONSTRAINT "purchase_order_items_positive_ck" CHECK ("quantity" > 0 AND "unit_price" >= 0 AND "total_price" >= 0);

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_nonnegative_total_ck" CHECK ("total_cost" >= 0);

ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_nonnegative_amounts_ck" CHECK (
    "gross_amount" >= 0 AND
    "store_commission_amount" >= 0 AND
    "net_payable_amount" >= 0 AND
    "previous_balance" >= 0 AND
    "paid_amount" >= 0 AND
    "closing_balance" >= 0 AND
    "store_commission_amount" <= "gross_amount" AND
    "net_payable_amount" <= "gross_amount"
  );
