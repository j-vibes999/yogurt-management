import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/server-session";
import { canRoleOpen } from "@/lib/access-policy";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ShellCounts = {
  refill_count: bigint;
  inventory_count: bigint;
  settlement_count: bigint;
  due_count: bigint;
  warning_material_count: bigint;
  outstanding_total: unknown;
  expiring_count: bigint;
  expired_count: bigint;
  expired_fridge_store_count: bigint;
  maintenance_count: bigint;
};

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າໃຊ້" }, { status: 401 });

  const rows = await prisma.$queryRaw<ShellCounts[]>`
    WITH latest AS (SELECT DISTINCT ON (store_id) store_id, closing_balance FROM settlements ORDER BY store_id, settlement_date DESC, id DESC)
    SELECT
      (SELECT COUNT(*) FROM refill_requests WHERE status IN ('waiting','preparing','delivering'))::bigint AS refill_count,
      (SELECT COUNT(*) FROM raw_materials WHERE is_active = true AND current_stock <= min_stock_alert)::bigint AS inventory_count,
      (SELECT COUNT(*) FROM latest WHERE closing_balance > 0)::bigint AS settlement_count,
      (SELECT COUNT(*) FROM stores s
        LEFT JOIN LATERAL (
          SELECT visit_date FROM restock_visits r
          WHERE r.store_id = s.id AND r.status = 'completed'
          ORDER BY visit_date DESC LIMIT 1
        ) v ON true
        WHERE s.is_active = true AND (v.visit_date IS NULL OR v.visit_date < (NOW() AT TIME ZONE 'UTC') - INTERVAL '7 days'))::bigint AS due_count,
      (SELECT COUNT(*) FROM raw_materials
        WHERE is_active = true AND current_stock <= min_stock_alert * 1.5)::bigint AS warning_material_count,
      (SELECT COALESCE(SUM(closing_balance), 0) FROM latest)::numeric AS outstanding_total,
      (SELECT COUNT(*) FROM production_batches
        WHERE status = 'completed' AND quantity_remaining > 0
          AND exp_date >= (NOW() AT TIME ZONE 'UTC') AND exp_date <= (NOW() AT TIME ZONE 'UTC') + INTERVAL '7 days')::bigint AS expiring_count,
      (SELECT COUNT(*) FROM production_batches
        WHERE status = 'completed' AND quantity_remaining > 0 AND exp_date < (NOW() AT TIME ZONE 'UTC'))::bigint AS expired_count,
      (SELECT COUNT(DISTINCT l.store_id) FROM fridge_stock_lots l
        JOIN fridges f ON f.id = l.fridge_id AND f.current_store_id = l.store_id
        JOIN stores s ON s.id = l.store_id AND s.is_active = true
        WHERE l.quantity_remaining > 0 AND l.exp_date < (NOW() AT TIME ZONE 'UTC'))::bigint AS expired_fridge_store_count,
      (SELECT COUNT(*) FROM fridges WHERE status = 'maintenance')::bigint AS maintenance_count
  `;

  const row = rows[0];
  const refill = Number(row?.refill_count ?? 0);
  const inventory = Number(row?.inventory_count ?? 0);
  const settlements = Number(row?.settlement_count ?? 0);
  const driver = Number(row?.due_count ?? 0);
  const warningMaterials = Number(row?.warning_material_count ?? 0);
  const outstanding = Number(row?.outstanding_total ?? 0);
  const expiring = Number(row?.expiring_count ?? 0);
  const expired = Number(row?.expired_count ?? 0);
  const expiredFridgeStores = Number(row?.expired_fridge_store_count ?? 0);
  const maintenance = Number(row?.maintenance_count ?? 0);
  // Count only the alerts and badges this role can open (same rule as the dashboard and notifications).
  const can = (href: string) => canRoleOpen(session.role, href);
  const dueAlerts = can("/driver") ? Math.min(driver, 4) + (driver > 4 ? 1 : 0) : 0;
  const alertCount = dueAlerts + (refill > 0 && can("/refills") ? 1 : 0) + (can("/inventory") ? Math.min(warningMaterials, 5) : 0) + (outstanding > 0 && can("/settlements") ? 1 : 0) + (expiring > 0 && can("/production") ? 1 : 0) + (expired > 0 && can("/production") ? 1 : 0) + (expiredFridgeStores > 0 && can("/driver") ? 1 : 0) + (maintenance > 0 && can("/fridges") ? 1 : 0);

  return NextResponse.json({
    session: { userId: session.userId, fullName: session.fullName, email: session.email, role: session.role },
    alertCount,
    navCounts: { refill: can("/refills") ? refill : 0, inventory: can("/inventory") ? inventory : 0, settlements: can("/settlements") ? settlements : 0, driver: can("/driver") ? driver : 0 },
  });
}
