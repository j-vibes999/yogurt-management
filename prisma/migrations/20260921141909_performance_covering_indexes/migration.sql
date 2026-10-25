DROP INDEX IF EXISTS "settlements_store_id_settlement_date_idx";
CREATE INDEX "settlements_store_id_settlement_date_idx" ON "settlements"("store_id", "settlement_date" DESC, "id" DESC) INCLUDE ("closing_balance");
CREATE INDEX IF NOT EXISTS "refill_requests_active_requested_at_idx" ON "refill_requests"("requested_at") WHERE "status" IN ('waiting','preparing','delivering');
