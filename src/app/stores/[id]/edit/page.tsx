import { unstable_noStore as noStore } from "next/cache";
import { notFound } from "next/navigation";
import { StoreEditForm } from "@/components/store-management";
import { getStoresData } from "@/lib/db-data";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function StoreEditPage({ params }: { params: Promise<{ id: string }> }) {
  noStore();
  const { id } = await params;
  const { source, stores } = await getStoresData();
  const store = stores.find((item) => item.id === id);
  if (!store) notFound();
  const rawStore = source === "database" ? await prisma.store.findUnique({
    where: { id, isActive: true },
    select: { contactName: true, phone: true, whatsapp: true, facebook: true, address: true },
  }).catch((error) => {
    console.error("[yogurt-db] store edit query failed", error);
    return undefined;
  }) : undefined;
  if (rawStore === null) notFound();
  const enabled = source === "database" && rawStore !== undefined;

  return (
    <>
      <div className="page form-page workspace-color-page color-domain-stores">
        <div className="page-header color-page-header">
          <div>
            <div className="eyebrow">ຕັ້ງຄ່າຮ້ານ</div>
            <h1>ແກ້ໄຂ {store.name}</h1>
            <p>ປັບຂໍ້ມູນຕິດຕໍ່, ພິກັດ, ສ່ວນແບ່ງ ແລະຄ່າໄຟປະຈຳເດືອນ.</p>
          </div>
        </div>
        {!enabled && <div className="notice form-mode-notice"><strong>ຖານຂໍ້ມູນຍັງບໍ່ພ້ອມ</strong><br />ໜ້ານີ້ເບິ່ງຂໍ້ມູນໄດ້ແຕ່ຍັງບັນທຶກບໍ່ໄດ້.</div>}
        <StoreEditForm
          enabled={enabled}
          store={{
            id: store.id,
            name: store.name,
            contactName: rawStore ? rawStore.contactName ?? "" : store.contactName,
            phone: rawStore ? rawStore.phone ?? "" : store.phone,
            whatsapp: rawStore ? rawStore.whatsapp ?? "" : store.whatsapp,
            facebook: rawStore ? rawStore.facebook ?? "" : store.facebook,
            address: rawStore ? rawStore.address ?? "" : store.address,
            latitude: store.latitude,
            longitude: store.longitude,
            commissionRate: store.commissionRate,
            monthlyElectricity: store.monthlyElectricity,
          }}
        />
      </div>
    </>
  );
}
