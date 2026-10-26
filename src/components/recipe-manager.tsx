"use client";

import { showToast } from "@/lib/toast";import {useMemo,useState} from "react";import{useRouter}from"next/navigation";
import { operationFetch } from "@/lib/operation-request";
import type { RecipeRequest } from "@/lib/stock-validation";
type Product={id:string;name:string;code:string;recipe?:{id:string;name:string;baseCups:number;version:number;items:{rawMaterialId:string;quantity:number}[]}};type Material={id:string;name:string;unit:string};type RecipeRow={rawMaterialId:string;quantity:string};
export function RecipeManager({products,materials}:{products:Product[];materials:Material[]}){const router=useRouter(),[productId,setProductId]=useState(products[0]?.id||""),[rows,setRows]=useState<RecipeRow[]>(()=>products[0]?.recipe?.items.map(i=>({...i,quantity:String(i.quantity)}))??[]),[baseCups,setBaseCups]=useState(String(products[0]?.recipe?.baseCups??100)),[name,setName]=useState(products[0]?.recipe?.name??products[0]?.name??""),[error,setError]=useState(""),[success,setSuccess]=useState(""),[busy,setBusy]=useState(false);const current=useMemo(()=>products.find(p=>p.id===productId),[products,productId]);
 function choose(id:string){setProductId(id);const p=products.find(x=>x.id===id);setRows(p?.recipe?.items.map(i=>({...i,quantity:String(i.quantity)}))??[]);setBaseCups(String(p?.recipe?.baseCups??100));setName(p?.recipe?.name??p?.name??"")}
 async function save(){
  if(busy)return;
  if(!current||!rows.length)return setError("ຕ້ອງມີວັດຖຸດິບຢ່າງໜ້ອຍ 1 ລາຍການ");
  const baseCupsValue=Number(baseCups);
  const items=rows.map(row=>({rawMaterialId:row.rawMaterialId,quantityRequired:Number(row.quantity)}));
  if(!Number.isInteger(baseCupsValue)||baseCupsValue<1||baseCupsValue>2147483647)return setError("ຈຳນວນຖ້ວຍຖານຕ້ອງເປັນຈຳນວນເຕັມ ແລະຫຼາຍກວ່າ 0");
  if(items.some(row=>!row.rawMaterialId||!Number.isFinite(row.quantityRequired)||row.quantityRequired<0.0001||row.quantityRequired>=10000000000||Number(row.quantityRequired.toFixed(4))!==row.quantityRequired))return setError("ຈຳນວນວັດຖຸດິບຕ້ອງຢ່າງໜ້ອຍ 0.0001 ແລະມີທົດສະນິຍົມບໍ່ເກີນ 4 ຕຳແໜ່ງ");
  if(new Set(items.map(row=>row.rawMaterialId)).size!==items.length)return setError("ວັດຖຸດິບໃນສູດຫ້າມຊ້ຳ");
  const payload:RecipeRequest={recipeId:current.recipe?.id,finishedProductId:current.id,name,baseCups:baseCupsValue,items};
  setBusy(true);setError("");setSuccess("");
  try{
   const r=await operationFetch('/api/recipes',payload);const d=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(d.error||'ບັນທຶກສູດບໍ່ສຳເລັດ');
   setSuccess(`ບັນທຶກສູດສຳເລັດ · v${d.version}`);showToast({tone:'success',title:'ບັນທຶກສູດສຳເລັດ'});router.refresh()
  }catch(caught){setError(caught instanceof Error?caught.message:'ບັນທຶກສູດບໍ່ສຳເລັດ')}finally{setBusy(false)}
 }
 return <div className="card form-card recipe-manager-v25 color-panel color-domain-refills"><div className="panel-head color-panel-heading"><div><span className="panel-kicker">ສູດການຜະລິດ</span><h2>ຈັດການສູດ</h2></div></div><div className="form-grid form-grid-2"><label className="field"><span>ສິນຄ້າ</span><select className="form-control" value={productId} onChange={e=>choose(e.target.value)}>{products.map(p=><option key={p.id} value={p.id}>{p.name} · {p.code}{p.recipe?` · v${p.recipe.version}`:' · ຍັງບໍ່ມີສູດ'}</option>)}</select></label><label className="field"><span>ຈຳນວນຖ້ວຍຖານ</span><input className="form-control" type="number" min="1" value={baseCups} onChange={e=>setBaseCups(e.target.value)}/></label><label className="field form-span-2"><span>ຊື່ສູດ</span><input className="form-control" value={name} onChange={e=>setName(e.target.value)}/></label></div><div style={{marginTop:14}}>{rows.map((row,index)=><div className="form-grid form-grid-2" key={index} style={{marginBottom:8}}><select className="form-control" aria-label={`ວັດຖຸດິບແຖວທີ ${index+1}`} value={row.rawMaterialId} onChange={e=>setRows(v=>v.map((x,i)=>i===index?{...x,rawMaterialId:e.target.value}:x))}><option value="">ເລືອກວັດຖຸດິບ</option>{materials.map(m=><option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}</select><div style={{display:'flex',gap:8}}><input className="form-control" type="number" min="0.0001" step="0.0001" aria-label={`ຈຳນວນທີ່ໃຊ້ຕໍ່ສູດ ແຖວທີ ${index+1}`} value={row.quantity} onChange={e=>setRows(v=>v.map((x,i)=>i===index?{...x,quantity:e.target.value}:x))}/><button type="button" className="button button-ghost" aria-label={`ລຶບວັດຖຸດິບແຖວທີ ${index+1}`} title="ລຶບແຖວນີ້" onClick={()=>setRows(v=>v.filter((_,i)=>i!==index))}><span aria-hidden="true">×</span></button></div></div>)}</div><button type="button" className="button button-secondary" onClick={()=>setRows(v=>[...v,{rawMaterialId:materials[0]?.id||'',quantity:"1"}])}>+ ວັດຖຸດິບ</button>{error&&<div className="notice form-error" style={{marginTop:10}}><strong>ບັນທຶກບໍ່ສຳເລັດ</strong><br/>{error}</div>}{success&&<div className="notice form-success-v1" style={{marginTop:10}}>{success}</div>}<div className="form-actions"><button type="button" className="button button-primary" disabled={busy||!current||!rows.length} onClick={save}>{busy?'ກຳລັງບັນທຶກ...':current?.recipe?'ສ້າງສະບັບໃໝ່':'ສ້າງສູດຄັ້ງທຳອິດ'}</button></div></div>
}
