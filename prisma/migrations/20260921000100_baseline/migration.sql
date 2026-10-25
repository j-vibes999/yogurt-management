-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'production', 'driver');

-- CreateEnum
CREATE TYPE "RawMaterialCategory" AS ENUM ('ingredient', 'packaging');

-- CreateEnum
CREATE TYPE "ProductionBatchStatus" AS ENUM ('completed', 'cancelled');

-- CreateEnum
CREATE TYPE "FridgeStatus" AS ENUM ('active', 'maintenance');

-- CreateEnum
CREATE TYPE "RestockVisitStatus" AS ENUM ('draft', 'completed');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'partial', 'paid');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('cash', 'bank', 'mixed');

-- CreateEnum
CREATE TYPE "RefillRequestStatus" AS ENUM ('waiting', 'preparing', 'delivering', 'completed', 'cancelled');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "full_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_materials" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "RawMaterialCategory" NOT NULL,
    "unit" TEXT NOT NULL,
    "min_stock_alert" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "current_stock" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "avg_cost_per_unit" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "supplier_name" TEXT NOT NULL,
    "purchase_date" TIMESTAMP(3) NOT NULL,
    "total_cost" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "raw_material_id" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit_price" DECIMAL(14,4) NOT NULL,
    "total_price" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finished_products" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "size_description" TEXT,
    "retail_price" DECIMAL(12,2) NOT NULL,
    "shelf_life_days" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "finished_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_material_adjustments" (
    "id" TEXT NOT NULL,
    "raw_material_id" TEXT NOT NULL,
    "quantity_delta" DECIMAL(14,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_material_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" TEXT NOT NULL,
    "finished_product_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "base_cups" INTEGER NOT NULL DEFAULT 100,
    "is_default" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_items" (
    "id" TEXT NOT NULL,
    "recipe_id" TEXT NOT NULL,
    "raw_material_id" TEXT NOT NULL,
    "quantity_required" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "recipe_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_batches" (
    "id" TEXT NOT NULL,
    "batch_number" TEXT NOT NULL,
    "recipe_id" TEXT NOT NULL,
    "finished_product_id" TEXT NOT NULL,
    "quantity_produced" INTEGER NOT NULL,
    "quantity_remaining" INTEGER NOT NULL,
    "total_material_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "mfg_date" TIMESTAMP(3) NOT NULL,
    "exp_date" TIMESTAMP(3) NOT NULL,
    "status" "ProductionBatchStatus" NOT NULL DEFAULT 'completed',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "facebook" TEXT,
    "address" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "fridge_start_date" TIMESTAMP(3),
    "commission_rate" DECIMAL(5,4) NOT NULL DEFAULT 0.30,
    "monthly_electricity" DECIMAL(14,2) NOT NULL DEFAULT 200000,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fridges" (
    "id" TEXT NOT NULL,
    "asset_code" TEXT NOT NULL,
    "model" TEXT,
    "serial_no" TEXT,
    "capacity_cups" INTEGER NOT NULL DEFAULT 100,
    "current_store_id" TEXT,
    "status" "FridgeStatus" NOT NULL DEFAULT 'active',

    CONSTRAINT "fridges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fridge_inventory" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "fridge_id" TEXT NOT NULL,
    "finished_product_id" TEXT NOT NULL,
    "current_stock" INTEGER NOT NULL DEFAULT 0,
    "last_audit_date" TIMESTAMP(3),

    CONSTRAINT "fridge_inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restock_visits" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "fridge_id" TEXT NOT NULL,
    "visit_date" TIMESTAMP(3) NOT NULL,
    "driver_user_id" TEXT,
    "status" "RestockVisitStatus" NOT NULL DEFAULT 'draft',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restock_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restock_visit_items" (
    "id" TEXT NOT NULL,
    "restock_visit_id" TEXT NOT NULL,
    "finished_product_id" TEXT NOT NULL,
    "previous_stock" INTEGER NOT NULL,
    "count_remaining" INTEGER NOT NULL,
    "count_expired_returned" INTEGER NOT NULL DEFAULT 0,
    "count_refilled" INTEGER NOT NULL DEFAULT 0,
    "units_sold" INTEGER NOT NULL,
    "retail_price" DECIMAL(12,2) NOT NULL,
    "subtotal_gross" DECIMAL(14,2) NOT NULL,
    "unit_cost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "subtotal_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "restock_visit_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" TEXT NOT NULL,
    "restock_visit_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "store_commission_amount" DECIMAL(14,2) NOT NULL,
    "net_payable_amount" DECIMAL(14,2) NOT NULL,
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "payment_method" "PaymentMethod",
    "previous_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "closing_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "receipt_number" TEXT,
    "slip_image_url" TEXT,
    "settlement_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refill_requests" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "status" "RefillRequestStatus" NOT NULL DEFAULT 'waiting',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refill_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refill_request_items" (
    "id" TEXT NOT NULL,
    "refill_request_id" TEXT NOT NULL,
    "finished_product_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "refill_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "store_id" TEXT,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "incurred_at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "voided_at" TIMESTAMP(3),
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "raw_materials_code_key" ON "raw_materials"("code");

-- CreateIndex
CREATE INDEX "purchase_orders_purchase_date_idx" ON "purchase_orders"("purchase_date");

-- CreateIndex
CREATE INDEX "purchase_order_items_purchase_order_id_idx" ON "purchase_order_items"("purchase_order_id");

-- CreateIndex
CREATE INDEX "purchase_order_items_raw_material_id_idx" ON "purchase_order_items"("raw_material_id");

-- CreateIndex
CREATE UNIQUE INDEX "finished_products_code_key" ON "finished_products"("code");

-- CreateIndex
CREATE INDEX "raw_material_adjustments_raw_material_id_created_at_idx" ON "raw_material_adjustments"("raw_material_id", "created_at");

-- CreateIndex
CREATE INDEX "recipes_finished_product_id_is_default_idx" ON "recipes"("finished_product_id", "is_default");

-- CreateIndex
CREATE UNIQUE INDEX "recipes_finished_product_id_version_key" ON "recipes"("finished_product_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_items_recipe_id_raw_material_id_key" ON "recipe_items"("recipe_id", "raw_material_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_batches_batch_number_key" ON "production_batches"("batch_number");

-- CreateIndex
CREATE INDEX "production_batches_exp_date_idx" ON "production_batches"("exp_date");

-- CreateIndex
CREATE UNIQUE INDEX "fridges_asset_code_key" ON "fridges"("asset_code");

-- CreateIndex
CREATE UNIQUE INDEX "fridges_serial_no_key" ON "fridges"("serial_no");

-- CreateIndex
CREATE UNIQUE INDEX "fridges_current_store_id_key" ON "fridges"("current_store_id");

-- CreateIndex
CREATE INDEX "fridges_current_store_id_idx" ON "fridges"("current_store_id");

-- CreateIndex
CREATE INDEX "fridge_inventory_store_id_idx" ON "fridge_inventory"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "fridge_inventory_fridge_id_finished_product_id_key" ON "fridge_inventory"("fridge_id", "finished_product_id");

-- CreateIndex
CREATE INDEX "restock_visits_store_id_visit_date_idx" ON "restock_visits"("store_id", "visit_date");

-- CreateIndex
CREATE INDEX "restock_visits_driver_user_id_visit_date_idx" ON "restock_visits"("driver_user_id", "visit_date");

-- CreateIndex
CREATE UNIQUE INDEX "restock_visit_items_restock_visit_id_finished_product_id_key" ON "restock_visit_items"("restock_visit_id", "finished_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_restock_visit_id_key" ON "settlements"("restock_visit_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_receipt_number_key" ON "settlements"("receipt_number");

-- CreateIndex
CREATE INDEX "settlements_store_id_payment_status_idx" ON "settlements"("store_id", "payment_status");

-- CreateIndex
CREATE INDEX "refill_requests_store_id_status_idx" ON "refill_requests"("store_id", "status");

-- CreateIndex
CREATE INDEX "refill_requests_requested_at_idx" ON "refill_requests"("requested_at");

-- CreateIndex
CREATE UNIQUE INDEX "refill_request_items_refill_request_id_finished_product_id_key" ON "refill_request_items"("refill_request_id", "finished_product_id");

-- CreateIndex
CREATE INDEX "expenses_incurred_at_idx" ON "expenses"("incurred_at");

-- CreateIndex
CREATE INDEX "expenses_store_id_incurred_at_idx" ON "expenses"("store_id", "incurred_at");

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_raw_material_id_fkey" FOREIGN KEY ("raw_material_id") REFERENCES "raw_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_material_adjustments" ADD CONSTRAINT "raw_material_adjustments_raw_material_id_fkey" FOREIGN KEY ("raw_material_id") REFERENCES "raw_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_finished_product_id_fkey" FOREIGN KEY ("finished_product_id") REFERENCES "finished_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_raw_material_id_fkey" FOREIGN KEY ("raw_material_id") REFERENCES "raw_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_finished_product_id_fkey" FOREIGN KEY ("finished_product_id") REFERENCES "finished_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fridges" ADD CONSTRAINT "fridges_current_store_id_fkey" FOREIGN KEY ("current_store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fridge_inventory" ADD CONSTRAINT "fridge_inventory_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fridge_inventory" ADD CONSTRAINT "fridge_inventory_fridge_id_fkey" FOREIGN KEY ("fridge_id") REFERENCES "fridges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fridge_inventory" ADD CONSTRAINT "fridge_inventory_finished_product_id_fkey" FOREIGN KEY ("finished_product_id") REFERENCES "finished_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restock_visits" ADD CONSTRAINT "restock_visits_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restock_visits" ADD CONSTRAINT "restock_visits_fridge_id_fkey" FOREIGN KEY ("fridge_id") REFERENCES "fridges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restock_visits" ADD CONSTRAINT "restock_visits_driver_user_id_fkey" FOREIGN KEY ("driver_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restock_visit_items" ADD CONSTRAINT "restock_visit_items_restock_visit_id_fkey" FOREIGN KEY ("restock_visit_id") REFERENCES "restock_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restock_visit_items" ADD CONSTRAINT "restock_visit_items_finished_product_id_fkey" FOREIGN KEY ("finished_product_id") REFERENCES "finished_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_restock_visit_id_fkey" FOREIGN KEY ("restock_visit_id") REFERENCES "restock_visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refill_requests" ADD CONSTRAINT "refill_requests_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refill_request_items" ADD CONSTRAINT "refill_request_items_refill_request_id_fkey" FOREIGN KEY ("refill_request_id") REFERENCES "refill_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refill_request_items" ADD CONSTRAINT "refill_request_items_finished_product_id_fkey" FOREIGN KEY ("finished_product_id") REFERENCES "finished_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

