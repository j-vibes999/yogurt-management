"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { calculateLiveRestockLine, calculateSettlement, formatMoney } from "@/lib/business";
import { showToast } from "@/lib/toast";
import { financialStorageKeys, legacyFinancialRequests, parsePendingRequest, pendingStorage, type LegacyFinancialRequest, type PendingRequest } from "@/lib/pending-request";
import { ActionDialog } from "@/components/action-dialog";
import { moneyDecimalString, moneyNumber, parseMoneyCents, parseWholeCount, roundMoneyCents } from "@/lib/money";
import { freshOperationUser, operationFetch } from "@/lib/operation-request";
import { restockDraftContent, restoreRestockDraft } from "@/lib/restock-draft";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";

type AuditLine = { productId:string; name:string; color:string; retailPrice:number; previousStock:number; refilledSinceAudit:number };
type LineEntry = { countRemaining:string; countExpiredReturned:string; countRefilled:number };
type CompletionResult = { receiptNumber:string; previousBalance:number; paidAmount:number; closingBalance:number; paymentStatus:"paid"|"partial"|"pending" };
function isCompletionResult(value:unknown):value is CompletionResult {
  if(!value||typeof value!=="object")return false;
  const row=value as Record<string,unknown>;
  return typeof row.receiptNumber==="string"&&row.receiptNumber.length>0&&["previousBalance","paidAmount","closingBalance"].every(field=>typeof row[field]==="number"&&parseMoneyCents(row[field])!==null)&&["paid","partial","pending"].includes(String(row.paymentStatus));
}
const paymentSchema=z.object({paymentMethod:z.enum(["cash","bank"]),paidAmount:z.string().refine(v=>v.trim()===""||parseMoneyCents(v)!==null,"ຈຳນວນເງິນຕ້ອງບໍ່ຕິດລົບ ແລະມີບໍ່ເກີນ 2 ຕຳແໜ່ງ")});
type PaymentValues=z.infer<typeof paymentSchema>;
type Props = {
  store:{ id:string; name:string; commissionRate:number };
  fridge:{ assetCode:string };
  lines:AuditLine[];
  previousBalance:number;
  paymentFirst?:boolean;
};

