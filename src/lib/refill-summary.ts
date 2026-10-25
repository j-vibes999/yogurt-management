import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Count completed deliveries since each SKU's last audit in SQL. */
export async function refilledSinceAudit(storeId: string, client: Pick<Prisma.TransactionClient, "$queryRaw"> = prisma): Promise<Map<string, number>> {
  const rows = await client.$queryRaw<Array<{ product_id: string; quantity: bigint }>>`
    SELECT inv.finished_product_id AS product_id, COALESCE(SUM(item.quantity), 0)::bigint AS quantity
    FROM fridge_inventory inv
    LEFT JOIN refill_requests req ON req.store_id = inv.store_id AND req.status = 'completed'
      AND req.delivered_at IS NOT NULL AND (inv.last_audit_date IS NULL OR req.delivered_at > inv.last_audit_date)
    LEFT JOIN refill_request_items item ON item.refill_request_id = req.id AND item.finished_product_id = inv.finished_product_id
    WHERE inv.store_id = ${storeId}
    GROUP BY inv.finished_product_id
  `;
  return new Map(rows.map(row => [row.product_id, Number(row.quantity)]));
}
