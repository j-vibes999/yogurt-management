"use client";
import { useMemo,useState } from "react";
import { ArrowUpDown } from "lucide-react";
import { flexRender,getCoreRowModel,getSortedRowModel,useReactTable,type ColumnDef,type SortingState } from "@tanstack/react-table";
import { usePersistedFilter } from "@/lib/use-persisted-filter";
import { MaterialEditButton } from "@/components/material-edit-button";
import { ListToolbar,FilterChips } from "@/components/list-toolbar";
import { EmptyState } from "@/components/empty-state";
type M={id:string;code:string;name:string;category:string;unit:string;stock:number;minStock:number;avgCost:number};
const labels:Record<string,string>={name:"ວັດຖຸດິບ",category:"ປະເພດ",stock:"ຄົງເຫຼືອ",avgCost:"ຕົ້ນທຶນ",status:"ສະຖານະ",actions:"ຈັດການ"};
const quantityFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });
const costFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
export function InventoryDirectory({materials}:{materials:M[]}){
 const[q,setQ]=useState("");const[f,setF]=usePersistedFilter("yogu:filter:inventory","all",["all","critical","low","ok","ingredient","packaging"] as const);const[expanded,setExpanded]=useState(false);const[sorting,setSorting]=useState<SortingState>([]);
 const rows=useMemo(()=>{const n=q.trim().toLowerCase();return materials.filter(x=>{const critical=x.stock<=x.minStock,low=x.stock<=x.minStock*1.5;const fm=f==="all"||(f==="critical"&&critical)||(f==="low"&&low&&!critical)||(f==="ok"&&!low)||(f==="ingredient"&&x.category!=="packaging")||(f==="packaging"&&x.category==="packaging");return fm&&(!n||[x.name,x.code,x.unit].join(" ").toLowerCase().includes(n))})},[materials,q,f]);
 const c={all:materials.length,critical:materials.filter(x=>x.stock<=x.minStock).length,low:materials.filter(x=>x.stock>x.minStock&&x.stock<=x.minStock*1.5).length,ok:materials.filter(x=>x.stock>x.minStock*1.5).length};
 const columns=useMemo<ColumnDef<M>[]>(()=>[
  {accessorKey:"name",header:"ວັດຖຸດິບ",cell:({row})=><><strong>{row.original.name}</strong><div className="store-meta">{row.original.code}</div></>},
  {accessorKey:"category",header:"ປະເພດ",cell:({getValue})=>getValue<string>()==="packaging"?"ບັນຈຸພັນ":"ວັດຖຸດິບ"},
  {accessorKey:"stock",header:"ຄົງເຫຼືອ",cell:({row})=><><strong>{quantityFormat.format(row.original.stock)} {row.original.unit}</strong><div className="store-meta">ຈຸດເຕືອນ {quantityFormat.format(row.original.minStock)} {row.original.unit}</div></>},
  {accessorKey:"avgCost",header:"ຕົ້ນທຶນ",cell:({row})=>`${costFormat.format(row.original.avgCost)} LAK/${row.original.unit}`},
  {id:"status",header:"ສະຖານະ",accessorFn:row=>row.stock<=row.minStock?0:row.stock<=row.minStock*1.5?1:2,cell:({row})=>{const critical=row.original.stock<=row.original.minStock,low=row.original.stock<=row.original.minStock*1.5;return <span className={`badge ${critical?"badge-danger":low?"badge-warning":"badge-success"}`}>{critical?"ຕ້ອງເຕີມ":low?"ໃກ້ໝົດ":"ພຽງພໍ"}</span>}},
  {id:"actions",header:"",enableSorting:false,cell:({row})=><MaterialEditButton material={{id:row.original.id,name:row.original.name,unit:row.original.unit,stock:row.original.stock,minStock:row.original.minStock,avgCostPerUnit:row.original.avgCost}}/>},
 ],[]);
 const table=useReactTable({data:rows,columns,state:{sorting},onSortingChange:setSorting,getCoreRowModel:getCoreRowModel(),getSortedRowModel:getSortedRowModel()});
 return <><ListToolbar query={q} onQuery={setQ} placeholder="ຄົ້ນຫາວັດຖຸດິບ, ລະຫັດ..." resultText={`${rows.length} ລາຍການ`}><FilterChips value={f} onChange={setF} items={[{key:"all",label:"ທັງໝົດ",count:c.all},{key:"critical",label:"ຕ້ອງເຕີມ",count:c.critical},{key:"low",label:"ໃກ້ໝົດ",count:c.low},{key:"ok",label:"ພຽງພໍ",count:c.ok},{key:"ingredient",label:"ວັດຖຸດິບ"},{key:"packaging",label:"ບັນຈຸພັນ"}]}/></ListToolbar>
 {rows.length?<div className={`table-wrap responsive-card-table-v32 progressive-list-v33 ${expanded?"is-expanded":""}`}><table><thead>{table.getHeaderGroups().map(g=><tr key={g.id}>{g.headers.map(h=>{const sorted=h.column.getIsSorted();return <th key={h.id} aria-sort={sorted==="asc"?"ascending":sorted==="desc"?"descending":"none"}>{h.column.getCanSort()?<button type="button" className="table-sort-button-v42" onClick={h.column.getToggleSortingHandler()}>{flexRender(h.column.columnDef.header,h.getContext())}<ArrowUpDown size={14} aria-hidden="true"/></button>:flexRender(h.column.columnDef.header,h.getContext())}</th>})}</tr>)}</thead><tbody>{table.getRowModel().rows.map(row=><tr key={row.original.id}>{row.getVisibleCells().map(cell=><td key={cell.id} data-label={labels[cell.column.id]}>{flexRender(cell.column.columnDef.cell,cell.getContext())}</td>)}</tr>)}</tbody></table></div>:<EmptyState icon="search" title="ບໍ່ພົບວັດຖຸດິບທີ່ກົງກັນ" description="ລອງປ່ຽນຄຳຄົ້ນຫາ ຫຼືຕົວກອງ" action={(q||f!=="all")?<button type="button" className="button button-secondary" onClick={()=>{setQ("");setF("all")}}>ລ້າງຕົວກອງ</button>:undefined}/>} {rows.length>5&&<button type="button" className="progressive-toggle-v33" onClick={()=>setExpanded(v=>!v)}>{expanded?"ຍໍ້ລາຍການ":"ເບິ່ງທັງໝົດ"} · {rows.length} ລາຍການ</button>}</>;
}
