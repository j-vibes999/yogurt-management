import { unstable_noStore as noStore } from "next/cache";
import { ALL_CLEAR_ALERT, getNotificationsData } from "@/lib/db-data";
import { canRoleOpen } from "@/lib/access-policy";
import { getViewerRole } from "@/lib/server-session";
import { NotificationCenter } from "@/components/notification-center";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NotificationsPage() {
  noStore();
  const [{ source, alerts: allAlerts }, role] = await Promise.all([getNotificationsData(), getViewerRole()]);
  // Only alerts this role can open; the rest would lead to a page that sends it back.
  const visible = allAlerts.filter((alert) => alert.id !== ALL_CLEAR_ALERT.id && canRoleOpen(role, alert.href));
  const alerts = visible.length ? visible : [ALL_CLEAR_ALERT];
  const urgent = alerts.filter((alert) => alert.type === "urgent").length;
  const warning = alerts.filter((alert) => alert.type === "warning").length;
  const info = alerts.filter((alert) => alert.type === "info").length;

  return (
    <>
      <div className="page workspace-color-page color-domain-operations notifications-page-v4">
        <div className="page-header color-page-header">
          <div>
            <div className="eyebrow">ສູນວຽກທີ່ຕ້ອງເຮັດ</div>
            <h1>ສູນແຈ້ງເຕືອນ</h1>
            <p>ລວມວຽກດ່ວນ, ຈຳນວນຄົງເຫຼືອຕ່ຳ, ການເຕີມສິນຄ້າ, ຍອດຄ້າງ, ລັອດຜະລິດໃກ້ໝົດອາຍຸ ແລະຕູ້ທີ່ຕ້ອງບຳລຸງ.</p>
          </div>
        </div>

        <section className="notification-summary-v4">
          <div className={urgent>0?"color-metric-danger":"color-metric-neutral"}><span className={`notification-dot-v4 ${urgent>0?"urgent":"neutral"}`} aria-hidden="true"/><strong>{urgent}</strong><small>ຕ້ອງເຮັດກ່ອນ</small></div>
          <div className={warning>0?"color-metric-warning":"color-metric-neutral"}><span className={`notification-dot-v4 ${warning>0?"warning":"neutral"}`} aria-hidden="true"/><strong>{warning}</strong><small>ຄວນຕິດຕາມ</small></div>
          <div className="color-metric-info"><span className="notification-dot-v4 info" aria-hidden="true"/><strong>{info}</strong><small>ຂໍ້ມູນ</small></div>
        </section>

        {source === "demo" && <div className="notice" style={{ marginBottom: 16 }}><strong>ໂໝດສາທິດ</strong><br />ແຈ້ງເຕືອນຈະຄຳນວນຈາກ PostgreSQL ທັນທີເມື່ອ ຖານຂໍ້ມູນເຮັດວຽກ.</div>}

        <NotificationCenter alerts={alerts}/>
      </div>
    </>
  );
}
