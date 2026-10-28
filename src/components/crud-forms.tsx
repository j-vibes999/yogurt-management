"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { showToast } from "@/lib/toast";
import { operationFetch } from "@/lib/operation-request";
import { businessDateString } from "@/lib/date-only";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";

type StoreOption = { id: string; name: string };
type MaterialOption = { id: string; name: string; unit: string; stock: number };

function useSubmit(target: string, returnTo: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const { allowNavigation, navigationDialog } = useUnsavedChanges(dirty);
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(payload: Record<string, unknown>) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await operationFetch(target, payload);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "ບັນທຶກບໍ່ສຳເລັດ");
      showToast({ tone: "success", title: "ບັນທຶກສຳເລັດ" });
      setDirty(false);
      allowNavigation();
      router.push(returnTo);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ບັນທຶກບໍ່ສຳເລັດ");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return { busy, error, submit, navigationDialog, markDirty: () => setDirty(true) };
}

function ErrorNotice({ error }: { error: string | null }) {
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) noticeRef.current?.focus(); }, [error]);
  if (!error) return null;
  return <div ref={noticeRef} tabIndex={-1} role="alert" className="notice form-error"><strong>ບັນທຶກບໍ່ສຳເລັດ</strong><br />{error}</div>;
}

export function StoreCreateForm({ enabled }: { enabled: boolean }) {
  const { busy, error, submit, markDirty, navigationDialog } = useSubmit("/api/stores", "/stores");
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submit(Object.fromEntries(form.entries()));
  }
  return (
    <form className="card form-card store-create-form-v2" onSubmit={onSubmit} onChangeCapture={markDirty}>
      {navigationDialog}
      <div className="store-form-split-v2">
        <div className="store-form-col-v2 color-panel">
          <div className="form-section-head-v2 color-panel-heading">
            <span className="panel-kicker">ຮ້ານຄ້າ</span>
            <h2>ຂໍ້ມູນຮ້ານຄ້າ</h2>
            <p>ກຳນົດຊື່ຮ້ານ, ເຈົ້າຂອງ ແລະ ຕຳແໜ່ງຈຸດຂາຍ</p>
          </div>
          <div className="form-grid form-grid-2 compact-grid-v2">
            <label className="field form-span-2"><span>ຊື່ຮ້ານ *</span><input className="form-control" name="name" required placeholder="ເຊັ່ນ Sabaidee Cafe" /></label>
            <label className="field"><span>ຊື່ຜູ້ຕິດຕໍ່</span><input className="form-control" name="contactName" placeholder="ຊື່ເຈົ້າຂອງ / ຜູ້ຈັດການ" /></label>
            <label className="field"><span>ເບີໂທ</span><input className="form-control" name="phone" inputMode="tel" placeholder="020 ..." /></label>
            <label className="field"><span>WhatsApp</span><input className="form-control" name="whatsapp" inputMode="tel" placeholder="ປ່ອຍວ່າງ = ໃຊ້ເບີໂທ" /></label>
            <label className="field"><span>Facebook</span><input className="form-control" name="facebook" placeholder="ຊື່ Page / Profile" /></label>
            <label className="field form-span-2"><span>ທີ່ຢູ່</span><textarea className="form-control form-textarea" name="address" rows={2} placeholder="ບ້ານ / ຖະໜົນ / ເມືອງ" /></label>
            <label className="field"><span>ເສັ້ນຂະໜານ</span><input className="form-control" name="latitude" inputMode="decimal" placeholder="17.96..." /></label>
            <label className="field"><span>ເສັ້ນແວງ</span><input className="form-control" name="longitude" inputMode="decimal" placeholder="102.61..." /></label>
          </div>
        </div>
        <div className="store-form-col-v2 color-panel">
          <div className="form-section-head-v2 color-panel-heading">
            <span className="panel-kicker">ຕູ້ແຊ່</span>
            <h2>ຕູ້ແຊ່ປະຈຳຮ້ານ</h2>
            <p>ກຳນົດລະຫັດຕູ້, ຄວາມຈຸ ແລະ ຄ່າໃຊ້ຈ່າຍ</p>
          </div>
          <div className="form-grid form-grid-2 compact-grid-v2">
            <label className="field"><span>ລະຫັດຕູ້ *</span><input className="form-control" name="assetCode" required placeholder="FR-011" /></label>
            <label className="field"><span>ໝາຍເລກປະຈຳເຄື່ອງ</span><input className="form-control" name="serialNo" placeholder="YD100-0011" /></label>
            <label className="field"><span>ຮຸ່ນ</span><input className="form-control" name="fridgeModel" defaultValue="Yogurt Display 100" /></label>
            <label className="field"><span>ຄວາມຈຸ (ຖ້ວຍ) *</span><input className="form-control" name="capacityCups" type="number" min="1" defaultValue="100" /></label>
            <label className="field"><span>ວັນເລີ່ມວາງຕູ້</span><input className="form-control" name="fridgeStartDate" type="date" /></label>
            <label className="field"><span>ຄ່າໄຟ / ເດືອນ (LAK)</span><input className="form-control" name="monthlyElectricity" type="number" inputMode="decimal" step="0.01" min="0" defaultValue="200000" /></label>
          </div>
          <div className="notice compact-notice store-split-notice-v2">ສ່ວນແບ່ງຮ້ານຖືກກຳນົດເປັນ 30% ແລະສິນຄ້າໃນຕູ້ເລີ່ມຕົ້ນທີ່ 0 ຖ້ວຍ.</div>
        </div>
      </div>
      <ErrorNotice error={error} />
      <div className="form-actions"><Link href="/stores" className="button button-secondary">ຍົກເລີກ</Link><button className="button button-primary" disabled={!enabled || busy}>{busy ? "ກຳລັງບັນທຶກ..." : enabled ? "ບັນທຶກຮ້ານ" : "ຕ້ອງເຊື່ອມຕໍ່ຖານຂໍ້ມູນ"}</button></div>
    </form>
  );
}

