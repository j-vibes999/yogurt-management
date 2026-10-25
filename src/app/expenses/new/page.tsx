import { unstable_noStore as noStore } from "next/cache";
import { ExpenseCreateForm } from "@/components/crud-forms";
import { getStoreOptions } from "@/lib/db-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NewExpensePage(){
  noStore();const {source,stores}=await getStoreOptions();return <><div className="page workspace-color-page color-domain-finance form-page"><div className="page-header color-page-header"><div><div className="eyebrow">ລາຍຈ່າຍ</div><h1>ບັນທຶກລາຍຈ່າຍ</h1><p>ລົງລາຍຈ່າຍກາງ ຫຼືຜູກລາຍຈ່າຍກັບຮ້ານເພື່ອໃຫ້ລາຍງານກຳໄລຖືກຕ້ອງ.</p></div></div>{source==="demo"&&<div className="notice form-mode-notice"><strong>ຖານຂໍ້ມູນຍັງບໍ່ພ້ອມ</strong><br/>ຟອມຈະບັນທຶກໄດ້ຫຼັງຈາກຕັ້ງຄ່າ PostgreSQL ສຳເລັດ.</div>}<ExpenseCreateForm enabled={source==="database"} stores={stores.map(({id,name})=>({id,name}))}/></div></>}
