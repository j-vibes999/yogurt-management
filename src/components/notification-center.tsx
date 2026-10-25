"use client";
import Link from "next/link";
import { usePersistedFilter } from "@/lib/use-persisted-filter";
import { EmptyState } from "@/components/empty-state";

type Alert={id:string;type:"urgent"|"warning"|"info";title:string;detail:string;href:string};
export function NotificationCenter({alerts}:{alerts:Alert[]}){
  const [mode,setMode]=usePersistedFilter("yogu:notifications:focus","all",["all","focus","urgent"]);
  const rows=alerts.filter(a=>mode==="all"||(mode==="focus"&&a.type!=="info")||a.type==="urgent");
  return <>
    <div className="notification-preferences-v42" aria-label="ຕົວກອງການແຈ້ງເຕືອນ">
      <span>ສະແດງ:</span>
      <div className="filter-chips-v1">
        <button type="button" className={mode==="all"?"is-active":""} onClick={()=>setMode("all")}>ທັງໝົດ</button>
        <button type="button" className={mode==="focus"?"is-active":""} onClick={()=>setMode("focus")}>ດ່ວນ + ຕິດຕາມ</button>
        <button type="button" className={mode==="urgent"?"is-active":""} onClick={()=>setMode("urgent")}>ດ່ວນເທົ່ານັ້ນ</button>
      </div>
      <small>ລະບົບຈະຈື່ຕົວເລືອກນີ້ໃນ browser ນີ້</small>
    </div>
    {rows.length?<section className="notification-list-v4">{rows.map(alert=><Link prefetch={false} href={alert.href} key={alert.id} className={`notification-card-v4 ${alert.type}`}><span className="notification-icon-v4" aria-hidden="true">{alert.type==="urgent"?"!":alert.type==="warning"?"△":"i"}</span><span className="notification-copy-v4"><strong>{alert.title}</strong><span>{alert.detail}</span></span><span className="notification-action-v4">ເປີດ <b>→</b></span></Link>)}</section>:<EmptyState icon="inbox" title="ບໍ່ມີແຈ້ງເຕືອນໃນມຸມມອງນີ້" description="ລອງປ່ຽນຕົວກອງການແຈ້ງເຕືອນ"/>}
  </>;
}
