import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import { formatMoney } from "@/lib/business";
import { getReportsData } from "@/lib/db-data";
import { ReportExportButton } from "@/components/report-export-button";
import { ResponsiveDisclosure } from "@/components/responsive-disclosure";
import { EmptyState } from "@/components/empty-state";
import { businessDateString, businessReportRange } from "@/lib/date-only";
export const dynamic="force-dynamic"; export const revalidate=0;

export default async function ReportsPage({searchParams}:{searchParams?:Promise<{period?:string}>}){
  noStore(); const params=await searchParams; const period=["today","7d","month"].includes(params?.period??"")?params!.period!:"month"; const range=businessReportRange(period); const data=await getReportsData(range);
  const dateFormat=new Intl.DateTimeFormat("lo-LA",{timeZone:"Asia/Vientiane",day:"numeric",month:"short",year:"numeric"});
  const rangeLabel=`${dateFormat.format(range.from)} – ${dateFormat.format(new Date(range.to.getTime()-1))}`;
  const csvContext={from:businessDateString(range.from),to:businessDateString(new Date(range.to.getTime()-1)),timeZone:"Asia/Vientiane",source:data.source,costMode:data.costMode};
  const units=data.productSales.reduce((s,i)=>s+i.unitsSold,0);
  // Expired and damaged cups are a cost of the goods, so they come off the gross profit too.
  const grossProfit=data.monthGross-data.storeShare-data.productCost-data.wasteCost;
  const margin=data.monthGross>0?data.netProfit/data.monthGross*100:0;
  const foodCost=data.monthGross>0?data.productCost/data.monthGross*100:0;
  const ranked=[...data.storeRows].sort((a,b)=>b.gross-a.gross);
  const totalCosts=data.storeShare+data.productCost+data.wasteCost+data.expenses;

  return <div className="page workspace-color-page color-domain-finance reports-simple-v21 workflow-page workflow-finance">
    <div className="page-header color-page-header"><div><div className="eyebrow">ລາຍງານ</div><h1>ລາຍງານ & ກຳໄລ</h1><p>ເບິ່ງຕົວເລກສຳຄັນກ່ອນ; ລາຍລະອຽດຢູ່ດ້ານລຸ່ມ.</p></div><div className="page-actions"><ReportExportButton rows={data.storeRows} period={period} summary={{gross:data.monthGross,storeShare:data.storeShare,productCost:data.productCost,wasteCost:data.wasteCost,centralWasteCost:data.centralWasteCost,expenses:data.expenses,netProfit:data.netProfit,unallocatedExpenses:data.unallocatedExpenses,electricityBudget:data.electricityBudget}} context={csvContext}/></div></div>
    {data.source==="demo"&&<div className="notice">ຖານຂໍ້ມູນຍັງບໍ່ພ້ອມ. ລາຍງານນີ້ໃຊ້ຂໍ້ມູນຕົວຢ່າງ.</div>}
    {data.source==="database"&&data.costMode==="estimated"&&<div className="notice">ຕົ້ນທຶນບາງລາຍການໃຊ້ຕົວເລກປະຫວັດທີ່ບັນທຶກໄວ້. ສິນຄ້າທີ່ຍັງບໍ່ຮູ້ຕົ້ນທຶນໃຊ້ 28% ຂອງຍອດຂາຍເພື່ອປະເມີນ.</div>}

    <div className="report-period-v1" aria-label="ໄລຍະເວລາລາຍງານ"><Link className={period==="today"?"is-active":undefined} aria-current={period==="today"?"page":undefined} href="/reports?period=today">ມື້ນີ້</Link><Link className={period==="7d"?"is-active":undefined} aria-current={period==="7d"?"page":undefined} href="/reports?period=7d">7 ມື້</Link><Link className={period==="month"?"is-active":undefined} aria-current={period==="month"?"page":undefined} href="/reports?period=month">ເດືອນນີ້</Link></div>
    <p className="report-scope">ຂໍ້ມູນຊ່ວງ {rangeLabel}</p>
    <p className="panel-description">ກຳໄລຫັກລາຍຈ່າຍທີ່ບັນທຶກຈິງໃນຊ່ວງນີ້. ງົບຄ່າໄຟລາຍເດືອນ {formatMoney(data.electricityBudget)} ໃຊ້ເພື່ອວາງແຜນ.</p>

    <section className="report-kpi-grid-v4">
      <article className="report-kpi-card-v4 color-metric-domain"><span>ຍອດຂາຍ</span><strong>{formatMoney(data.monthGross)}</strong></article>
      <article className={`report-kpi-card-v4 ${grossProfit<0?"color-metric-danger":grossProfit>0?"color-metric-success":"color-metric-neutral"}`}><span>ກຳໄລຂັ້ນຕົ້ນ</span><strong>{formatMoney(grossProfit)}</strong></article>
      <article className="report-kpi-card-v4 color-metric-domain"><span>ລາຍຈ່າຍ</span><strong>{formatMoney(data.expenses)}</strong></article>
      <article className={`report-kpi-card-v4 profit ${data.netProfit<0?"negative color-metric-danger":data.netProfit>0?"color-metric-success":"color-metric-neutral"}`}><span>ກຳໄລສຸດທິ</span><strong>{formatMoney(data.netProfit)}</strong><small>ອັດຕາກຳໄລ {margin.toFixed(1)}%</small></article>
    </section>

    <ResponsiveDisclosure title="ລາຍລະອຽດຍອດຂາຍ" summary="ຕາມຮ້ານ, ສິນຄ້າ ແລະຕົ້ນທຶນ" className="reports-detail-disclosure-v33">
      <section className="reports-detail-grid-v21">
        <article className="card panel-card color-panel">
          <div className="panel-head color-panel-heading"><div><span className="panel-kicker">ຮ້ານ</span><h2>ຍອດຂາຍຕາມຮ້ານ</h2></div></div>
          {ranked.length?<div className="report-simple-list-v21">{ranked.map(row=><div key={row.storeId}><span><strong>{row.storeName}</strong><small>ກຳໄລ {formatMoney(row.profit)} · ລາຍຈ່າຍຈິງ {formatMoney(row.expenseTotal)}{row.wasteCost>0?` · ຂອງເສຍ ${formatMoney(row.wasteCost)}`:""}</small></span><b>{formatMoney(row.gross)}</b></div>)}</div>:<EmptyState compact icon="store" title="ຍັງບໍ່ມີຍອດຂາຍຕາມຮ້ານ" description="ເລືອກໄລຍະເວລາອື່ນ ຫຼືກວດກາລາຍການປິດຮອບຂອງຮ້ານ." action={<Link className="button button-secondary" href="/settlements?filter=all">ເບິ່ງປະຫວັດປິດຮອບ</Link>}/>}
          {data.unallocatedExpenses>0&&<p className="panel-description">ລາຍຈ່າຍສ່ວນກາງ {formatMoney(data.unallocatedExpenses)} ຫັກຈາກກຳໄລລວມ.</p>}
          {data.centralWasteCost>0&&<p className="panel-description">ສິນຄ້າທີ່ຕັດອອກຈາກສາງກາງ (ເສຍ / ໝົດອາຍຸ) {formatMoney(data.centralWasteCost)} ຫັກຈາກກຳໄລລວມ.</p>}
        </article>
        <article className="card panel-card color-panel">
          <div className="panel-head color-panel-heading"><div><span className="panel-kicker">ສິນຄ້າ</span><h2>ຍອດຂາຍຕາມສິນຄ້າ</h2></div><span className="store-meta">{units.toLocaleString()} ຖ້ວຍ</span></div>
          {data.productSales.length?<div className="report-simple-list-v21">{data.productSales.map(item=><div key={item.productId}><span><strong>{item.name}</strong><small>{units?Math.round(item.unitsSold/units*100):0}% ຂອງຈຳນວນຂາຍ</small></span><b>{item.unitsSold.toLocaleString()}</b></div>)}</div>:<EmptyState compact icon="box" title="ຍັງບໍ່ມີສິນຄ້າຂາຍໃນຊ່ວງນີ້" description="ຍອດຂາຍຈະສະແດງຫຼັງບັນທຶກການກວດຮ້ານ ແລະປິດຮອບ. ລອງເລືອກໄລຍະເວລາອື່ນໄດ້."/>}
        </article>
      </section>
      <article className="card panel-card color-panel report-cost-simple-v21">
        <div className="panel-head color-panel-heading"><div><span className="panel-kicker">ຕົ້ນທຶນ</span><h2>ຕົ້ນທຶນ & ລາຍຈ່າຍ</h2></div><span className="store-meta">ສັດສ່ວນຕົ້ນທຶນສິນຄ້າ {foodCost.toFixed(1)}%</span></div>
        <div className="report-cost-stack-v4"><div><span>ສ່ວນແບ່ງຮ້ານ</span><strong>{formatMoney(data.storeShare)}</strong></div><div><span>ຕົ້ນທຶນສິນຄ້າ</span><strong>{formatMoney(data.productCost)}</strong></div><div><span>ສິນຄ້າເສຍ / ໝົດອາຍຸ</span><strong>{formatMoney(data.wasteCost)}</strong></div><div><span>ລາຍຈ່າຍ</span><strong>{formatMoney(data.expenses)}</strong></div><div className="total"><span>ລວມ</span><strong>{formatMoney(totalCosts)}</strong></div></div>
      </article>
    </ResponsiveDisclosure>
  </div>;
}
