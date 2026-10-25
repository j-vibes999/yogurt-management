import { unstable_noStore as noStore } from "next/cache";
import { formatMoney } from "@/lib/business";
import { SettlementDirectory } from "@/components/settlement-directory";
import { getSettlementsData } from "@/lib/db-data";
export const dynamic="force-dynamic"; export const revalidate=0;
export default async function SettlementsPage({searchParams}:{searchParams?:Promise<{page?:string;q?:string;filter?:string}>}){
  noStore(); const params=await searchParams;const {source,settlements,currentOutstanding,collected,pendingStores,server}=await getSettlementsData({page:Number(params?.page)||1,query:params?.q,filter:params?.filter});
  return <div className="page workspace-color-page color-domain-finance simple-page-v20">
    <div className="page-header color-page-header"><div><div className="eyebrow">ຮັບເງິນ</div><h1>ຮັບເງິນ / ປິດຍອດ</h1><p>{pendingStores} ຮ້ານຍັງມີຍອດຄ້າງ.</p></div></div>
    {source==="demo"&&<div className="notice">ຖານຂໍ້ມູນຍັງບໍ່ພ້ອມ. ຍອດເງິນດ້ານລຸ່ມເປັນຂໍ້ມູນຕົວຢ່າງແບບອ່ານຢ່າງດຽວ.</div>}
    <section className="simple-money-summary-v20"><div className={currentOutstanding>0?"color-metric-warning":"color-metric-neutral"}><span>ຍອດຄ້າງຮັບ</span><strong>{formatMoney(currentOutstanding)}</strong><small>ຍອດປັດຈຸບັນລ່າສຸດຂອງທຸກຮ້ານ</small></div><div className={collected>0?"color-metric-success":"color-metric-neutral"}><span>ຮັບແລ້ວ</span><strong>{formatMoney(collected)}</strong><small>ລວມເງິນທີ່ບັນທຶກໃນປະຫວັດ</small></div></section>
    <div className="card panel-card color-panel finance-table-card-v4"><div className="panel-head color-panel-heading"><div><span className="panel-kicker">ຍອດລ່າສຸດ / ປະຫວັດ</span><h2>ເລືອກຮ້ານເພື່ອຮັບເງິນ</h2><p className="panel-description">ຕົວກອງສະຖານະສະແດງຮອບລ່າສຸດຕໍ່ຮ້ານ; ເລືອກ “ປະຫວັດທັງໝົດ” ເພື່ອເບິ່ງທຸກຮອບ.</p></div></div><SettlementDirectory items={settlements} enabled={source==="database"} server={server}/></div>
  </div>;
}
