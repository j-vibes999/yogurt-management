import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import { getRefillsData } from "@/lib/db-data";
import { RefillBoard } from "@/components/refill-board";
export const dynamic="force-dynamic"; export const revalidate=0;
export default async function RefillsPage(){
  noStore(); const {source,refills}=await getRefillsData();
  return <div className="page simple-page-v20 refills-page-v21 workspace-color-page color-domain-refills">
    <div className="page-header color-page-header"><div><div className="eyebrow">ເຕີມສິນຄ້າ</div><h1>ຄິວເຕີມສິນຄ້າ</h1><p>{refills.length} ລາຍການທີ່ຍັງຕ້ອງຈັດການ.</p></div><div className="page-actions"><Link prefetch={false} className="button button-primary" href="/refills/new">+ ສ້າງຄຳຂໍເຕີມສິນຄ້າ</Link></div></div>
    {source==="demo"&&<div className="notice" style={{marginBottom:16}}>ຖານຂໍ້ມູນຍັງບໍ່ພ້ອມ.</div>}
    <RefillBoard items={refills} enabled={source==="database"}/>
  </div>;
}
