import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RestockAuditForm } from "@/components/restock-audit-form";
import { getRestockStoreData } from "@/lib/db-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function StoreRestockPage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams?: Promise<{ mode?: string }> }) {
  noStore();
  const { storeId } = await params;
  const query = await searchParams;
  const paymentMode = query?.mode === "payment";
  const { data } = await getRestockStoreData(storeId);
  if (!data) notFound();

  const { store, fridge, lines } = data;

  return (
    <>
      <div className="driver-page workspace-color-page color-domain-refills">
        <div className="driver-head restock-head-v7 color-page-header">
          <Link href={paymentMode ? "/settlements" : "/driver"} className="muted" style={{ fontWeight: 800, fontSize: 12 }}>← {paymentMode ? "ກັບລາຍການຄ້າງຊຳລະ" : "ກັບລາຍການກວດຮ້ານ"}</Link>
          <div className="restock-title-row-v7"><div><div className="eyebrow">{paymentMode ? "ຮັບເງິນ / ປິດຍອດ" : "ກວດຮ້ານ"} · {fridge.assetCode}</div><h1>{store.name}</h1><p className="muted">{store.address}</p></div>{data.previousBalance > 0 && <div className="restock-debt-badge-v7 color-metric-warning"><span>ຍອດຄ້າງ</span><strong>{data.previousBalance.toLocaleString()} LAK</strong></div>}</div>
          <div className="restock-contact-v5">
            {store.phone && <a className="button button-secondary" href={`tel:${store.phone.replace(/\s/g, "")}`}>☎ ໂທຫາຮ້ານ</a>}
            {store.whatsapp && <a className="button button-secondary tone-whatsapp-v1" href={`https://wa.me/${store.whatsapp.replace(/\D/g, "").startsWith("856") ? store.whatsapp.replace(/\D/g, "") : store.whatsapp.replace(/\D/g, "").startsWith("020") ? `856${store.whatsapp.replace(/\D/g, "").slice(1)}` : `856${store.whatsapp.replace(/\D/g, "")}`}`} target="_blank" rel="noreferrer">💬 WhatsApp</a>}
            {store.latitude !== null && store.longitude !== null && <a className="button button-secondary" href={`https://www.google.com/maps/dir/?api=1&destination=${store.latitude},${store.longitude}`} target="_blank" rel="noreferrer">⌖ ນຳທາງ</a>}
          </div>
        </div>

        <RestockAuditForm
          key={JSON.stringify([store.id,fridge.assetCode,store.commissionRate,data.previousBalance,paymentMode,lines.map(line=>[line.productId,line.previousStock,line.refilledSinceAudit,line.retailPrice])])}
          store={{ id: store.id, name: store.name, commissionRate: store.commissionRate }}
          fridge={{ assetCode: fridge.assetCode }}
          lines={lines}
          previousBalance={data.previousBalance}
          paymentFirst={paymentMode}
        />
      </div>
    </>
  );
}
