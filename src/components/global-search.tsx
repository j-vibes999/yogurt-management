"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
type Result={id:string;type:string;title:string;detail:string;href:string};
export function GlobalSearch(){
 const [q,setQ]=useState("");const [results,setResults]=useState<Result[]>([]);const [open,setOpen]=useState(false);const [loading,setLoading]=useState(false);const inputRef=useRef<HTMLInputElement>(null);
 useEffect(()=>{const h=(e:KeyboardEvent)=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();inputRef.current?.focus();setOpen(true)}if(e.key==="Escape")setOpen(false)};window.addEventListener("keydown",h);return()=>window.removeEventListener("keydown",h)},[]);
 useEffect(()=>{const query=q.trim();if(query.length<2){setResults([]);setLoading(false);return}const c=new AbortController();setLoading(true);const t=window.setTimeout(async()=>{try{const r=await fetch(`/api/search?q=${encodeURIComponent(query)}`,{signal:c.signal});const d=await r.json().catch(()=>({}));setResults(d.results??[])}catch{}finally{setLoading(false)}},180);return()=>{clearTimeout(t);c.abort()}},[q]);
 return <div className="global-search-v5">
   <span className="global-search-icon-v5"><Search size={16} aria-hidden="true" /></span>
   <input aria-label="ຄົ້ນຫາທົ່ວລະບົບ" ref={inputRef} value={q} onFocus={()=>setOpen(true)} onChange={e=>setQ(e.target.value)} placeholder="ຄົ້ນຫາ..."/>
   <kbd>⌘ K</kbd>
   {open&&q.trim().length>=2&&<div className="global-search-results-v5">{loading?<div className="search-empty-v5" role="status" aria-live="polite">ກຳລັງຄົ້ນຫາ…</div>:results.length?results.map(item=><Link key={item.id} href={item.href} onClick={()=>{setOpen(false);setQ("")}}><span>{item.type}</span><div><strong>{item.title}</strong><small>{item.detail}</small></div><b><ArrowRight size={16} aria-hidden="true" /></b></Link>):<div className="search-empty-v5">ບໍ່ພົບລາຍການ</div>}</div>}
 </div>;
}
