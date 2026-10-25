"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from "@tanstack/react-table";
import { ArrowUpDown } from "lucide-react";
import { usePersistedFilter } from "@/lib/use-persisted-filter";
import { ListToolbar, FilterChips } from "@/components/list-toolbar";
import { EmptyState } from "@/components/empty-state";
import { latestSettlementsByStore } from "@/lib/latest-settlements";

type S = { id:string; storeId:string; storeName:string; periodLabel:string; gross:number; commission:number; net:number; paid:number; closingBalance:number; status:string; cheeseSold:number; mangoSold:number };
const moneyFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits:2 });
const fmt = (value:number) => moneyFormat.format(value);
const labels: Record<string,string> = { storeName:"ຮ້ານ", periodLabel:"ຮອບ", gross:"ຍອດຂາຍ", net:"ສ່ວນເຮົາ", paid:"ຮັບແລ້ວ", closingBalance:"ຄົງຄ້າງ", status:"ສະຖານະ" };

type ServerList = { page:number; pageCount:number; total:number; query:string; filter:string; counts?:Record<string,number> };
function listHref(query:string,filter:string,page:number) {
  const params=new URLSearchParams({filter,page:String(page)});
  if(query.trim())params.set("q",query.trim());
  return `/settlements?${params}`;
}
export function SettlementDirectory({ items, enabled, server }:{ items:S[]; enabled:boolean; server?:ServerList }) {
  const router = useRouter();
  const [q,setQ] = useState(server?.query??"");
  const previousQuery=useRef(server?.query??"");
  const [pending,startTransition]=useTransition();
  const serverQuery=server?.query,serverFilter=server?.filter;
  const [f,setF] = usePersistedFilter("yogu:filter:settlements", "pending", ["pending","partial","paid","all"] as const);
  const filter=serverFilter??f;
  useEffect(()=>{if(serverQuery===undefined)return;const previous=previousQuery.current;previousQuery.current=serverQuery;setQ(current=>current===previous?serverQuery:current)},[serverQuery]);
  useEffect(()=>{
    if(serverFilter===undefined||pending||q.trim()===serverQuery)return;
    const timer=window.setTimeout(()=>startTransition(()=>router.replace(listHref(q,serverFilter,1),{scroll:false})),300);
    return()=>window.clearTimeout(timer);
  },[q,serverQuery,serverFilter,pending,router]);
  function changeFilter(value:string){if(server)startTransition(()=>router.push(listHref(q,value,1),{scroll:false}));else setF(value)}
  function resetFilters(){setQ("");if(server)startTransition(()=>router.push(listHref("","pending",1),{scroll:false}));else setF("pending")}
  const [sorting,setSorting] = useState<SortingState>([]);
  const latest = useMemo(() => server?[]:latestSettlementsByStore(items), [items,server]);
  const rows = useMemo(() => {
    if(server)return items;
    const n=q.trim().toLowerCase();
    return (f==="all"?items:latest).filter((x) => {
      const fm=f==="all" || (f==="pending"&&x.closingBalance>0) || (f==="paid"&&x.closingBalance<=0) || (f==="partial"&&x.status==="partial");
      return fm && (!n || [x.storeName,x.id,x.periodLabel].join(" ").toLowerCase().includes(n));
    });
  }, [items,latest,q,f,server]);
  const counts = server ? server.counts??{} : {
    pending:latest.filter((x)=>x.closingBalance>0).length,
    paid:latest.filter((x)=>x.closingBalance<=0).length,
    partial:latest.filter((x)=>x.status==="partial").length,
    all:items.length,
  };
  const columns = useMemo<ColumnDef<S>[]>(() => [
    { accessorKey:"storeName", header:"ຮ້ານ", cell:({row}) => <>{enabled?<Link prefetch={false} className="store-name-link-v1" href={`/driver/restock/${row.original.storeId}?mode=payment`}><strong>{row.original.storeName}</strong><span aria-hidden="true">↗</span></Link>:<strong>{row.original.storeName}</strong>}<div className="store-meta">{row.original.id}</div></> },
    { accessorKey:"periodLabel", header:"ຮອບ" },
    { accessorKey:"gross", header:"ຍອດຂາຍ", cell:({getValue}) => `${fmt(getValue<number>())} LAK` },
    { accessorKey:"net", header:"ສ່ວນເຮົາ", cell:({getValue}) => <strong>{fmt(getValue<number>())} LAK</strong> },
    { accessorKey:"paid", header:"ຮັບແລ້ວ", cell:({getValue}) => `${fmt(getValue<number>())} LAK` },
    { accessorKey:"closingBalance", header:"ຄົງຄ້າງ", cell:({getValue}) => { const value=getValue<number>(); return <strong className={value>0?"danger-text":"success-text"}>{fmt(value)} LAK</strong>; } },
    { accessorKey:"status", header:"ສະຖານະ", cell:({getValue}) => { const status=getValue<string>(); return <span className={`badge ${status==="paid"?"badge-success":status==="partial"?"badge-warning":"badge-danger"}`}>{status==="paid"?"ຊຳລະແລ້ວ":status==="partial"?"ບາງສ່ວນ":"ຄ້າງຊຳລະ"}</span>; } },
  ], [enabled]);
  const table = useReactTable({ data:rows, columns, state:{sorting}, onSortingChange:setSorting, defaultColumn:{enableSorting:!server}, manualSorting:Boolean(server), getCoreRowModel:getCoreRowModel(), getSortedRowModel:getSortedRowModel() });

  return <>
    <ListToolbar query={q} onQuery={setQ} placeholder={server?"ຄົ້ນຫາຮ້ານ, ເລກບິນ, ວັນທີ YYYY-MM-DD…":"ຄົ້ນຫາຮ້ານ, ເລກບິນ, ຮອບ…"} resultText={pending?"ກຳລັງຄົ້ນຫາ…":`${server?.total??rows.length} ${filter === "all" ? "ຮອບ" : "ຮ້ານ"}`}>
      <FilterChips value={filter} onChange={changeFilter} items={[{key:"pending",label:"ຄ້າງຮັບ",count:counts.pending},{key:"partial",label:"ບາງສ່ວນ",count:counts.partial},{key:"paid",label:"ຈ່າຍແລ້ວ",count:counts.paid},{key:"all",label:"ປະຫວັດທັງໝົດ",count:counts.all}]}/>
    </ListToolbar>
    <p className="panel-description">{filter === "all" ? "ປະຫວັດທຸກຮອບ; ຮ້ານດຽວອາດມີຫຼາຍລາຍການ." : "ສະແດງຮອບລ່າສຸດຕໍ່ຮ້ານຕາມສະຖານະທີ່ເລືອກ."}</p>
    {rows.length ? <div className="table-wrap responsive-card-table-v32"><table><thead>{table.getHeaderGroups().map((group)=><tr key={group.id}>{group.headers.map((header)=>{
      const sorted=header.column.getIsSorted();
      return <th key={header.id} aria-sort={sorted==="asc"?"ascending":sorted==="desc"?"descending":"none"}>{header.column.getCanSort()?<button type="button" className="table-sort-button-v42" onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header,header.getContext())}<ArrowUpDown size={14} aria-hidden="true" /></button>:flexRender(header.column.columnDef.header,header.getContext())}</th>;
    })}</tr>)}</thead><tbody>{table.getRowModel().rows.map((row)=><tr key={row.original.id} className={enabled?"settlement-row-link-v1":undefined} onClick={(event)=>{if(!enabled||(event.target as HTMLElement).closest("a,button,input,select"))return;router.push(`/driver/restock/${row.original.storeId}?mode=payment`);}} tabIndex={enabled?0:undefined} onKeyDown={(event)=>{if(enabled&&event.key==="Enter")router.push(`/driver/restock/${row.original.storeId}?mode=payment`);}}>{row.getVisibleCells().map((cell)=><td key={cell.id} data-label={labels[cell.column.id]}>{flexRender(cell.column.columnDef.cell,cell.getContext())}</td>)}</tr>)}</tbody></table></div> : <EmptyState icon="search" title="ບໍ່ພົບລາຍການຮັບເງິນທີ່ກົງກັນ" description="ລອງປ່ຽນຄຳຄົ້ນຫາ ຫຼືຕົວກອງ" action={(q||filter!=="pending")?<button type="button" className="button button-secondary" onClick={resetFilters}>ລ້າງຕົວກອງ</button>:undefined}/>}
    {server&&server.pageCount>1&&<nav className="form-actions" aria-label="ໜ້າລາຍການຮັບເງິນ">
      {server.page>1&&<Link className="button button-secondary" href={listHref(server.query,server.filter,server.page-1)}>ກ່ອນໜ້າ</Link>}
      <span>ໜ້າ {server.page}/{server.pageCount}</span>
      {server.page<server.pageCount&&<Link className="button button-secondary" href={listHref(server.query,server.filter,server.page+1)}>ຖັດໄປ</Link>}
    </nav>}
  </>;
}
