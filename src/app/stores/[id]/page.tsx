import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/business";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function StoreHubPage({ params }: { params: Promise<{ id: string }> }) {
  noStore();
  const { id } = await params;
  const store = await prisma.store.findUnique({
    where: { id },
    include: {
      fridge: true,
      fridgeInventory: { where: { fridge: { currentStoreId: id } }, include: { finishedProduct: true }, orderBy: { finishedProduct: { name: "asc" } } },
      refillRequests: { where: { status: { in: ["waiting", "preparing", "delivering"] } }, include: { items: { include: { finishedProduct: true } } }, orderBy: { requestedAt: "desc" }, take: 5 },
      settlements: { orderBy: { settlementDate: "desc" }, take: 8 },
      restockVisits: { where: { status: "completed" }, orderBy: { visitDate: "desc" }, take: 6 },
      expenses: { where: { voidedAt: null }, orderBy: { incurredAt: "desc" }, take: 5 },
    },
  });
  if (!store || !store.isActive) notFound();

  const latestSettlement = store.settlements[0];
  const outstanding = Number(latestSettlement?.closingBalance ?? 0);
  const stock = store.fridgeInventory.reduce((sum, row) => sum + row.currentStock, 0);
  const capacity = store.fridge?.capacityCups ?? 0;
  const stockPercent = capacity > 0 ? Math.round((stock / capacity) * 100) : 0;
  const lastVisit = store.restockVisits[0]?.visitDate ?? null;
  const activeRefillCups = store.refillRequests.reduce((sum, req) => sum + req.items.reduce((s, item) => s + item.quantity, 0), 0);
  const moneyStatus = outstanding > 0 ? "ຄ້າງຮັບ" : "ປິດຍອດແລ້ວ";

  return <div className="page store-hub-v1 workspace-color-page color-domain-stores">
    <div className="store-hub-back-v1"><Link href="/stores">← ກັບລາຍຊື່ຮ້ານ</Link></div>
    <section className="store-hub-hero-v1 color-page-header">
      <div>
        <div className="eyebrow">ພາບລວມຮ້ານ</div>
        <h1>{store.name}</h1>
        <p>{store.address || "—"}</p>
        <div className="store-hub-contact-v1"><span>{store.contactName || "—"}</span><span>{store.phone || "—"}</span>{store.fridge && <span>{store.fridge.assetCode}</span>}</div>
      </div>
      <div className="store-hub-actions-v1">
        <Link className="button button-primary" href={`/driver/restock/${store.id}`}>ກວດຮ້ານ</Link>
        {outstanding > 0 && <Link className="button button-secondary" href={`/driver/restock/${store.id}?mode=payment`}>ຮັບເງິນ {outstanding.toLocaleString()} LAK</Link>}
        <Link className="button button-secondary" href={`/refills/new?storeId=${store.id}`}>+ ສ້າງຄຳຂໍເຕີມສິນຄ້າ</Link>
        <Link className="button button-ghost" href={`/stores/${store.id}/edit`}>ແກ້ໄຂຮ້ານ</Link>
      </div>
    </section>

    <section className="store-hub-kpis-v1">
      <article className={`card ${outstanding > 0 ? "color-metric-warning" : "color-metric-success"}`}><span>ຍອດຄ້າງ</span><strong>{formatMoney(outstanding)}</strong><small>{moneyStatus}</small></article>
      <article className={`card ${capacity > 0 && stockPercent <= 35 ? "color-metric-warning" : "color-metric-domain"}`}><span>ສິນຄ້າຄົງເຫຼືອໃນຕູ້</span><strong>{stock}/{capacity || "—"}</strong><small>{capacity > 0 ? `${stockPercent}% ຂອງຄວາມຈຸ` : "ຍັງບໍ່ກຳນົດຄວາມຈຸ"}</small></article>
      <article className={`card ${store.refillRequests.length ? "color-metric-info" : "color-metric-neutral"}`}><span>ການເຕີມສິນຄ້າທີ່ກຳລັງດຳເນີນ</span><strong>{store.refillRequests.length}</strong><small>{activeRefillCups} ຖ້ວຍໃນຄິວ</small></article>
      <article className={`card ${lastVisit ? "color-metric-success" : "color-metric-neutral"}`}><span>ກວດຮ້ານຫຼ້າສຸດ</span><strong>{lastVisit ? new Intl.DateTimeFormat("lo-LA", { dateStyle: "medium" }).format(lastVisit) : "ຍັງບໍ່ເຄີຍ"}</strong><small>{store.restockVisits.length ? "ມີປະຫວັດການກວດ" : "ຄວນເລີ່ມຮອບກວດຄັ້ງທຳອິດ"}</small></article>
    </section>

    <div className="store-hub-grid-v1">
      <section className="card panel-card color-panel">
        <div className="panel-head color-panel-heading"><div><span className="panel-kicker">ສິນຄ້າຄົງເຫຼືອ</span><h2>ສິນຄ້າຢູ່ໃນຕູ້</h2></div><Link className="text-link" href={`/driver/restock/${store.id}`}>ກວດຈຳນວນຄົງເຫຼືອ →</Link></div>
        <div className="store-hub-stock-list-v1">{store.fridgeInventory.length ? store.fridgeInventory.map(row => <div key={row.id}><span><strong>{row.finishedProduct.name}</strong><small>{row.finishedProduct.code}</small></span><b>{row.currentStock} ຖ້ວຍ</b></div>) : <div className="empty-state compact-empty"><strong>ຍັງບໍ່ມີສິນຄ້າໃນຕູ້</strong></div>}</div>
      </section>

      <section className="card panel-card color-panel color-domain-finance">
        <div className="panel-head color-panel-heading"><div><span className="panel-kicker">ການເງິນ</span><h2>ຍອດຊຳລະຫຼ້າສຸດ</h2></div><Link className="text-link" href="/settlements">ເບິ່ງທັງໝົດ →</Link></div>
        <div className="store-hub-money-v1"><div><span>ຍອດຄ້າງຫຼ້າສຸດ</span><strong className={outstanding > 0 ? "warning-text" : "success-text"}>{formatMoney(outstanding)}</strong></div>{latestSettlement && <><div><span>ຮັບແລ້ວຮອບຫຼ້າສຸດ</span><strong>{formatMoney(Number(latestSettlement.paidAmount))}</strong></div><div><span>ວັນທີ</span><strong>{new Intl.DateTimeFormat("lo-LA", { dateStyle: "medium" }).format(latestSettlement.settlementDate)}</strong></div></>}</div>
      </section>

      <section className="card panel-card color-panel color-domain-refills">
        <div className="panel-head color-panel-heading"><div><span className="panel-kicker">ເຕີມສິນຄ້າ</span><h2>ຄິວເຕີມສິນຄ້າ</h2></div><Link className="text-link" href={`/refills/new?storeId=${store.id}`}>+ ສ້າງຄຳຂໍເຕີມສິນຄ້າ</Link></div>
        {store.refillRequests.length ? <div className="store-hub-refill-v1">{store.refillRequests.map(req => <div key={req.id}><span><strong>{req.status === "waiting" ? "ລໍຖ້າ" : req.status === "preparing" ? "ກຳລັງຈັດ" : "ກຳລັງສົ່ງ"}</strong><small>{req.items.map(x => `${x.finishedProduct.name} ${x.quantity}`).join(" · ")}</small></span><b>{req.items.reduce((s,x)=>s+x.quantity,0)} ຖ້ວຍ</b></div>)}</div> : <div className="empty-state compact-empty"><strong>ບໍ່ມີຄຳຂໍເຕີມສິນຄ້າຄ້າງ</strong><span>ຕອນນີ້ບໍ່ມີຄຳຂໍທີ່ຕ້ອງຈັດການ</span></div>}
      </section>

      <section className="card panel-card color-panel">
        <div className="panel-head color-panel-heading"><div><span className="panel-kicker">ປະຫວັດ</span><h2>ການກວດຮ້ານຫຼ້າສຸດ</h2></div></div>
        {store.restockVisits.length ? <div className="store-hub-history-v1">{store.restockVisits.map(v => <div key={v.id}><span>{new Intl.DateTimeFormat("lo-LA", { dateStyle:"medium", timeStyle:"short" }).format(v.visitDate)}</span><strong>ກວດແລ້ວ</strong></div>)}</div> : <div className="empty-state compact-empty"><strong>ຍັງບໍ່ມີປະຫວັດ</strong></div>}
      </section>
    </div>
  </div>;
}
