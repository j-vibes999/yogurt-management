import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import {
  ArrowRight, AlertTriangle, Boxes, CalendarDays, CheckCircle2,
  CircleDollarSign, Clock, Package, RefreshCw, Store, Truck, type LucideIcon,
} from "lucide-react";
import { DashboardRefresh } from "@/components/dashboard-refresh";
import { DashboardStoreTasks } from "@/components/dashboard-store-tasks";
import { formatMoney } from "@/lib/business";
import { getDashboardData, getNotificationsData } from "@/lib/db-data";
import { getDashboardAttentionSummary, type DashboardAttentionItem } from "@/lib/dashboard-summary";
import { canRoleOpen } from "@/lib/access-policy";
import { getViewerRole } from "@/lib/server-session";
import "./dashboard.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
const stockNumber = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(value);
const attentionIcons: Record<DashboardAttentionItem["key"], LucideIcon> = {
  "due-stores": Store, refills: RefreshCw, materials: Boxes,
  receivables: CircleDollarSign, expiring: Clock, maintenance: AlertTriangle,
};

function DashboardMetric({ label, value, unit, note, href, icon: Icon, category }: {
  label: string; value: number; unit: string; note: string; href: string; icon: LucideIcon;
  category: "refills" | "stores" | "receivables" | "materials";
}) {
  return (
    <Link prefetch={false} href={href} className={`dashboard-metric dashboard-category-${category}`}>
      <div className="dashboard-metric-label"><span>{label}</span><span className="dashboard-category-icon"><Icon size={18} aria-hidden="true" /></span></div>
      <div className="dashboard-metric-value">
        <strong className={`dashboard-metric-number${unit === "LAK" ? " is-money" : ""}`}>{unit === "LAK" ? formatMoney(value).replace(/ LAK$/, "") : number(value)}</strong>
        <span>{unit}</span>
      </div>
      <div className="dashboard-metric-note"><span>{note}</span><ArrowRight size={15} aria-hidden="true" /></div>
    </Link>
  );
}

