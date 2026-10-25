"use client";
import { type ReactNode } from "react";
export function ListToolbar({query,onQuery,placeholder,children,resultText}:{query:string;onQuery:(v:string)=>void;placeholder:string;children?:ReactNode;resultText?:string}){
 return <div className="list-toolbar-v1">
   <label className="list-search-v1"><span aria-hidden="true">⌕</span><input value={query} onChange={e=>onQuery(e.target.value)} placeholder={placeholder} aria-label={placeholder} enterKeyHint="search"/>{query&&<button type="button" onClick={()=>onQuery("")} aria-label="ລ້າງຄຳຄົ້ນຫາ">×</button>}</label>
   {children}
   {resultText&&<span className="list-result-v1" role="status" aria-live="polite" aria-atomic="true">{resultText}</span>}
 </div>
}
export function FilterChips({items,value,onChange}:{items:{key:string;label:string;count?:number}[];value:string;onChange:(v:string)=>void}){
 return <div className="filter-chips-v1">{items.map(i=><button type="button" key={i.key} className={value===i.key?"is-active":undefined} aria-pressed={value===i.key} onClick={()=>onChange(i.key)}>{i.label}{i.count!==undefined&&<span>{i.count}</span>}</button>)}</div>
}
