import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import { ExpenseDirectory } from "@/components/expense-directory";
import { formatMoney } from "@/lib/business";
import { getExpensesData, getStoreOptions } from "@/lib/db-data";
export const dynamic="force-dynamic"; export const revalidate=0;
export default async function ExpensesPage({searchParams}:{searchParams?:Promise<{page?:string;q?:string;filter?:string}>}){
  noStore();const params=await searchParams;const [{source,expenses,totalAmount:total,total:count,server},{stores}]=await Promise.all([getExpensesData({page:Number(params?.page)||1,query:params?.q,filter:params?.filter}),getStoreOptions()]);const exportQuery=new URLSearchParams({q:params?.q??"",filter:params?.filter??"all"});
  return <div className="page workspace-color-page color-domain-finance workflow-page workflow-finance simple-page-v20">
    <div className="page-header color-page-header"><div><div className="eyebrow">ລາຍຈ່າຍ</div><h1>ລາຍຈ່າຍ</h1><p>ລວມ {formatMoney(total)} · {count} ລາຍການ</p></div><div className="page-actions">{source==="database"&&<a className="button button-secondary" href={`/api/expenses/export?${exportQuery}`}>ສົ່ງອອກ CSV</a>}<Link prefetch={false} className="button button-primary" href="/expenses/new">+ ບັນທຶກລາຍຈ່າຍ</Link></div></div>
    {source==="demo"&&<div className="notice" style={{marginBottom:16}}>ຖານຂໍ້ມູນຍັງບໍ່ພ້ອມ.</div>}
    <div className="card panel-card color-panel finance-table-card-v4"><div className="panel-head color-panel-heading"><div><span className="panel-kicker">ລາຍການ</span><h2>ປະຫວັດລາຍຈ່າຍ</h2></div></div><ExpenseDirectory expenses={expenses} stores={stores.map(({id,name})=>({id,name}))} enabled={source==="database"} server={server}/></div>
  </div>;
}