export default async function DashboardPage() {
  noStore();
  const dashboardPromise = getDashboardData();
  const [data, notificationData, role] = await Promise.all([dashboardPromise, getNotificationsData(dashboardPromise), getViewerRole()]);
  // Show figures, alerts and links only for pages this role can open, so nothing leads to a dead end.
  const can = (href: string) => canRoleOpen(role, href);
  const attention = getDashboardAttentionSummary(data, notificationData.alerts).filter((item) => can(item.href));
  const dueStores = data.stores.filter((store) => store.due)
    .sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name, "lo"));
  const now = new Date();
  const date = new Intl.DateTimeFormat("lo-LA", { dateStyle: "full", timeZone: "Asia/Vientiane" }).format(now);
  const loadedAt = new Intl.DateTimeFormat("lo-LA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Vientiane" }).format(now);
  const low = data.lowMaterials.length;

  return (
    <div className="page dashboard-workspace">
      {data.source === "demo" && <div className="notice" role="status">ຖານຂໍ້ມູນຍັງບໍ່ພ້ອມ. ກຳລັງສະແດງຂໍ້ມູນຕົວຢ່າງແບບອ່ານຢ່າງດຽວ.</div>}

      <header className="dashboard-heading">
        <div>
          <h1>ວຽກງານມື້ນີ້</h1>
          <p className="dashboard-date"><CalendarDays size={15} aria-hidden="true" /><span>{date}</span></p>
        </div>
        <div className="dashboard-heading-actions">
          <span className={`dashboard-overall-status ${attention.length > 0 ? "has-attention" : "is-clear"}`}>
            {data.source === "demo" ? "ໂໝດສາທິດ" : attention.length > 0 ? "ມີລາຍການທີ່ຄວນຈັດການ" : "ບໍ່ມີລາຍການແຈ້ງເຕືອນ"}
          </span>
          <div className="dashboard-freshness"><span>{data.source === "demo" ? "ຂໍ້ມູນຕົວຢ່າງ" : `ໂຫຼດຂໍ້ມູນ ${loadedAt}`}</span><DashboardRefresh /></div>
        </div>
      </header>

      <section className="dashboard-metrics" aria-label="ຕົວເລກສຳຄັນ">
        {can("/refills") && <DashboardMetric category="refills" label="ຄິວເຕີມສິນຄ້າ" value={data.refills.length} unit="ຄິວ" note={data.refills.length > 0 ? "ລໍຖ້າ / ຈັດສິນຄ້າ / ສົ່ງ" : "ບໍ່ມີຄິວທີ່ກຳລັງເຮັດ"} href="/refills" icon={RefreshCw} />}
        {can("/driver") && <DashboardMetric category="stores" label="ຮ້ານຮອດຮອບກວດ" value={data.dueStores} unit="ຮ້ານ" note="ກວດຕູ້ແຊ່ ແລະສິນຄ້າ" href="/driver" icon={Store} />}
        {can("/settlements") && <DashboardMetric category="receivables" label="ຍອດຄ້າງຮັບ" value={data.outstanding} unit="LAK" note="ຍອດຄົງຄ້າງຈາກຮ້ານຄ້າ" href="/settlements" icon={CircleDollarSign} />}
        {can("/inventory") && <DashboardMetric category="materials" label="ວັດຖຸດິບທີ່ຄວນຈັບຕາ" value={low} unit="ລາຍການ" note={low > 0 ? "ໃກ້ຈຸດສັ່ງຊື້ ຫຼືຕ່ຳກວ່າ" : "ບໍ່ມີລາຍການທີ່ຕ້ອງຈັບຕາ"} href="/inventory" icon={Boxes} />}
      </section>

      <dl className="dashboard-secondary-metrics">
        <div><dt>ໂຢເກີດໃນຕູ້ແຊ່</dt><dd>{number(data.cupsInStores)} <span>/ {number(data.totalCapacity)} ຖ້ວຍ</span></dd></div>
        <div><dt>ຍອດຂາຍ 7 ວັນ</dt><dd>{formatMoney(data.weeklyGross)} <span>· ລວມທຸກຮ້ານ</span></dd></div>
      </dl>

      <section className="dashboard-attention" aria-labelledby="dashboard-attention-title">
        <div className="dashboard-section-heading">
          <h2 id="dashboard-attention-title">ລາຍການທີ່ຄວນຈັດການ</h2>
          <Link prefetch={false} href="/notifications" className="dashboard-text-link">ເບິ່ງການແຈ້ງເຕືອນ<ArrowRight size={14} aria-hidden="true" /></Link>
        </div>
        {attention.length > 0 ? (
          <ul className="dashboard-attention-list">
            {attention.map((item) => {
              const Icon = attentionIcons[item.key];
              return (
                <li key={item.key}><Link prefetch={false} href={item.href} className={`dashboard-attention-item is-${item.tone}`} aria-label={`${item.label}${item.value === undefined ? "" : ` ${number(item.value)} ${item.unit}`} · ${item.detail}`}>
                  <Icon size={16} aria-hidden="true" /><span>{item.label}</span>
                  {item.value !== undefined && <strong>{number(item.value)} {item.unit}</strong>}
                  <ArrowRight size={13} aria-hidden="true" />
                </Link></li>
              );
            })}
          </ul>
        ) : <p className="dashboard-clear"><CheckCircle2 size={17} aria-hidden="true" />ບໍ່ມີລາຍການແຈ້ງເຕືອນໃນຕອນນີ້</p>}
      </section>

      <div className="dashboard-work-columns">
        <section className="dashboard-work-panel dashboard-category-stores" aria-labelledby="dashboard-stores-title">
          <div className="dashboard-panel-heading">
            <div className="dashboard-panel-title"><span className="dashboard-category-icon"><Store size={18} aria-hidden="true" /></span><div><h2 id="dashboard-stores-title">ຮ້ານທີ່ຕ້ອງກວດ <span>{number(dueStores.length)}</span></h2><p>ຮ້ານທີ່ສິນຄ້າເຫຼືອນ້ອຍຢູ່ເທິງສຸດ</p></div></div>
            {can("/driver") && <Link prefetch={false} href="/driver" className="dashboard-text-link">ກວດຮ້ານ<ArrowRight size={14} aria-hidden="true" /></Link>}
          </div>
          <DashboardStoreTasks allowRestock={can("/driver")} stores={dueStores.map(({ id, name, address, stock, fridge }) => ({ id, name, address, stock, fridge }))} />
        </section>

        <div className="dashboard-side-panels">
          <section className="dashboard-work-panel dashboard-category-refills" aria-labelledby="dashboard-refills-title">
            <div className="dashboard-panel-heading">
              <div className="dashboard-panel-title"><span className="dashboard-category-icon"><RefreshCw size={18} aria-hidden="true" /></span><div><h2 id="dashboard-refills-title">ຄິວເຕີມສິນຄ້າ <span>{number(data.refills.length)}</span></h2><p>ລຽງຕາມເວລາທີ່ຂໍເຕີມ</p></div></div>
              <Link prefetch={false} href="/refills" className="dashboard-text-link">ເບິ່ງທັງໝົດ<ArrowRight size={14} aria-hidden="true" /></Link>
            </div>
            {data.refills.length > 0 ? (
              <div className="dashboard-refill-list">
                {data.refills.slice(0, 5).map((refill) => {
                  const totalCups = refill.items.reduce((total, item) => total + item.quantity, 0);
                  const StatusIcon = refill.status === "delivering" ? Truck : refill.status === "preparing" ? Package : Clock;
                  const statusText = refill.status === "delivering" ? "ກຳລັງສົ່ງ" : refill.status === "preparing" ? "ຈັດສິນຄ້າ" : "ລໍຖ້າ";
                  return (
                    <details className="dashboard-refill" key={refill.id}>
                      <summary>
                        <div className="dashboard-refill-identity"><strong>{refill.storeName}</strong><span>{number(totalCups)} ຖ້ວຍ · ກົດເບິ່ງລາຍລະອຽດ</span></div>
                        <span className={`dashboard-refill-status is-${refill.status}`}><StatusIcon size={13} aria-hidden="true" />{statusText}</span>
                      </summary>
                      <div className="dashboard-refill-detail">
                        <dl>{refill.items.map((item) => <div key={item.productId}><dt>{item.name || item.code}</dt><dd>{number(item.quantity)} ຖ້ວຍ</dd></div>)}</dl>
                        <p>ຂໍເຕີມ: {refill.requestedAt}</p>
                        {refill.note && <p>ໝາຍເຫດ: {refill.note}</p>}
                        <Link prefetch={false} href="/refills" className="dashboard-text-link" aria-label={`ຈັດການຄິວເຕີມ ${refill.storeName}`}>ຈັດການຄິວເຕີມ<ArrowRight size={14} aria-hidden="true" /></Link>
                      </div>
                    </details>
                  );
                })}
              </div>
            ) : <div className="dashboard-inline-empty"><CheckCircle2 size={18} aria-hidden="true" /><span>ບໍ່ມີຄິວເຕີມສິນຄ້າໃນຕອນນີ້</span></div>}
            {data.refills.length > 5 && <div className="dashboard-list-more"><span>ຍັງມີອີກ {number(data.refills.length - 5)} ຄິວ</span><Link prefetch={false} href="/refills" className="dashboard-text-link">ເບິ່ງທັງໝົດ<ArrowRight size={14} aria-hidden="true" /></Link></div>}
          </section>

          {can("/inventory") && <section className="dashboard-work-panel dashboard-category-materials" aria-labelledby="dashboard-materials-title">
            <div className="dashboard-panel-heading">
              <div className="dashboard-panel-title"><span className="dashboard-category-icon"><Boxes size={18} aria-hidden="true" /></span><div><h2 id="dashboard-materials-title">ວັດຖຸດິບທີ່ຄວນຈັບຕາ <span>{number(low)}</span></h2></div></div>
              <Link prefetch={false} href="/inventory" className="dashboard-text-link">ເບິ່ງສາງ<ArrowRight size={14} aria-hidden="true" /></Link>
            </div>
            {low > 0 ? (
              <ul className="dashboard-material-list">
                {data.lowMaterials.slice(0, 5).map((material) => {
                  const critical = material.stock <= material.minStock;
                  return <li key={material.id}>
                    <div><strong>{material.name}</strong><span>{material.category === "ingredient" ? "ວັດຖຸດິບ" : "ບັນຈຸພັນ"} · ຈຸດສັ່ງຊື້ {stockNumber(material.minStock)} {material.unit}</span><span className={critical ? "dashboard-material-critical" : "dashboard-material-watch"}>{critical ? "ຮອດຈຸດສັ່ງຊື້" : "ໃກ້ຈຸດສັ່ງຊື້"}</span></div>
                    <p><strong>{stockNumber(material.stock)}</strong><span>{material.unit}</span></p>
                  </li>;
                })}
              </ul>
            ) : <div className="dashboard-inline-empty"><CheckCircle2 size={18} aria-hidden="true" /><span>ບໍ່ມີວັດຖຸດິບໃກ້ຈຸດສັ່ງຊື້</span></div>}
            {low > 5 && <div className="dashboard-list-more"><span>ຍັງມີອີກ {number(low - 5)} ລາຍການ</span><Link prefetch={false} href="/inventory" className="dashboard-text-link">ເບິ່ງທັງໝົດ<ArrowRight size={14} aria-hidden="true" /></Link></div>}
          </section>}
        </div>
      </div>
    </div>
  );
}
