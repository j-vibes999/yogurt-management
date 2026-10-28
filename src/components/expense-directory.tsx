"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect,useMemo,useRef,useState,useTransition } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Paperclip,ArrowUpDown,X } from "lucide-react";
import { flexRender,getCoreRowModel,getSortedRowModel,useReactTable,type ColumnDef,type SortingState } from "@tanstack/react-table";
import { usePersistedFilter } from "@/lib/use-persisted-filter";
import { ExpenseEditForm,ExpenseVoidButton,type EditableExpense } from "@/components/expense-management";
import { ListToolbar,FilterChips } from "@/components/list-toolbar";
import { EmptyState } from "@/components/empty-state";
import { useModalScrollLock } from "@/lib/modal-scroll-lock";
import { businessDateString } from "@/lib/date-only";
const categoryLabel:Record<string,string>={electricity:"ຄ່າໄຟ",fuel:"ຄ່ານ້ຳມັນ",transport:"ຄ່າຂົນສົ່ງ",maintenance:"ຄ່າສ້ອມແປງ",other:"ອື່ນໆ"};
type E={id:string;incurredAt:string;incurredAtIso:string;label:string;category:string;storeName:string|null;storeId:string|null;amount:number;note:string|null;receiptUrl:string|null};type StoreOption={id:string;name:string};
const labels:Record<string,string>={incurredAtIso:"ວັນທີ",label:"ລາຍການ",category:"ໝວດ",storeName:"ຮ້ານ",amount:"ຈຳນວນ",receiptUrl:"ຫຼັກຖານ",actions:"ຈັດການ"};
type ServerList={page:number;pageCount:number;total:number;query:string;filter:string;counts?:Record<string,number>};
function listHref(query:string,filter:string,page:number){const params=new URLSearchParams({filter,page:String(page)});if(query.trim())params.set("q",query.trim());return `/expenses?${params}`}
export function ExpenseDirectory({expenses,stores,enabled,server}:{expenses:E[];stores:StoreOption[];enabled:boolean;server?:ServerList}){
 const router=useRouter();const[pending,startTransition]=useTransition();const previousQuery=useRef(server?.query??"");const serverQuery=server?.query,serverFilter=server?.filter;
 const editTrigger=useRef<HTMLButtonElement|null>(null);const editingBusyRef=useRef(false);const[editingBusy,setEditingBusy]=useState(false);
 function updateEditingBusy(value:boolean){editingBusyRef.current=value;setEditingBusy(value)}
 function closeEditor(){if(!editingBusyRef.current)setEditing(null)}
 const[q,setQ]=useState(server?.query??"");const[f,setF]=usePersistedFilter("yogu:filter:expenses","all",["all","month","electricity","transport","maintenance"] as const);const[editing,setEditing]=useState<E|null>(null);const[sorting,setSorting]=useState<SortingState>([{id:"incurredAtIso",desc:true}]);
 const filter=serverFilter??f;
 useEffect(()=>{if(serverQuery===undefined)return;const previous=previousQuery.current;previousQuery.current=serverQuery;setQ(current=>current===previous?serverQuery:current)},[serverQuery]);
 useEffect(()=>{if(serverFilter===undefined||pending||q.trim()===serverQuery)return;const timer=window.setTimeout(()=>startTransition(()=>router.replace(listHref(q,serverFilter,1),{scroll:false})),300);return()=>window.clearTimeout(timer)},[q,serverQuery,serverFilter,pending,router]);
 function changeFilter(value:string){if(server)startTransition(()=>router.push(listHref(q,value,1),{scroll:false}));else setF(value)}
 function resetFilters(){setQ("");if(server)startTransition(()=>router.push(listHref("","all",1),{scroll:false}));else setF("all")}
 const rows=useMemo(()=>{if(server)return expenses;const n=q.trim().toLowerCase();const ym=businessDateString().slice(0,7);return expenses.filter(x=>{const cat=x.category.trim().toLowerCase();const matchCategory=f==="all"||(f==="month"&&businessDateString(new Date(x.incurredAtIso)).startsWith(ym))||(f==="electricity"&&(cat==="electricity"||cat==="ຄ່າໄຟ"))||(f==="maintenance"&&(cat==="maintenance"||cat==="ຄ່າສ້ອມແປງ"))||(f==="transport"&&["fuel","transport","ຄ່ານ້ຳມັນ","ຄ່າຂົນສົ່ງ"].includes(cat));return matchCategory&&(!n||[x.label,x.category,x.storeName??"",x.note??"",x.incurredAt].join(" ").toLowerCase().includes(n))})},[expenses,q,f,server]);
 const columns=useMemo<ColumnDef<E>[]>(()=>[
  {accessorKey:"incurredAtIso",header:"ວັນທີ",cell:({row})=>row.original.incurredAt},
  {accessorKey:"label",header:"ລາຍການ",cell:({row})=><><strong>{row.original.label}</strong><div className="store-meta">{row.original.note??"—"}</div></>},
  {accessorKey:"category",header:"ໝວດ",cell:({getValue})=>categoryLabel[getValue<string>()]??getValue<string>()},
  {accessorKey:"storeName",header:"ຮ້ານ",cell:({getValue})=>getValue<string|null>()??"ລວມທຸລະກິດ"},
  {accessorKey:"amount",header:"ຈຳນວນ",cell:({getValue})=><strong>{getValue<number>().toLocaleString()} LAK</strong>},
  {accessorKey:"receiptUrl",header:"ຫຼັກຖານ",enableSorting:false,cell:({getValue})=>{const url=getValue<string|null>();return url?<a className="button button-ghost" href={url} target="_blank" rel="noreferrer"><Paperclip size={15} aria-hidden="true"/> ເບິ່ງ</a>:"—"}},
  {id:"actions",header:"",enableSorting:false,cell:({row})=><div className="table-actions-v4"><button className="button button-ghost" type="button" onClick={event=>{editTrigger.current=event.currentTarget;setEditing(row.original)}}>ແກ້ໄຂ</button><ExpenseVoidButton id={row.original.id} enabled={enabled}/></div>},
 ],[enabled]);
 const table=useReactTable({data:rows,columns,state:{sorting},onSortingChange:setSorting,defaultColumn:{enableSorting:!server},manualSorting:Boolean(server),getCoreRowModel:getCoreRowModel(),getSortedRowModel:getSortedRowModel()});
 const editExpense:EditableExpense|null=editing?{id:editing.id,category:editing.category,amount:editing.amount,incurredAt:businessDateString(new Date(editing.incurredAtIso)),storeId:editing.storeId,storeName:editing.storeName,note:editing.note,receiptUrl:editing.receiptUrl}:null;
 useModalScrollLock(Boolean(editing));
 return <><ListToolbar query={q} onQuery={setQ} placeholder="ຄົ້ນຫາລາຍຈ່າຍ, ຮ້ານ, ໝາຍເຫດ…" resultText={pending?"ກຳລັງຄົ້ນຫາ…":`${server?.total??rows.length} ລາຍການ`}><FilterChips value={filter} onChange={changeFilter} items={[{key:"all",label:"ທັງໝົດ"},{key:"month",label:"ເດືອນນີ້"},{key:"electricity",label:"ຄ່າໄຟ"},{key:"transport",label:"ຂົນສົ່ງ"},{key:"maintenance",label:"ສ້ອມແປງ"}]}/></ListToolbar>
 {rows.length?<div className="table-wrap responsive-card-table-v32"><table><thead>{table.getHeaderGroups().map(g=><tr key={g.id}>{g.headers.map(h=>{const sorted=h.column.getIsSorted();return <th key={h.id} aria-sort={sorted==="asc"?"ascending":sorted==="desc"?"descending":"none"}>{h.column.getCanSort()?<button type="button" className="table-sort-button-v42" onClick={h.column.getToggleSortingHandler()}>{flexRender(h.column.columnDef.header,h.getContext())}<ArrowUpDown size={14} aria-hidden="true"/></button>:flexRender(h.column.columnDef.header,h.getContext())}</th>})}</tr>)}</thead><tbody>{table.getRowModel().rows.map(row=><tr key={row.original.id}>{row.getVisibleCells().map(cell=><td key={cell.id} data-label={labels[cell.column.id]}>{flexRender(cell.column.columnDef.cell,cell.getContext())}</td>)}</tr>)}</tbody></table></div>:<EmptyState icon="search" title="ບໍ່ພົບລາຍຈ່າຍທີ່ກົງກັນ" description="ລອງປ່ຽນຄຳຄົ້ນຫາ ຫຼືຕົວກອງ" action={(q||filter!=="all")?<button type="button" className="button button-secondary" onClick={resetFilters}>ລ້າງຕົວກອງ</button>:undefined}/>}
 {server&&server.pageCount>1&&<nav className="form-actions" aria-label="ໜ້າລາຍຈ່າຍ">
  {server.page>1&&<Link className="button button-secondary" href={listHref(server.query,server.filter,server.page-1)}>ກ່ອນໜ້າ</Link>}
  <span>ໜ້າ {server.page}/{server.pageCount}</span>
  {server.page<server.pageCount&&<Link className="button button-secondary" href={listHref(server.query,server.filter,server.page+1)}>ຖັດໄປ</Link>}
 </nav>}
 <Dialog.Root open={Boolean(editing)} onOpenChange={next=>{if(!next)closeEditor()}}>
  {editing&&editExpense&&(
   <Dialog.Portal>
    <Dialog.Overlay className="expense-edit-backdrop-v22"/>
    <Dialog.Content
     className="expense-edit-modal-v22 workspace-color-page color-domain-finance color-panel"
     aria-describedby={undefined}
     onEscapeKeyDown={event=>{if(editingBusyRef.current)event.preventDefault()}}
     onPointerDownOutside={event=>{if(editingBusyRef.current)event.preventDefault()}}
     onCloseAutoFocus={event=>{event.preventDefault();requestAnimationFrame(()=>editTrigger.current?.focus({preventScroll:true}))}}
     onOpenAutoFocus={(event)=>{
      event.preventDefault();
      requestAnimationFrame(()=>document.querySelector<HTMLElement>('[data-expense-edit-autofocus]')?.focus({preventScroll:true}));
     }}
    >
     <div className="expense-edit-modal-head-v22 color-panel-heading">
      <div><span className="panel-kicker">ລາຍຈ່າຍ</span><Dialog.Title asChild><h2>ແກ້ໄຂລາຍຈ່າຍ</h2></Dialog.Title></div>
      <Dialog.Close asChild disabled={editingBusy}><button type="button" className="modal-close" aria-label="ປິດ" disabled={editingBusy}><X size={18} aria-hidden="true"/></button></Dialog.Close>
     </div>
     <ExpenseEditForm expense={editExpense} stores={stores} enabled={enabled} modal onCancel={closeEditor} onSaved={()=>setEditing(null)} onBusyChange={updateEditingBusy}/>
    </Dialog.Content>
   </Dialog.Portal>
  )}
 </Dialog.Root></>;
}
