import { unstable_noStore as noStore } from "next/cache";
import { FridgeDirectory } from "@/components/fridge-directory";
import { getFridgesData, getStoresData } from "@/lib/db-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function FridgesPage() {
  noStore();
  const [{ source, fridges }, { stores }] = await Promise.all([getFridgesData(), getStoresData()]);
  const active = fridges.filter((fridge) => fridge.status === "active").length;
  const maintenance = fridges.filter((fridge) => fridge.status === "maintenance").length;
  const totalCapacity = fridges.reduce((sum, fridge) => sum + fridge.capacityCups, 0);
  const storeOptions = stores.map(({ id, name }) => ({ id, name }));

  return (
    <>
      <div className="page workspace-color-page color-domain-stores">
        <div className="page-header color-page-header">
          <div>
            <div className="eyebrow">ຊັບສິນຕູ້ແຊ່</div>
            <h1>ຕູ້ແຊ່</h1>
            <p>ຈັດການລະຫັດຕູ້, ໝາຍເລກປະຈຳເຄື່ອງ, ຮຸ່ນ, ຄວາມຈຸ, ຮ້ານທີ່ຕິດຕັ້ງ ແລະສະຖານະບຳລຸງຮັກສາ.</p>
          </div>
        </div>

        <section className="grid grid-4" style={{ marginBottom: 18 }}>
          <div className="card stat color-metric-domain"><div className="stat-label">ຕູ້ທັງໝົດ</div><div className="stat-value">{fridges.length}</div><div className="stat-foot">ຕູ້ທີ່ລົງທະບຽນ</div></div>
          <div className="card stat color-metric-success"><div className="stat-label">ກຳລັງໃຊ້ງານ</div><div className="stat-value">{active}</div><div className="stat-foot">ຕູ້ທີ່ພ້ອມຂາຍ</div></div>
          <div className={`card stat ${maintenance ? "color-metric-warning" : "color-metric-neutral"}`}><div className="stat-label">ບຳລຸງຮັກສາ</div><div className="stat-value">{maintenance}</div><div className="stat-foot">ຄວນຕິດຕາມ</div></div>
          <div className="card stat color-metric-info"><div className="stat-label">ຄວາມຈຸລວມ</div><div className="stat-value">{totalCapacity.toLocaleString()}</div><div className="stat-foot">ຖ້ວຍ</div></div>
        </section>

        {source === "demo" && <div className="notice" style={{ marginBottom: 16 }}><strong>ໂໝດສາທິດ</strong><br />ການແກ້ໄຂ ແລະຍ້າຍຕູ້ຈະເປີດເມື່ອ PostgreSQL ເຮັດວຽກ.</div>}

        <FridgeDirectory fridges={fridges} stores={storeOptions} enabled={source === "database"} />

      </div>
    </>
  );
}
