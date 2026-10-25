import { unstable_noStore as noStore } from "next/cache";
import { notFound } from "next/navigation";
import { StoreEditForm } from "@/components/store-management";
import { getStoresData } from "@/lib/db-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function StoreEditPage({ params }: { params: Promise<{ id: string }> }) {
  noStore();
  const { id } = await params;
  const { source, stores } = await getStoresData();
  const store = stores.find((item) => item.id === id);
  if (!store) notFound();

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
        {source === "demo" && <div className="notice form-mode-notice"><strong>ຖານຂໍ້ມູນຍັງບໍ່ພ້ອມ</strong><br />ໜ້ານີ້ເບິ່ງຂໍ້ມູນໄດ້ແຕ່ຍັງບັນທຶກບໍ່ໄດ້.</div>}
        <StoreEditForm
          enabled={source === "database"}
          store={{
            id: store.id,
            name: store.name,
            contactName: store.contactName,
            phone: store.phone,
            whatsapp: store.whatsapp,
            facebook: store.facebook,
            address: store.address,
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
