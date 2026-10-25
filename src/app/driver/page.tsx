import { unstable_noStore as noStore } from "next/cache";
import { DriverDirectory } from "@/components/driver-directory";
import { getStoresData } from "@/lib/db-data";
export const dynamic="force-dynamic"; export const revalidate=0;
export default async function DriverPage(){
  noStore(); const {source,stores}=await getStoresData(); const pending=stores.filter(s=>s.due).length; const done=stores.length-pending; const progress=stores.length?Math.round(done/stores.length*100):100;
  return <div className="driver-page workflow-page workflow-driver simple-page-v20 workspace-color-page color-domain-stores">
    <div className="driver-head driver-head-v4 color-page-header"><div><div className="eyebrow">ກວດຮ້ານ</div><h1>ກວດຮ້ານ</h1><p className="muted">ເຫຼືອ {pending} ຮ້ານທີ່ຕ້ອງກວດ.</p></div></div>
    {source==="demo"&&<div className="notice">ຖານຂໍ້ມູນຍັງບໍ່ພ້ອມ. ກຳລັງສະແດງຂໍ້ມູນຕົວຢ່າງແບບອ່ານຢ່າງດຽວ.</div>}
    <section className="driver-progress-v4 color-metric-success"><div className="driver-progress-copy-v4"><span>ຮອບນີ້</span><strong>{done}/{stores.length} ຮ້ານ</strong></div><div className="driver-progress-meter-v4"><i style={{width:`${progress}%`}}/></div><span className="driver-progress-percent-v4">{progress}%</span></section>
    <DriverDirectory stores={stores} enabled={source==="database"}/>
  </div>;
}