export function RefillCreateForm({ stores, products, enabled, initialStoreId = "", storeSelectionNotice }: { stores: StoreOption[]; products: { id:string; name:string; code:string }[]; enabled: boolean; initialStoreId?: string; storeSelectionNotice?: string }) {
  const { busy, error, submit, markDirty, navigationDialog } = useSubmit("/api/refills", "/refills");
  const storeNoticeId = useId();
  const quantityErrorId = useId();
  const quantityInputRef = useRef<HTMLInputElement>(null);
  const [quantityError, setQuantityError] = useState<string | null>(null);
  const [showStoreNotice, setShowStoreNotice] = useState(Boolean(storeSelectionNotice));
  const selectedStoreId = stores.some((store) => store.id === initialStoreId) ? initialStoreId : "";
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    if (!enabled || busy || !stores.length || !products.length) return;
    const items = products.map((product) => ({ finishedProductId: product.id, quantity: Number(form.get(`product_${product.id}`) || 0) })).filter((item) => item.quantity > 0);
    if (!items.length) {
      setQuantityError("ກະລຸນາໃສ່ຈຳນວນສິນຄ້າຢ່າງໜ້ອຍ 1 ຖ້ວຍ ໃນ 1 ລາຍການ.");
      quantityInputRef.current?.focus();
      return;
    }
    setQuantityError(null);
    await submit({ storeId: form.get("storeId"), note: form.get("note"), items });
  }
  return (
    <form className="card form-card color-panel" onSubmit={onSubmit} onChangeCapture={markDirty}>
      {navigationDialog}
      <div className="form-section"><div className="color-panel-heading"><span className="panel-kicker">ຄຳຂໍເຕີມສິນຄ້າ</span><h2>ສ້າງຄຳຂໍເຕີມສິນຄ້າ</h2></div>
        {!stores.length && <div className="notice form-mode-notice"><strong>ຍັງບໍ່ມີຮ້ານທີ່ພ້ອມເຕີມສິນຄ້າ</strong><p>ໃຫ້ຜູ້ຈັດການເພີ່ມຮ້ານ ແລະຜູກຕູ້ແຊ່ກ່ອນ.</p><Link href="/stores" className="text-link">ເບິ່ງຮ້ານຄ້າ →</Link></div>}
        {!products.length && <div className="notice form-mode-notice"><strong>ຍັງບໍ່ມີສິນຄ້າໃຫ້ເລືອກ</strong><p>ໃຫ້ຜູ້ຈັດການເປີດໃຊ້ສິນຄ້າ ກ່ອນສ້າງຄຳຂໍເຕີມສິນຄ້າ.</p></div>}
        <div className="form-grid form-grid-2">
          <label className="field form-span-2"><span>ຮ້ານ *</span><select className="form-control" name="storeId" required defaultValue={selectedStoreId} disabled={!stores.length} aria-describedby={showStoreNotice ? storeNoticeId : undefined} onChange={() => setShowStoreNotice(false)}><option value="" disabled>ເລືອກຮ້ານ</option>{stores.map((store) => <option value={store.id} key={store.id}>{store.name}</option>)}</select>{showStoreNotice && <small id={storeNoticeId} className="warning-text" role="status">{storeSelectionNotice}</small>}</label>
          {products.map((product, index) => <label className="field" key={product.id}><span>{product.name} (ຖ້ວຍ)</span><input ref={index === 0 ? quantityInputRef : undefined} className="form-control" name={`product_${product.id}`} type="number" min="0" max="100000" step="1" defaultValue="0" aria-invalid={Boolean(quantityError)} aria-describedby={quantityError ? quantityErrorId : undefined} onChange={() => setQuantityError(null)} /></label>)}
          {quantityError && <small id={quantityErrorId} className="field-error form-span-2" role="alert">{quantityError}</small>}
          <label className="field form-span-2"><span>ໝາຍເຫດ</span><textarea className="form-control form-textarea" name="note" rows={3} placeholder="ເຊັ່ນ ຮ້ານໂທແຈ້ງວ່າສິນຄ້າໃກ້ໝົດ" /></label>
        </div>
      </div>
      <ErrorNotice error={error} />
      <div className="form-actions"><Link href="/refills" className="button button-secondary">ຍົກເລີກ</Link><button className="button button-primary" aria-busy={busy} disabled={!enabled || busy || !products.length || !stores.length}>{busy ? "ກຳລັງບັນທຶກ..." : enabled ? "ສ້າງຄຳຂໍ" : "ຕ້ອງເຊື່ອມຕໍ່ຖານຂໍ້ມູນ"}</button></div>
    </form>
  );
}

