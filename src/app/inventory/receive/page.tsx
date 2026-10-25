import { unstable_noStore as noStore } from "next/cache";
import { ReceiveMaterialForm } from "@/components/crud-forms";
import { getInventoryData } from "@/lib/db-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ReceiveInventoryPage(){
  noStore();const {source,materials}=await getInventoryData();return <><div className="page form-page workspace-color-page color-domain-materials"><div className="page-header color-page-header"><div><div className="eyebrow">ຮັບວັດຖຸດິບ</div><h1>ຮັບວັດຖຸດິບເຂົ້າສາງ</h1><p>ບັນທຶກການຊື້, ເພີ່ມຈຳນວນຄົງເຫຼືອ ແລະອັບເດດຕົ້ນທຶນສະເລ່ຍອັດຕະໂນມັດ.</p></div></div>{source==="demo"&&<div className="notice form-mode-notice"><strong>ຖານຂໍ້ມູນຍັງບໍ່ພ້ອມ</strong><br/>ຍັງບໍ່ສາມາດອັບເດດຈຳນວນຄົງເຫຼືອ ຈິງໄດ້.</div>}<ReceiveMaterialForm enabled={source==="database"} materials={materials.map(({id,name,unit,stock})=>({id,name,unit,stock}))}/></div></>}
