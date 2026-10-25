"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { InlineFeedback } from "@/components/inline-feedback";
import { persistToast } from "@/lib/toast";
import { operationFetch } from "@/lib/operation-request";
import type { MaterialUpdateRequest } from "@/lib/stock-validation";

type MaterialEditable = { id:string; name:string; unit:string; stock:number; minStock:number; avgCostPerUnit:number };
const materialSchema=z.object({stock:z.number().min(0,"ຈຳນວນຄົງເຫຼືອຫ້າມຕິດລົບ"),price:z.number().min(0,"ລາຄາຫ້າມຕິດລົບ"),stockReason:z.string().trim()});
type MaterialForm=z.infer<typeof materialSchema>;
function cleanNumber(value:number){return value.toLocaleString(undefined,{maximumFractionDigits:6})}

export function MaterialEditButton({material}:{material:MaterialEditable}){
 const router=useRouter(); const[open,setOpen]=useState(false); const[error,setError]=useState("");const[snapshot,setSnapshot]=useState(material);
 const {register,handleSubmit,reset,watch,setError:setFieldError,formState:{errors,isSubmitting}}=useForm<MaterialForm>({resolver:zodResolver(materialSchema),defaultValues:{stock:material.stock,price:material.avgCostPerUnit,stockReason:""}});
 const stockChanged=watch("stock")!==snapshot.stock;
 const show=()=>{setSnapshot({...material});reset({stock:material.stock,price:material.avgCostPerUnit,stockReason:""});setError("");setOpen(true)};
 const save=handleSubmit(async(values)=>{
  setError("");
  const payload:MaterialUpdateRequest={action:"update_material",rawMaterialId:snapshot.id};
  if(values.stock!==snapshot.stock){
   if(!values.stockReason){setFieldError("stockReason",{type:"required",message:"ກະລຸນາໃສ່ເຫດຜົນເມື່ອປ່ຽນຈຳນວນຄົງເຫຼືອ"});return}
   payload.stock=values.stock;payload.expectedStock=snapshot.stock;payload.stockReason=values.stockReason;
  }
  if(values.price!==snapshot.avgCostPerUnit)payload.avgCostPerUnit=values.price;
  if(payload.stock===undefined&&payload.avgCostPerUnit===undefined){setOpen(false);return}
  try{
   const response=await operationFetch("/api/inventory/adjust",payload);
   const data=await response.json().catch(()=>({})) as {error?:string;stock?:number;avgCostPerUnit?:number};
   if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);
   setOpen(false);persistToast({tone:"success",title:"ບັນທຶກສຳເລັດ",message:`${snapshot.name} · ${cleanNumber(data.stock??values.stock)} ${snapshot.unit} · ${(data.avgCostPerUnit??values.price).toLocaleString(undefined,{maximumFractionDigits:4})} LAK/${snapshot.unit}`});router.refresh()
  }catch(caught){setError(caught instanceof Error?caught.message:"ບັນທຶກບໍ່ສຳເລັດ")}
 });
 return <>
  <button type="button" className="button button-ghost material-edit-trigger-v1" onClick={show}>ຈັດການ</button>
  <Dialog.Root open={open} onOpenChange={(next)=>{if(!isSubmitting)setOpen(next)}}><Dialog.Portal>
   <Dialog.Overlay className="modal-backdrop" />
   <div className="material-dialog-positioner-v43"><Dialog.Content className="card material-edit-modal-v1 stock-adjust-modal-v16 material-simple-edit-v18" onEscapeKeyDown={e=>{if(isSubmitting)e.preventDefault()}} onPointerDownOutside={e=>{if(isSubmitting)e.preventDefault()}}>
    <div className="panel-head"><div><span className="panel-kicker">ວັດຖຸດິບ</span><Dialog.Title asChild><h2>{material.name}</h2></Dialog.Title><Dialog.Description asChild><p>ແກ້ຈຳນວນຄົງເຫຼືອ ແລະລາຄາໄດ້ໃນໜ້າດຽວ</p></Dialog.Description></div><Dialog.Close asChild><button type="button" className="modal-close" disabled={isSubmitting} aria-label="ປິດ"><X size={18} aria-hidden="true"/></button></Dialog.Close></div>
    <form onSubmit={save} noValidate>
     <div className="material-simple-grid-v18"><label className="field"><span>ຈຳນວນຄົງເຫຼືອ ({snapshot.unit})</span><input data-dialog-autofocus className="form-control material-simple-input-v18" {...register("stock",{valueAsNumber:true})} aria-invalid={!!errors.stock} inputMode="decimal" type="number" min="0" step="0.000001"/><small>ຕອນເປີດ {cleanNumber(snapshot.stock)} {snapshot.unit}</small>{errors.stock&&<small className="field-error" role="alert">{errors.stock.message}</small>}</label>
     <label className="field"><span>ລາຄາຕໍ່ {snapshot.unit} (LAK)</span><input className="form-control material-simple-input-v18" {...register("price",{valueAsNumber:true})} aria-invalid={!!errors.price} inputMode="decimal" type="number" min="0" step="0.0001"/><small>ຕອນເປີດ {snapshot.avgCostPerUnit.toLocaleString(undefined,{maximumFractionDigits:4})} LAK/{snapshot.unit}</small>{errors.price&&<small className="field-error" role="alert">{errors.price.message}</small>}</label></div>
     {stockChanged&&<label className="field"><span>ເຫດຜົນທີ່ປັບຈຳນວນຄົງເຫຼືອ *</span><input className="form-control" {...register("stockReason")} aria-invalid={!!errors.stockReason}/><small>ການປັບນີ້ຈະຖືກບັນທຶກໃນປະຫວັດວັດຖຸດິບ</small>{errors.stockReason&&<small className="field-error" role="alert">{errors.stockReason.message}</small>}</label>}
     {error&&<InlineFeedback tone="error" title="ບັນທຶກບໍ່ສຳເລັດ">{error}</InlineFeedback>}
     <div className="form-actions"><Dialog.Close asChild><button type="button" className="button button-secondary" disabled={isSubmitting}>ຍົກເລີກ</button></Dialog.Close><button type="submit" className="button button-primary" aria-busy={isSubmitting} disabled={isSubmitting}>{isSubmitting?"ກຳລັງບັນທຶກ...":"ບັນທຶກ"}</button></div>
    </form>
   </Dialog.Content></div>
  </Dialog.Portal></Dialog.Root>
 </>;
}