export function ExpenseCreateForm({ stores, enabled }: { stores: StoreOption[]; enabled: boolean }) {
  const { busy, error, submit, markDirty, navigationDialog } = useSubmit("/api/expenses", "/expenses");
  const uploadedReceipt=useRef<{fingerprint:string;url:string}|null>(null);
  const submittingExpense=useRef(false);
  const [receiptBusy,setReceiptBusy]=useState(false);
  const [receiptError,setReceiptError]=useState<string | null>(null);
  const [categories,setCategories]=useState<string[]>(["ຄ່າໄຟ","ຄ່ານ້ຳມັນ","ຄ່າຂົນສົ່ງ","ຄ່າສ້ອມແປງ","ຄ່າເຊົ່າ","ຄ່າອຸປະກອນ","ອື່ນໆ"]);
  const [categoryChoice,setCategoryChoice]=useState("");
  const [customCategory,setCustomCategory]=useState("");
  const [newCategory,setNewCategory]=useState("");
  const [categoryBusy,setCategoryBusy]=useState(false);
  const [categoryError,setCategoryError]=useState<string | null>(null);
  const categoryErrorRef=useRef<HTMLElement>(null);
  useEffect(()=>{if(categoryError)categoryErrorRef.current?.focus()},[categoryError]);

  useEffect(()=>{
    let active=true;
    fetch("/api/expense-categories",{cache:"no-store"})
      .then((response)=>response.ok?response.json():Promise.reject(new Error("load failed")))
      .then((data)=>{if(active&&Array.isArray(data.categories)&&data.categories.length)setCategories(data.categories);})
      .catch(()=>{});
    return()=>{active=false;};
  },[]);

  async function addExpenseCategory(){
    const name=newCategory.trim();
    if(!name){setCategoryError("ກະລຸນາພິມຊື່ປະເພດ");return;}
    setCategoryBusy(true);setCategoryError(null);
    try{
      const response=await fetch("/api/expense-categories",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name})});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||"ບໍ່ສາມາດເພີ່ມປະເພດໄດ້");
      setCategories((current)=>current.includes(data.category)?current:[...current,data.category]);
      setCategoryChoice(data.category);
      setNewCategory("");
      showToast({tone:"success",title:"ເພີ່ມປະເພດແລ້ວ"});
    }catch(caught){setCategoryError(caught instanceof Error?caught.message:"ບໍ່ສາມາດເພີ່ມປະເພດໄດ້");}
    finally{setCategoryBusy(false);}
  }
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!enabled||busy||submittingExpense.current)return;
    if(!categoryChoice){setCategoryError("ກະລຸນາເລືອກປະເພດ");return;}
    if(categoryChoice==="__add__"){setCategoryError("ກົດ ‘ເພີ່ມເປັນ Choice’ ກ່ອນບັນທຶກລາຍຈ່າຍ");return;}
    if(categoryChoice==="__custom__"&&!customCategory.trim()){setCategoryError("ກະລຸນາພິມປະເພດລາຍຈ່າຍ");return;}
    submittingExpense.current=true;setReceiptBusy(true);setReceiptError(null);
    try{
      const form = new FormData(event.currentTarget); let receiptUrl = "";
      const file=form.get("receipt");
      if(file instanceof File && file.size>0){
        const fingerprint=JSON.stringify([file.name,file.size,file.lastModified,file.type]);
        if(uploadedReceipt.current?.fingerprint===fingerprint)receiptUrl=uploadedReceipt.current.url;
        else {const upload=new FormData(); upload.set("file",file); const r=await fetch("/api/uploads/receipts",{method:"POST",body:upload}); const d=await r.json().catch(()=>({})); if(!r.ok)throw new Error(d.error||"Receipt upload failed"); receiptUrl=d.url||"";uploadedReceipt.current={fingerprint,url:receiptUrl};}
      }
      const payload=Object.fromEntries(form.entries()); delete payload.receipt; await submit({...payload,receiptUrl});
    }catch(caught){setReceiptError(caught instanceof Error?caught.message:"Receipt upload failed");}
    finally{submittingExpense.current=false;setReceiptBusy(false);}
  }
  return (
    <form className="card form-card color-panel" onSubmit={onSubmit} onChangeCapture={markDirty}>
      {navigationDialog}
      <div className="form-section">
        <div className="color-panel-heading"><span className="panel-kicker">ລາຍຈ່າຍ</span><h2>ບັນທຶກລາຍຈ່າຍ</h2></div>
        <div className="form-grid form-grid-2">
          <div className="field"><span>ປະເພດ *</span>
            <select aria-label="ປະເພດລາຍຈ່າຍ" className="form-control" value={categoryChoice} onChange={(event)=>{setCategoryChoice(event.target.value);setCategoryError(null);if(event.target.value!=="__custom__")setCustomCategory("");if(event.target.value!=="__add__")setNewCategory("");}} required>
              <option value="" disabled>ເລືອກປະເພດ</option>
              {categories.map((category)=><option value={category} key={category}>{category}</option>)}
              <option disabled>──────────</option>
              <option value="__custom__">✎ ພິມເອງ...</option>
              <option value="__add__">＋ ເພີ່ມປະເພດໃໝ່</option>
            </select>
            {categoryChoice==="__custom__"&&<input aria-label="ພິມປະເພດລາຍຈ່າຍ" className="form-control" name="category" value={customCategory} onChange={(event)=>setCustomCategory(event.target.value)} placeholder="ພິມປະເພດລາຍຈ່າຍ..." autoFocus required/>}
            {categoryChoice==="__add__"&&<div className="expense-category-add-row"><input aria-label="ຊື່ປະເພດໃໝ່" className="form-control" value={newCategory} onChange={(event)=>setNewCategory(event.target.value)} onKeyDown={(event)=>{if(event.key==="Enter"){event.preventDefault();void addExpenseCategory();}}} placeholder="ຊື່ປະເພດໃໝ່..." autoFocus/><button type="button" className="button button-secondary" onClick={()=>void addExpenseCategory()} disabled={categoryBusy}>{categoryBusy?"ກຳລັງເພີ່ມ...":"ເພີ່ມເປັນ Choice"}</button></div>}
            {categoryChoice&&categoryChoice!=="__custom__"&&categoryChoice!=="__add__"&&<input type="hidden" name="category" value={categoryChoice}/>}
            {categoryError&&<small ref={categoryErrorRef} tabIndex={-1} className="field-error" role="alert">{categoryError}</small>}
            <small>{categoryChoice==="__custom__"?"ໃຊ້ສະເພາະລາຍການນີ້ ບໍ່ເພີ່ມເຂົ້າ Choice":categoryChoice==="__add__"?"ບັນທຶກເປັນ Choice ເພື່ອໃຊ້ໃນຄັ້ງຕໍ່ໄປ":"ເລືອກ Choice ທີ່ມີຢູ່ ຫຼືເລືອກເມນູດ້ານລຸ່ມ"}</small>
          </div>
          <label className="field"><span>ຈຳນວນເງິນ (LAK) *</span><input className="form-control" name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" required /></label>
          <label className="field"><span>ວັນທີ</span><input className="form-control" name="incurredAt" type="date" defaultValue={businessDateString()} /><small>ຕັ້ງເປັນມື້ນີ້ອັດຕະໂນມັດ ແລະສາມາດປ່ຽນໄດ້</small></label>
          <label className="field"><span>ຜູກກັບຮ້ານ</span><select className="form-control" name="storeId" defaultValue=""><option value="">ລາຍຈ່າຍກາງ</option>{stores.map((store) => <option value={store.id} key={store.id}>{store.name}</option>)}</select></label>
          <label className="field form-span-2"><span>ລາຍລະອຽດ</span><textarea className="form-control form-textarea" name="note" rows={3} placeholder="ອະທິບາຍລາຍຈ່າຍ" /></label>
          <label className="field form-span-2"><span>ໃບເສັດ / ຫຼັກຖານ (JPG, PNG, WEBP, PDF ≤ 5MB)</span><input className="form-control" name="receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" /></label>
        </div>
      </div>
      <ErrorNotice error={receiptError || error} />
      <div className="form-actions"><Link href="/expenses" className="button button-secondary">ຍົກເລີກ</Link><button className="button button-primary" disabled={!enabled || busy || receiptBusy}>{busy || receiptBusy ? "ກຳລັງບັນທຶກ..." : enabled ? "ບັນທຶກລາຍຈ່າຍ" : "ຕ້ອງເຊື່ອມຕໍ່ຖານຂໍ້ມູນ"}</button></div>
    </form>
  );
}

