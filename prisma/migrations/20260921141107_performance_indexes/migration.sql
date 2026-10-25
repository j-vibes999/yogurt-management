CREATE INDEX IF NOT EXISTS "settlements_settlement_date_idx" ON "settlements"("settlement_date");
CREATE INDEX IF NOT EXISTS "refill_requests_status_requested_at_idx" ON "refill_requests"("status", "requested_at");
CREATE INDEX IF NOT EXISTS "production_batches_status_exp_date_mfg_date_idx" ON "production_batches"("status", "exp_date", "mfg_date");
CREATE INDEX IF NOT EXISTS "stores_is_active_name_idx" ON "stores"("is_active", "name");
