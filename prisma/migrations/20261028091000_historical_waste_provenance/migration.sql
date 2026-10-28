-- Recover historical waste provenance without changing recorded modern costs.
-- The original migration assigned zero/known defaults to old returns. Their
-- consumed lots cannot be reconstructed safely, so record them as unknown.
-- Use immutable creation time, not a business date that may be backdated.
WITH original AS (
  SELECT MIN(started_at) AT TIME ZONE 'UTC' AS cutoff
  FROM public._prisma_migrations
  WHERE migration_name = '20261013150000_waste_cost_tracking'
    AND finished_at IS NOT NULL AND rolled_back_at IS NULL
)
UPDATE public.restock_visit_items AS item
SET expired_unknown_units = item.count_expired_returned
FROM public.restock_visits AS visit, original
WHERE item.restock_visit_id = visit.id
  AND visit.created_at < original.cutoff
  AND item.count_expired_returned > 0
  AND item.expired_cost = 0 AND item.expired_unknown_units = 0;

-- Batch costs are immutable snapshots; recover the old central write-off cost
-- only when the linked batch explicitly has known provenance, including zero.
WITH original AS (
  SELECT MIN(started_at) AT TIME ZONE 'UTC' AS cutoff
  FROM public._prisma_migrations
  WHERE migration_name = '20261013150000_waste_cost_tracking'
    AND finished_at IS NOT NULL AND rolled_back_at IS NULL
)
UPDATE public.finished_goods_adjustments AS adjustment
SET unit_cost = batch.unit_cost, cost_known = true
FROM public.production_batches AS batch, original
WHERE adjustment.production_batch_id = batch.id
  AND adjustment.created_at < original.cutoff
  AND NOT adjustment.cost_known AND adjustment.unit_cost = 0
  AND batch.cost_known;
