import { unstable_noStore as noStore } from "next/cache";
import { InventoryAdjustmentForm } from "@/components/crud-forms";
import { getInventoryData } from "@/lib/db-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function InventoryAdjustmentPage() {
  noStore();
  const { source, materials } = await getInventoryData();
  return (
    <>
      <div className="page form-page workspace-color-page color-domain-materials">
        <div className="page-header color-page-header">
          <div>
            <div className="eyebrow">ປັບຍອດວັດຖຸດິບ</div>
            <h1>ປັບຍອດສາງ</h1>
            <p>ໃຊ້ສຳລັບການແກ້ຍອດຈາກການນັບ, ຂອງເສຍ, ໝົດອາຍຸ ຫຼືການໃຊ້ທົດລອງ. ທຸກລາຍການຖືກເກັບ ປະຫວັດການແກ້ໄຂ.</p>
          </div>
        </div>
        {source === "demo" && <div className="notice form-mode-notice"><strong>ຖານຂໍ້ມູນຍັງບໍ່ພ້ອມ</strong><br />ການປັບຈຳນວນຄົງເຫຼືອ ຈະເປີດໃຊ້ຫຼັງ ຕັ້ງຄ່າ PostgreSQL.</div>}
        <InventoryAdjustmentForm enabled={source === "database"} materials={materials.map(({ id, name, unit, stock }) => ({ id, name, unit, stock }))} />
      </div>
    </>
  );
}