export function ReceiveMaterialForm({ materials, enabled }: { materials: MaterialOption[]; enabled: boolean }) {
  const { busy, error, submit, markDirty, navigationDialog } = useSubmit("/api/inventory/receive", "/inventory");
  async function onSubmit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); await submit(Object.fromEntries(form.entries())); }
  return (
    <form className="card form-card color-panel" onSubmit={onSubmit} onChangeCapture={markDirty}>
      {navigationDialog}
      <div className="form-section">
        <div className="color-panel-heading"><span className="panel-kicker">ຮັບວັດຖຸດິບ</span><h2>ຮັບວັດຖຸດິບເຂົ້າສາງ</h2></div>
        <div className="form-grid form-grid-2">
          <label className="field"><span>ຜູ້ສະໜອງ *</span><input className="form-control" name="supplierName" required placeholder="ຊື່ຮ້ານ / ບໍລິສັດ" /></label>
          <label className="field"><span>ວັນຊື້</span><input className="form-control" name="purchaseDate" type="date" /></label>
          <label className="field form-span-2"><span>ວັດຖຸດິບ *</span><select className="form-control" name="rawMaterialId" required defaultValue=""><option value="" disabled>ເລືອກວັດຖຸດິບ</option>{materials.map((item) => <option value={item.id} key={item.id}>{item.name} · ຄົງເຫຼືອ {item.stock} {item.unit}</option>)}</select></label>
          <label className="field"><span>ຈຳນວນ *</span><input className="form-control" name="quantity" type="number" min="0.001" step="0.001" required /></label>
          <label className="field"><span>ລາຄາ / ຫົວໜ່ວຍ (LAK) *</span><input className="form-control" name="unitPrice" type="number" min="0" step="0.01" required /></label>
          <label className="field form-span-2"><span>ໝາຍເຫດ</span><textarea className="form-control form-textarea" name="note" rows={3} /></label>
        </div>
        <div className="notice compact-notice">ລະບົບຈະອັບເດດຈຳນວນຄົງເຫຼືອ ແລະຄຳນວນຕົ້ນທຶນສະເລ່ຍແບບ ຄ່າສະເລ່ຍຖ່ວງນ້ຳໜັກ ອັດຕະໂນມັດ.</div>
      </div>
      <ErrorNotice error={error} />
      <div className="form-actions"><Link href="/inventory" className="button button-secondary">ຍົກເລີກ</Link><button className="button button-primary" disabled={!enabled || busy}>{busy ? "ກຳລັງບັນທຶກ..." : enabled ? "ຮັບເຂົ້າສາງ" : "ຕ້ອງເຊື່ອມຕໍ່ຖານຂໍ້ມູນ"}</button></div>
    </form>
  );
}