export function RestockAuditForm({ store, fridge, lines, previousBalance, paymentFirst=false }: Props) {
  const countsId=useId();
  const [userId,setUserId]=useState<string|null>(null);
  const {draft:storageKey,payment:paymentStorageKey,visit:visitStorageKey}=financialStorageKeys(userId??"",store.id);
  const [storageNotice,setStorageNotice]=useState<string|null>(null);
  const [legacyRequests,setLegacyRequests]=useState<LegacyFinancialRequest[]>([]);
  const [reviewLegacy,setReviewLegacy]=useState(false);
  const [entries,setEntries]=useState<Record<string,LineEntry>>(()=>Object.fromEntries(lines.map(line=>[line.productId,{countRemaining:String(line.previousStock),countExpiredReturned:"0",countRefilled:line.refilledSinceAudit}])));
  const [savedContent,setSavedContent]=useState<string|null>(null);
  const [failedContent,setFailedContent]=useState<string|null>(null);
  const [draftBaseline,setDraftBaseline]=useState<string|null>(null);
  const [draftNotice,setDraftNotice]=useState<string|null>(null);
  const {register,watch,setValue,formState:{errors:paymentErrors}}=useForm<PaymentValues>({resolver:zodResolver(paymentSchema),defaultValues:{paymentMethod:"cash",paidAmount:"0"}});
  const paymentMethod=watch("paymentMethod");
  const paidAmount=watch("paidAmount");
  const [submitting,setSubmitting]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [completion,setCompletion]=useState<CompletionResult|null>(null);
  const [pendingPayment,setPendingPayment]=useState<PendingRequest|null>(null);
  const [pendingVisit,setPendingVisit]=useState<PendingRequest|null>(null);
  const [step,setStep]=useState<1|2|3>(1);
  const [stepChanged,setStepChanged]=useState(false);
  const stepHeadingRef=useRef<HTMLHeadingElement>(null);
  const errorRef=useRef<HTMLDivElement>(null);
  const draftContext=useMemo(()=>({storeId:store.id,fridgeAssetCode:fridge.assetCode,previousBalance,commissionRate:store.commissionRate,snapshot:lines.map(line=>[line.productId,line.previousStock,line.refilledSinceAudit,line.retailPrice])}),[store.id,fridge.assetCode,previousBalance,store.commissionRate,lines]);
  const draftContent=restockDraftContent(draftContext,{entries,paymentMethod,paidAmount});
  const saved=!completion&&savedContent===draftContent;
  const draftReady=Boolean(userId)&&draftBaseline!==null;
  const unsavedDraft=!completion&&draftBaseline!==null&&draftContent!==savedContent&&(draftContent!==draftBaseline||savedContent!==null||failedContent!==null);
  const {navigationDialog}=useUnsavedChanges(unsavedDraft||(!completion&&Boolean(storageNotice)&&(Boolean(pendingPayment)||Boolean(pendingVisit))));

  useEffect(()=>{if(error)errorRef.current?.focus();},[error]);

  useEffect(()=>{
    if(stepChanged&&!paymentFirst)stepHeadingRef.current?.focus();
  },[step,stepChanged,paymentFirst]);

  function goToStep(next:1|2|3){setStep(next);setStepChanged(true)}

  useEffect(()=>{
    let active=true;
    freshOperationUser().then(id=>{if(active)setUserId(id)}).catch(caught=>{if(active)setError(caught instanceof Error?caught.message:"ບໍ່ສາມາດກວດບັນຊີໄດ້")});
    return()=>{active=false};
  },[]);

  useEffect(()=>{
    if(!userId)return;
    const paymentRaw=pendingStorage.read(paymentStorageKey),visitRaw=pendingStorage.read(visitStorageKey);
    const payment=parsePendingRequest(paymentRaw,store.id),visit=parsePendingRequest(visitRaw,store.id);
    setPendingPayment(payment);setPendingVisit(visit);
    if((payment&&paymentRaw&&!pendingStorage.isPersisted(paymentStorageKey,paymentRaw))||(visit&&visitRaw&&!pendingStorage.isPersisted(visitStorageKey,visitRaw)))setStorageNotice("Browser ບໍ່ສາມາດເກັບຄຳຂໍໄວ້ໄດ້. ກະລຸນາເປີດໜ້ານີ້ໄວ້ ແລະລອງຄຳຂໍເກົ່າຈົນຢືນຢັນຜົນ.");
    setLegacyRequests(legacyFinancialRequests(store.id));
  },[paymentStorageKey,visitStorageKey,store.id,userId]);

  useEffect(()=>{
    if(!userId)return;
    const raw=pendingStorage.read(storageKey);
    const restored=restoreRestockDraft(raw,draftContext);
    setSavedContent(null);
    if(restored.status==="valid"){
      setEntries(restored.values.entries);
      setValue("paymentMethod",restored.values.paymentMethod);
      setValue("paidAmount",restored.values.paidAmount);
      const content=restockDraftContent(draftContext,restored.values);
      const persisted=raw!==null&&pendingStorage.isPersisted(storageKey,raw);
      setDraftBaseline(persisted?content:"");setSavedContent(persisted?content:null);setFailedContent(persisted?null:content);
      setDraftNotice(persisted?"ກູ້ຄືນສະບັບຮ່າງແລ້ວ. ກະລຸນາກວດຈຳນວນກ່ອນບັນທຶກ.":"ກູ້ຄືນຂໍ້ມູນໃນໜ້ານີ້ແລ້ວ, ແຕ່ Browser ຍັງເກັບສະບັບຮ່າງບໍ່ໄດ້. ກະລຸນາເປີດໜ້ານີ້ໄວ້.");
    }else{
      const defaults={entries:Object.fromEntries(lines.map(line=>[line.productId,{countRemaining:String(line.previousStock),countExpiredReturned:"0",countRefilled:line.refilledSinceAudit}])),paymentMethod:"cash" as const,paidAmount:"0"};
      setEntries(defaults.entries);setValue("paymentMethod",defaults.paymentMethod);setValue("paidAmount",defaults.paidAmount);setFailedContent(null);
      setDraftBaseline(restockDraftContent(draftContext,defaults));
      if(restored.status==="stale")setDraftNotice("ຂໍ້ມູນສະບັບຮ່າງເກົ່າກວ່າ Stock ປັດຈຸບັນ. ກະລຸນານັບສິນຄ້າໃໝ່.");
      else if(restored.status==="invalid")setDraftNotice("ສະບັບຮ່າງອ່ານບໍ່ໄດ້. ກະລຸນານັບສິນຄ້າໃໝ່.");
    }
  },[storageKey,draftContext,lines,setValue,userId]);

  useEffect(()=>{
    if(!userId||!unsavedDraft||completion)return;
    const timer=window.setTimeout(()=>{
      const persisted=pendingStorage.write(storageKey,draftContent);
      setSavedContent(persisted?draftContent:null);setFailedContent(persisted?null:draftContent);
      setDraftNotice(persisted?null:"Browser ບໍ່ສາມາດເກັບສະບັບຮ່າງໄດ້. ຂໍ້ມູນຈະຢູ່ໃນໜ້ານີ້ເທົ່ານັ້ນ. ກະລຸນາເປີດໜ້ານີ້ໄວ້.");
    },250);
    return()=>window.clearTimeout(timer);
  },[draftContent,storageKey,userId,unsavedDraft,completion]);

  const toNonNegativeInt=(value:string)=>parseWholeCount(value)??0;
  const hasInvalidCounts=lines.some(line=>parseWholeCount(entries[line.productId].countRemaining)===null||parseWholeCount(entries[line.productId].countExpiredReturned)===null);
  const paidCents=paidAmount.trim()===""?BigInt(0):parseMoneyCents(paidAmount);
  const paymentAmountInvalid=paidCents===null;
  const paidAmountValue=moneyNumber(paidCents??BigInt(0));
  const results=useMemo(()=>lines.map(line=>{
    const entry=entries[line.productId];
    const result=calculateLiveRestockLine({previousStock:line.previousStock,countRemaining:toNonNegativeInt(entry.countRemaining),countExpiredReturned:toNonNegativeInt(entry.countExpiredReturned),countRefilled:entry.countRefilled,retailPrice:line.retailPrice});
    return {...line,...result,subtotalGross:moneyNumber(roundMoneyCents(line.retailPrice)*BigInt(result.unitsSold))};
  }),[entries,lines]);
  const grossAmount=moneyNumber(results.reduce((s,x)=>s+roundMoneyCents(x.subtotalGross),BigInt(0)));
  const settlement=calculateSettlement(grossAmount,store.commissionRate);
  const hasReconciliationError=hasInvalidCounts||results.some(x=>x.hasNegativeSale);
  const unitsSold=results.reduce((s,x)=>s+Math.max(0,x.unitsSold),0);
  const expiredUnits=results.reduce((s,x)=>s+x.countExpiredReturned,0);
  const newDue=paymentFirst?0:settlement.netPayableAmount;
  const totalDueCents=roundMoneyCents(previousBalance)+roundMoneyCents(newDue);
  const totalDue=moneyNumber(totalDueCents);
  const paymentAmountExceeds=paidCents!==null&&paidCents>totalDueCents;
  const remainingAfterPayment=moneyNumber(totalDueCents>(paidCents??BigInt(0))?totalDueCents-(paidCents??BigInt(0)):BigInt(0));

  function update(productId:string,field:"countRemaining"|"countExpiredReturned",value:string){setCompletion(null);setError(null);setEntries(c=>({...c,[productId]:{...c[productId],[field]:value}}))}
  function adjust(productId:string,field:"countRemaining"|"countExpiredReturned",delta:number){const curr=toNonNegativeInt(entries[productId]?.[field]??"0");update(productId,field,String(Math.max(0,curr+delta)))}
  function remember(key:string,request:PendingRequest){
    if(!pendingStorage.write(key,JSON.stringify(request)))setStorageNotice("Browser ບໍ່ສາມາດເກັບຄຳຂໍໄວ້ໄດ້. ກະລຸນາເປີດໜ້ານີ້ໄວ້ ແລະລອງຄຳຂໍເກົ່າຈົນຢືນຢັນຜົນ.");
  }
  function saveDraft(){
    if(!userId)return;
    if(completion)return;
    const persisted=pendingStorage.write(storageKey,draftContent);
    setSavedContent(persisted?draftContent:null);setFailedContent(persisted?null:draftContent);setDraftNotice(persisted?null:"Browser ບໍ່ສາມາດເກັບສະບັບຮ່າງໄດ້. ຂໍ້ມູນຈະຢູ່ໃນໜ້ານີ້ເທົ່ານັ້ນ.");
  }

  async function completePaymentOnly(){
    if(!userId)return;
    const unresolvedLegacy=legacyFinancialRequests(store.id);
    if(unresolvedLegacy.length){setLegacyRequests(unresolvedLegacy);return;}
    const savedRequest=pendingPayment??parsePendingRequest(pendingStorage.read(paymentStorageKey),store.id);
    if(submitting||(!savedRequest&&(paidAmountValue<=0||paymentAmountInvalid||paymentAmountExceeds)))return;setSubmitting(true);setError(null);setCompletion(null);
    try{
      let request=savedRequest;
      if(!request){request={key:crypto.randomUUID(),body:JSON.stringify({storeId:store.id,paidAmount:moneyDecimalString(paidCents!),paymentMethod}),paidAmount:paidAmountValue};remember(paymentStorageKey,request);setPendingPayment(request)}
      const r=await operationFetch('/api/settlements/pay',JSON.parse(request.body),{key:request.key,userId});
      const data=await r.json().catch(()=>({}));
      if(!r.ok){if([400,404,409].includes(r.status)&&data.retryable===false){pendingStorage.remove(paymentStorageKey);setPendingPayment(null)}throw new Error(data.error||'ບໍ່ສາມາດຮັບເງິນໄດ້')}
      if(!isCompletionResult(data))throw new Error("ຍັງຢືນຢັນຜົນຮັບເງິນບໍ່ໄດ້. ກະລຸນາລອງຄຳຂໍເກົ່າອີກຄັ້ງ");
      pendingStorage.remove(paymentStorageKey);pendingStorage.remove(storageKey);setSavedContent(null);setPendingPayment(null);setStorageNotice(null);setCompletion(data);showToast({tone:'success',title:'ບັນທຶກຮັບເງິນສຳເລັດ',message:data.receiptNumber});
    }catch(e){setError(e instanceof Error?e.message:'ບໍ່ສາມາດຮັບເງິນໄດ້')}finally{setSubmitting(false)}
  }

  async function completeVisit(){
    if(!userId)return;
    const unresolvedLegacy=legacyFinancialRequests(store.id);
    if(unresolvedLegacy.length){setLegacyRequests(unresolvedLegacy);return;}
    const savedRequest=pendingVisit??parsePendingRequest(pendingStorage.read(visitStorageKey),store.id);
    if((!savedRequest&&(hasReconciliationError||paymentAmountInvalid||paymentAmountExceeds))||submitting)return;setSubmitting(true);setError(null);setCompletion(null);
    try{
      let request=savedRequest;
      if(!request){request={key:crypto.randomUUID(),body:JSON.stringify({storeId:store.id,fridgeAssetCode:fridge.assetCode,paidAmount:moneyDecimalString(paidCents!),paymentMethod,expectedFinancialSnapshot:{commissionRate:store.commissionRate,previousBalance:moneyDecimalString(roundMoneyCents(previousBalance)),retailPrices:lines.map(line=>({productId:line.productId,retailPrice:moneyDecimalString(roundMoneyCents(line.retailPrice))}))},lines:lines.map(line=>({productId:line.productId,previousStock:line.previousStock,countRemaining:entries[line.productId].countRemaining,countExpiredReturned:entries[line.productId].countExpiredReturned,countRefilled:entries[line.productId].countRefilled}))}),paidAmount:paidAmountValue};remember(visitStorageKey,request);setPendingVisit(request)}
      const r=await operationFetch('/api/restock-visits',JSON.parse(request.body),{key:request.key,userId});
      const data=await r.json().catch(()=>({}));
      if(!r.ok){if([400,404,409].includes(r.status)&&data.retryable===false){pendingStorage.remove(visitStorageKey);setPendingVisit(null)}throw new Error(data.error||'ບໍ່ສາມາດປິດຍອດໄດ້')}
      if(!isCompletionResult(data))throw new Error("ຍັງຢືນຢັນຜົນປິດຮອບບໍ່ໄດ້. ກະລຸນາລອງຄຳຂໍເກົ່າອີກຄັ້ງ");
      pendingStorage.remove(visitStorageKey);setPendingVisit(null);pendingStorage.remove(storageKey);setSavedContent(null);setStorageNotice(null);setCompletion(data);showToast({tone:'success',title:'ປິດຍອດສຳເລັດ',message:data.receiptNumber});
    }catch(e){setError(e instanceof Error?e.message:'ບໍ່ສາມາດປິດຍອດໄດ້')}finally{setSubmitting(false)}
  }

  const paymentCard=<section className="card restock-payment-v7 color-panel color-domain-finance">
    <div className="restock-payment-head-v7 color-panel-heading"><div><span className="panel-kicker">ຮັບເງິນ</span><h2>{paymentFirst?'ຮັບເງິນຄ້າງ':'ຮັບເງິນຈາກຮ້ານ'}</h2><p>{paymentFirst?'ກວດຍອດຄ້າງ ແລ້ວບັນທຶກຈຳນວນທີ່ຮັບ.':'ຍອດຄ້າງເກົ່າຈະຖືກຮວມກັບຍອດຮອບນີ້ອັດຕະໂນມັດ.'}</p></div>{previousBalance>0&&<span className="badge badge-warning">ມີຍອດຄ້າງ</span>}</div>
    <div className="payment-summary-grid-v7">
      <div className={previousBalance>0?'color-metric-warning':'color-metric-neutral'}><span>ຍອດຄ້າງເດີມ</span><strong>{formatMoney(previousBalance)}</strong></div>
      <div className="color-metric-neutral"><span>ຍອດຮອບນີ້</span><strong>{formatMoney(newDue)}</strong></div>
      <div className="total color-metric-domain"><span>ລວມຕ້ອງຮັບ</span><strong>{formatMoney(totalDue)}</strong></div>
    </div>
    <div className="payment-entry-grid-v7">
      <label className="field"><span>ຈຳນວນເງິນທີ່ຮັບ</span><input className="number-input payment-amount-v7" inputMode="decimal" min={0} max={totalDue} step="0.01" type="number" disabled={!draftReady} {...register("paidAmount")} aria-invalid={paymentAmountInvalid||paymentAmountExceeds||!!paymentErrors.paidAmount} aria-describedby={paymentAmountInvalid||paymentAmountExceeds?'restock-payment-validation':undefined}/>{(paymentAmountInvalid||paymentAmountExceeds)&&<small id="restock-payment-validation" className="field-error" role="alert">{paymentAmountInvalid?'ຈຳນວນເງິນຕ້ອງບໍ່ຕິດລົບ ແລະມີບໍ່ເກີນ 2 ຕຳແໜ່ງ':'ຈຳນວນເງິນເກີນຍອດທີ່ຕ້ອງຮັບ'}</small>}</label>
      <label className="field"><span>ວິທີຊຳລະ</span><select className="number-input" disabled={!draftReady} {...register("paymentMethod")}><option value="cash">ເງິນສົດ</option><option value="bank">ໂອນທະນາຄານ</option></select></label>
    </div>
    {totalDue>0&&<button type="button" className="button button-secondary payment-full-v7" disabled={!draftReady} onClick={()=>setValue("paidAmount", moneyDecimalString(totalDueCents))}>ຮັບເຕັມຈຳນວນ {formatMoney(totalDue)}</button>}
    <div className={`payment-after-v7 ${remainingAfterPayment===0&&totalDue>0?'is-paid color-metric-success':remainingAfterPayment>0?'color-metric-warning':'color-metric-neutral'}`}><span>ຄົງເຫຼືອຫຼັງຮັບ</span><strong>{formatMoney(remainingAfterPayment)}</strong></div>
    {paymentFirst&&pendingPayment&&<div className="notice" role="status">ມີຄຳຂໍຮັບເງິນ {formatMoney(pendingPayment.paidAmount)} ທີ່ຍັງບໍ່ຮູ້ຜົນ. ກົດປຸ່ມດ້ານລຸ່ມເພື່ອກວດຄຳຂໍເກົ່າກ່ອນ.</div>}
    {userId&&error&&<div ref={errorRef} tabIndex={-1} className="notice payment-error-v7" role="alert"><strong>ບັນທຶກບໍ່ສຳເລັດ</strong><br/>{error}</div>}
    {completion&&<div className="notice completion-v5" role="status"><div><strong>ບັນທຶກສຳເລັດ · {completion.receiptNumber}</strong><br/>ຮັບ {formatMoney(completion.paidAmount)} · ຄົງເຫຼືອ {formatMoney(completion.closingBalance)}</div><Link className="button button-primary" href="/settlements">ກັບລາຍການ →</Link></div>}
    {paymentFirst&&<button className="button button-primary payment-primary-v7" type="button" aria-busy={submitting} disabled={!draftReady||legacyRequests.length>0||submitting||Boolean(completion)||(!pendingPayment&&(paidAmountValue<=0||paymentAmountInvalid||paymentAmountExceeds))} onClick={completePaymentOnly}>{submitting?'ກຳລັງບັນທຶກ...':completion?'ຮັບເງິນແລ້ວ ✓':pendingPayment?'ກວດຄຳຂໍຮັບເງິນເກົ່າ':'ບັນທຶກຮັບເງິນ'}</button>}
  </section>;

  return <>
    {navigationDialog}
    {!userId&&error&&<div ref={errorRef} tabIndex={-1} className="notice form-error" role="alert">{error}</div>}
    <div className="draft-save-status" role="status" aria-live="polite">{!completion&&(saved?"ເກັບສະບັບຮ່າງແລ້ວ ✓":failedContent===draftContent?"ຍັງເກັບສະບັບຮ່າງບໍ່ໄດ້":unsavedDraft?"ກຳລັງເກັບສະບັບຮ່າງ…":"")}</div>
    {storageNotice&&<div className="notice" role="status">{storageNotice}</div>}
    {legacyRequests.length>0&&<section className="notice" role="status">
      <strong>ມີຄຳຂໍເກົ່າທີ່ຍັງບໍ່ຮູ້ຜົນ</strong>
      <p>ຄຳຂໍນີ້ບໍ່ມີຂໍ້ມູນບັນຊີຜູ້ໃຊ້. ກະລຸນາກວດໃບເສັດ ແລະຍອດຄ້າງປັດຈຸບັນ {formatMoney(previousBalance)} ກ່ອນບັນທຶກໃໝ່.</p>
      <ul>{legacyRequests.map(request=><li key={request.storageKey}><Link href={`/settlements?filter=all&q=${encodeURIComponent(request.receiptNumber)}`}>{request.receiptNumber}</Link> · {formatMoney(request.paidAmount)}</li>)}</ul>
      <button type="button" className="button button-secondary" onClick={()=>setReviewLegacy(true)}>ກວດຄຳຂໍເກົ່າແລ້ວ / ລ້າງຈາກ Browser</button>
    </section>}
    <ActionDialog open={reviewLegacy} title="ຢືນຢັນວ່າກວດຄຳຂໍເກົ່າແລ້ວ" description="ຄຳຂໍເກົ່າອາດບັນທຶກແລ້ວ. ກະລຸນາກວດເລກໃບເສັດ ແລະຍອດຄ້າງກ່ອນ. ການລ້າງນີ້ລ້າງພຽງຄຳຂໍໃນ Browser, ບໍ່ລຶບລາຍການໃນລະບົບ." confirmLabel="ກວດແລ້ວ · ລ້າງຄຳຂໍເກົ່າ" onClose={()=>setReviewLegacy(false)} onConfirm={()=>{for(const request of legacyRequests)pendingStorage.remove(request.storageKey);setLegacyRequests([]);setReviewLegacy(false)}}/>
    {paymentFirst&&paymentCard}
    <div className="restock-mode-links-v7">{paymentFirst?<Link href={`/driver/restock/${store.id}`}>+ ເລີ່ມກວດຈຳນວນຄົງເຫຼືອ / ປິດຮອບໃໝ່</Link>:previousBalance>0?<Link href={`/driver/restock/${store.id}?mode=payment`}>ຮັບເງິນຄ້າງຢ່າງດຽວ →</Link>:null}</div>

    <details className="restock-audit-section-v7 color-panel" open={!paymentFirst}>
      <summary className="color-panel-heading"><span><strong>{paymentFirst?'ນັບສິນຄ້າ / ເລີ່ມຮອບກວດ':'ກວດຈຳນວນຄົງເຫຼືອ ແລະຄິດຍອດຂາຍ'}</strong><small>{paymentFirst?'ເປີດເມື່ອຕ້ອງການກວດຮ້ານໃໝ່':'3 ຂັ້ນຕອນ: ນັບ → ຮັບເງິນ → ຢືນຢັນ'}</small></span><b>⌄</b></summary>
      <div className="restock-audit-body-v7">
        {!paymentFirst&&<>
          <div className="audit-stepper-v4" aria-label="ຂັ້ນຕອນກວດຮ້ານ">
            {([1,2,3] as const).map(number=><div key={number} className={`audit-step-v4 ${step===number?'is-current':step>number?'is-complete':''}`} aria-current={step===number?'step':undefined}><span>{number}</span><div><strong>{number===1?'ນັບສິນຄ້າ':number===2?'ຮັບເງິນ':'ຢືນຢັນ'}</strong><small>{number===1?'ຄົງເຫຼືອ + ຂອງເສຍ':number===2?'ຈຳນວນ + ວິທີຊຳລະ':'ກວດຍອດ ແລະປິດຮອບ'}</small></div></div>)}
          </div>
          <h2 className="audit-flow-title color-section-heading" tabIndex={-1} ref={stepHeadingRef}>{step===1?'1. ນັບສິນຄ້າ':step===2?'2. ຮັບເງິນ':'3. ກວດສະຫຼຸບ ແລະຢືນຢັນ'}</h2>
        </>}
        {draftNotice&&<div className="notice" role="status">{draftNotice}</div>}
        {hasInvalidCounts&&<div className="notice form-error" role="alert">ກະລຸນາໃສ່ຈຳນວນຄົງເຫຼືອ ແລະຂອງເສຍເປັນຈຳນວນເຕັມທີ່ບໍ່ຕິດລົບ.</div>}
        {!paymentFirst&&pendingVisit&&<div className="notice" role="status">ມີຄຳຂໍປິດຮອບທີ່ຮັບເງິນ {formatMoney(pendingVisit.paidAmount)} ແລະຍັງບໍ່ຮູ້ຜົນ. ກົດປຸ່ມດ້ານລຸ່ມເພື່ອກວດຄຳຂໍເກົ່າກ່ອນ.</div>}
        {(paymentFirst||step===1)&&<>
          <div className="restock-mini-summary-v7"><div className="color-metric-domain"><span>ຂາຍໄດ້</span><strong>{unitsSold} ຖ້ວຍ</strong></div><div className={expiredUnits>0?'color-metric-warning':'color-metric-neutral'}><span>ເສຍ / ໝົດອາຍຸ</span><strong>{expiredUnits}</strong></div><div className="color-metric-domain color-domain-finance"><span>ຍອດຂາຍລວມ</span><strong>{formatMoney(settlement.grossAmount)}</strong></div></div>
        {results.map(line=>{
          const remainingInvalid=parseWholeCount(entries[line.productId].countRemaining)===null;
          const expiredInvalid=parseWholeCount(entries[line.productId].countExpiredReturned)===null;
          const remainingId=`${countsId}-${line.productId}-remaining`;
          const expiredId=`${countsId}-${line.productId}-expired`;
          return <section className="card audit-card" key={line.productId}>
            <div className="audit-product"><span className="product-dot" style={{background:line.color}}/><div style={{flex:1}}><strong>{line.name}</strong><div className="store-meta">{formatMoney(line.retailPrice)} / ຖ້ວຍ</div></div></div>
            <div className="audit-grid">
              <div className="field"><span>ຈຳນວນກ່ອນນັບ</span><div className="readonly-box">{line.previousStock}</div></div>
              <div className="field">
                <label htmlFor={remainingId}>ຄົງເຫຼືອຈິງ</label>
                <div className="audit-stepper-wrap-v1">
                  <button type="button" className="stepper-btn-v1" disabled={!draftReady} onClick={()=>adjust(line.productId,'countRemaining',-1)} aria-label="ຫຼຸດ 1">-1</button>
                  <input id={remainingId} className="number-input stepper-input-v1" aria-label={`${line.name} ຄົງເຫຼືອຈິງ`} aria-invalid={remainingInvalid} aria-describedby={remainingInvalid?`${remainingId}-error`:undefined} min={0} step={1} inputMode="numeric" type="number" disabled={!draftReady} value={entries[line.productId].countRemaining} onChange={e=>update(line.productId,'countRemaining',e.target.value)}/>
                  <button type="button" className="stepper-btn-v1" disabled={!draftReady} onClick={()=>adjust(line.productId,'countRemaining',1)} aria-label="ເພີ່ມ 1">+1</button>
                  <button type="button" className="stepper-btn-v1 stepper-btn-jump-v1" disabled={!draftReady} onClick={()=>adjust(line.productId,'countRemaining',5)} aria-label="ເພີ່ມ 5">+5</button>
                </div>
                {remainingInvalid&&<small id={`${remainingId}-error`} className="field-error" role="alert">ໃສ່ຈຳນວນເຕັມ 0 ຫຼືຫຼາຍກວ່າ.</small>}
              </div>
              <div className="field">
                <label htmlFor={expiredId}>ເສຍ / ໝົດອາຍຸ</label>
                <div className="audit-stepper-wrap-v1">
                  <button type="button" className="stepper-btn-v1" disabled={!draftReady} onClick={()=>adjust(line.productId,'countExpiredReturned',-1)} aria-label="ຫຼຸດ 1">-1</button>
                  <input id={expiredId} className="number-input stepper-input-v1" aria-label={`${line.name} ເສຍ ຫຼື ໝົດອາຍຸ`} aria-invalid={expiredInvalid} aria-describedby={expiredInvalid?`${expiredId}-error`:undefined} min={0} step={1} inputMode="numeric" type="number" disabled={!draftReady} value={entries[line.productId].countExpiredReturned} onChange={e=>update(line.productId,'countExpiredReturned',e.target.value)}/>
                  <button type="button" className="stepper-btn-v1" disabled={!draftReady} onClick={()=>adjust(line.productId,'countExpiredReturned',1)} aria-label="ເພີ່ມ 1">+1</button>
                </div>
                {expiredInvalid&&<small id={`${expiredId}-error`} className="field-error" role="alert">ໃສ່ຈຳນວນເຕັມ 0 ຫຼືຫຼາຍກວ່າ.</small>}
              </div>
              <div className="field"><span>ຈຳນວນເຕີມໃນຮອບ</span><div className="readonly-box">{entries[line.productId].countRefilled}</div></div>
            </div>
            <div className={`audit-result ${line.hasNegativeSale?'warning':''}`}><div><div className="kicker">ຂາຍ</div><strong>{line.unitsSold} ຖ້ວຍ</strong></div><div style={{textAlign:'right'}}><div className="kicker">ຍອດ</div><strong>{formatMoney(line.subtotalGross)}</strong></div></div>
            {line.hasNegativeSale&&<p className="danger-text">ຈຳນວນຂາຍຕິດລົບ — ກວດຈຳນວນອີກຄັ້ງ.</p>}
          </section>;
        })}
          {!paymentFirst&&<div className="audit-flow-actions"><button type="button" className="button button-ghost" onClick={saveDraft} disabled={!draftReady}>{saved?'ເກັບສະບັບຮ່າງແລ້ວ ✓':'ເກັບສະບັບຮ່າງ'}</button><button type="button" className="button button-primary" disabled={hasReconciliationError} onClick={()=>goToStep(2)}>ຕໍ່ໄປ: ຮັບເງິນ →</button></div>}
        </>}
        {!paymentFirst&&step===2&&<>
          {paymentCard}
          <div className="audit-flow-actions"><button type="button" className="button button-ghost" onClick={()=>goToStep(1)}>← ກັບໄປນັບສິນຄ້າ</button><button type="button" className="button button-primary" disabled={paymentAmountInvalid||paymentAmountExceeds} onClick={()=>goToStep(3)}>ຕໍ່ໄປ: ກວດສະຫຼຸບ →</button></div>
        </>}
        {!paymentFirst&&step===3&&<>
          <div className="audit-review-card" aria-label="ສະຫຼຸບກ່ອນບັນທຶກ">
            <div><span>ຂາຍໄດ້</span><strong>{unitsSold} ຖ້ວຍ</strong></div>
            <div><span>ເສຍ / ໝົດອາຍຸ</span><strong>{expiredUnits} ຖ້ວຍ</strong></div>
            <div><span>ຮັບເງິນ</span><strong>{formatMoney(paidAmountValue)}</strong></div>
            <div><span>ວິທີຊຳລະ</span><strong>{paymentMethod==='bank'?'ໂອນທະນາຄານ':'ເງິນສົດ'}</strong></div>
            <div><span>ຍອດຄ້າງຫຼັງຮັບ</span><strong>{formatMoney(remainingAfterPayment)}</strong></div>
          </div>
          {error&&<div ref={errorRef} tabIndex={-1} className="notice payment-error-v7" role="alert"><strong>ບັນທຶກບໍ່ສຳເລັດ</strong><br/>{error}</div>}
          {completion&&<div className="notice completion-v5" role="status"><div><strong>ບັນທຶກສຳເລັດ · {completion.receiptNumber}</strong><br/>ຮັບ {formatMoney(completion.paidAmount)} · ຄົງເຫຼືອ {formatMoney(completion.closingBalance)}</div><Link className="button button-primary" href="/settlements">ກັບລາຍການ →</Link></div>}
        <div className="summary-sticky restock-final-v7"><div className="summary-row"><span>ຍອດຄ້າງເກົ່າ</span><strong>{formatMoney(previousBalance)}</strong></div><div className="summary-row"><span>ຍອດໃໝ່ຮອບນີ້</span><strong>{formatMoney(settlement.netPayableAmount)}</strong></div><div className="summary-row total"><span>ລວມກ່ອນຮັບເງິນ</span><strong>{formatMoney(previousBalance+settlement.netPayableAmount)}</strong></div><button className="button button-primary" type="button" aria-busy={submitting} disabled={!draftReady||legacyRequests.length>0||submitting||Boolean(completion)||(!pendingVisit&&(hasReconciliationError||paymentAmountInvalid||paymentAmountExceeds))} onClick={completeVisit}>{submitting?'ກຳລັງບັນທຶກ...':completion?'ປິດຍອດແລ້ວ ✓':pendingVisit?'ກວດຄຳຂໍປິດຮອບເກົ່າ':hasReconciliationError?'ແກ້ຈຳນວນກ່ອນ':'ບັນທຶກການກວດ ແລະປິດຍອດ'}</button><details className="audit-ສະບັບຮ່າງ-v6"><summary>ຍັງກວດບໍ່ແລ້ວ?</summary><div><button className="button button-ghost" type="button" aria-label="ເກັບ ສະບັບຮ່າງ ການກວດຮ້ານ" onClick={saveDraft} disabled={!draftReady}>{saved?'ເກັບໄວ້ແລ້ວ ✓':'ເກັບ ສະບັບຮ່າງ'}</button></div></details></div>

          <div className="audit-flow-actions"><button type="button" className="button button-ghost" onClick={()=>goToStep(2)} disabled={submitting||Boolean(completion)}>← ກັບໄປຮັບເງິນ</button></div>
        </>}
      </div>
    </details>
  </>;
}
