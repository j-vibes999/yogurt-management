import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import { getStoresData } from "@/lib/db-data";
import { StoreDirectory } from "@/components/store-directory";
export const dynamic="force-dynamic"; export const revalidate=0;
export default async function StoresPage(){
  noStore(); const {source,stores}=await getStoresData();
  const due=stores.filter(s=>s.due).length;
  const low=stores.filter(s=>{const c=s.fridge?.capacityCups??100;return c>0&&s.stock/c<=.35}).length;
  return <div className="page workflow-page workflow-stores simple-page-v20 workspace-color-page color-domain-stores">
    <div className="page-header color-page-header"><div><div className="eyebrow">ຮ້ານຄ້າ</div><h1>ຮ້ານຄ້າ</h1><p>{stores.length} ຮ້ານ · {due} ຮອດຮອບກວດ · {low} ຈຳນວນຄົງເຫຼືອຕ່ຳ</p></div><div className="page-actions"><Link prefetch={false} href="/map" className="button button-secondary">ແຜນທີ່</Link><Link prefetch={false} href="/stores/new" className="button button-primary">+ ເພີ່ມຮ້ານ</Link></div></div>
    {source==="demo"&&<div className="notice" style={{marginBottom:16}}>ຖານຂໍ້ມູນຍັງບໍ່ພ້ອມ.</div>}
    <StoreDirectory stores={stores} enabled={source==="database"}/>
  </div>;
}