export function InventoryAdjustmentForm({ materials, enabled }: { materials: MaterialOption[]; enabled: boolean }) {
  const { busy, error, submit, markDirty, navigationDialog } = useSubmit("/api/inventory/adjust", "/inventory");
  async function onSubmit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); await submit(Object.fromEntries(form.entries())); }
  return (
    <form className="card form-card color-panel" onSubmit={onSubmit} onChangeCapture={markDirty}>
      {navigationDialog}
      <div className="form-section">
        <div className="color-panel-heading"><span className="panel-kicker">ປັບຍອດວັດຖຸດິບ</span><h2>ປັບຍອດວັດຖຸດິບ</h2></div>
        <div className="form-grid form-grid-2">
          <label className="field form-span-2"><span>ວັດຖຸດິບ *</span><select className="form-control" name="rawMaterialId" required defaultValue=""><option value="" disabled>ເລືອກວັດຖຸດິບ</option>{materials.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.stock} {item.unit}</option>)}</select></label>
          <label className="field"><span>ຈຳນວນປັບ (+/-) *</span><input className="form-control" name="quantityDelta" type="number" step="0.001" required placeholder="ເຊັ່ນ -0.25 ຫຼື 2" /></label>
          <label className="field"><span>ເຫດຜົນ *</span><select className="form-control" name="reason" defaultValue="count_correction"><option value="count_correction">ແກ້ໄຂຈາກການນັບ</option><option value="damage">ເສຍຫາຍ</option><option value="expiry">ໝົດອາຍຸ</option><option value="sample">ໃຊ້ທົດລອງ/ຕົວຢ່າງ</option><option value="other">ອື່ນໆ</option></select></label>
          <label className="field form-span-2"><span>ໝາຍເຫດ</span><textarea className="form-control form-textarea" name="note" rows={3} placeholder="ອະທິບາຍສາເຫດ/ເອກະສານອ້າງອີງ" /></label>
        </div>
      </div>
      <ErrorNotice error={error} />
      <div className="form-actions"><Link href="/inventory" className="button button-secondary">ຍົກເລີກ</Link><button className="button button-primary" disabled={!enabled || busy}>{busy ? "ກຳລັງບັນທຶກ..." : enabled ? "ບັນທຶກການປັບຈຳນວນຄົງເຫຼືອ" : "ຕ້ອງເຊື່ອມຕໍ່ຖານຂໍ້ມູນ"}</button></div>
    </form>
  );
}
