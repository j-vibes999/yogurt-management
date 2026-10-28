"use client";
import Link from "next/link";
import { usePersistedFilter } from "@/lib/use-persisted-filter";
import { useMemo,useState } from "react";
import { RefillStatusButton } from "@/components/refill-status-button";
import { ListToolbar,FilterChips } from "@/components/list-toolbar";
import { EmptyState } from "@/components/empty-state";
type Item={productId:string;name:string;quantity:number};
type Refill={id:string;storeName:string;address:string;phone:string;requestedAt:string;note?:string|null;status:"waiting"|"preparing"|"delivering"|"completed"|"cancelled";items:Item[]};
export function RefillBoard({items,enabled,canManage}:{items:Refill[];enabled:boolean;canManage:boolean}){
 const [q,setQ]=useState("");const [tab,setTab]=usePersistedFilter("yogu:filter:refills","all",["all","waiting","preparing","delivering","completed"] as const);
 const counts={all:items.length,waiting:items.filter(x=>x.status==="waiting").length,preparing:items.filter(x=>x.status==="preparing").length,delivering:items.filter(x=>x.status==="delivering").length,completed:items.filter(x=>x.status==="completed").length};
 const rows=useMemo(()=>{const n=q.trim().toLowerCase();return items.filter(x=>(tab==="all"||x.status===tab)&&(!n||[x.storeName,x.address,x.phone,x.id,...x.items.map(i=>i.name)].join(" ").toLowerCase().includes(n)))},[items,q,tab]);
 const loadSummary=useMemo(()=>{
  const totalsByProduct:Record<string,{name:string;quantity:number}>={};
  let totalCups=0;
  for(const row of rows){
   for(const item of row.items){
    if(!totalsByProduct[item.productId]){totalsByProduct[item.productId]={name:item.name,quantity:0};}
    totalsByProduct[item.productId].quantity+=item.quantity;
    totalCups+=item.quantity;
   }
  }
  return {totalCups,breakdown:Object.values(totalsByProduct).sort((a,b)=>b.quantity-a.quantity)};
 },[rows]);
 return <>
  <ListToolbar query={q} onQuery={setQ} placeholder="ຄົ້ນຫາຄຳຂໍເຕີມສິນຄ້າ…" resultText={`${rows.length} ລາຍການ`}><FilterChips value={tab} onChange={setTab} items={[{key:"all",label:"ທັງໝົດ",count:counts.all},{key:"waiting",label:"ລໍຖ້າຈັດ",count:counts.waiting},{key:"preparing",label:"ກຳລັງຈັດ",count:counts.preparing},{key:"delivering",label:"ກຳລັງສົ່ງ",count:counts.delivering},...(counts.completed>0||tab==="completed"?[{key:"completed",label:"ສຳເລັດ",count:counts.completed}]:[])]}/></ListToolbar>
  {enabled&&!canManage&&<p className="panel-description">ມຸມມອງອ່ານຢ່າງດຽວ. ຜູ້ຈັດການ ແລະພະນັກງານສົ່ງເປັນຜູ້ອັບເດດສະຖານະຄຳຂໍ.</p>}
  {loadSummary.totalCups>0&&<div className="refill-load-summary-v1 color-panel color-metric-domain"><div className="load-summary-header-v1 color-panel-heading"><span className="load-summary-title-v1"><span className="summary-box-icon-v1">📦</span><strong>ຍອດລວມທີ່ຕ້ອງຈັດ / ໂຫຼດຂຶ້ນລົດ:</strong></span><span className="load-summary-badge-v1">ລວມທັງໝົດ <strong>{loadSummary.totalCups}</strong> ຖ້ວຍ</span></div><div className="load-summary-chips-v1">{loadSummary.breakdown.map(sku=><div key={sku.name} className="load-sku-chip-v1"><span className="load-sku-name-v1">{sku.name}</span><strong className="load-sku-qty-v1">{sku.quantity} <small>ຖ້ວຍ</small></strong></div>)}</div></div>}
  {rows.length?<section className="refill-board-v4">{rows.map(request=>{const total=request.items.reduce((s,i)=>s+i.quantity,0);const label=request.status==="delivering"?"ກຳລັງສົ່ງ":request.status==="preparing"?"ກຳລັງຈັດ":request.status==="completed"?"ສຳເລັດ":"ລໍຖ້າຈັດ";return <article className={`refill-card-v4 ${request.status}`} key={request.id}>
   <div className="refill-card-head-v4"><div><span className="refill-request-id-v4">{request.id}</span><h2>{request.storeName}</h2><p>{request.address}</p></div><span className={`refill-status-v4 ${request.status}`}>{label}</span></div>
   <div className="refill-qty-grid-v4">{request.items.map(i=><div key={i.productId}><span>{i.name}</span><strong>{i.quantity}<small>ຖ້ວຍ</small></strong></div>)}<div className="total"><span>ລວມ</span><strong>{total}<small>ຖ້ວຍ</small></strong></div></div>
   <div className="refill-card-meta-v4"><span>{request.phone}</span><span>{request.requestedAt}</span></div>
   {request.note&&<div className="refill-note-v4">{request.note}</div>}
   {canManage&&<div className="refill-card-action-v4"><RefillStatusButton id={request.id} status={request.status} enabled={enabled}/></div>}
  </article>})}</section>:<EmptyState icon="search" title={items.length?"ບໍ່ພົບຄຳຂໍເຕີມສິນຄ້າທີ່ກົງກັນ":"ບໍ່ມີຄຳຂໍເຕີມສິນຄ້າຄ້າງ"} description={items.length?"ລອງປ່ຽນຄຳຄົ້ນຫາ ຫຼືຕົວກອງ":"ຄຳຂໍໃໝ່ຈະປາກົດທີ່ນີ້ ເມື່ອມີຮ້ານຕ້ອງເຕີມສິນຄ້າ."} action={items.length&&(q||tab!=="all")?<button type="button" className="button button-secondary" onClick={()=>{setQ("");setTab("all");}}>ລ້າງຕົວກອງ</button>:!items.length&&enabled&&canManage?<Link href="/refills/new" className="button button-primary">+ ສ້າງຄຳຂໍເຕີມສິນຄ້າ</Link>:undefined}/>}
 </>;
}
