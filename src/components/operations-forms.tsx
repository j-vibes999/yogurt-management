"use client";
import { useRouter } from "next/navigation"; import { useRef, useState, type FormEvent } from "react";
import { showToast } from "@/lib/toast";
import { operationFetch } from "@/lib/operation-request";
import { ActionDialog } from "@/components/action-dialog";
import { InlineFeedback } from "@/components/inline-feedback";
async function post(url:string,payload:unknown){const r=await operationFetch(url,payload);const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"ບັນທຶກບໍ່ສຳເລັດ");return d}
function useSubmission(){const pending=useRef(false);const [busy,setBusy]=useState(false);return {busy,begin(){if(pending.current)return false;pending.current=true;setBusy(true);return true},end(){pending.current=false;setBusy(false)}}}
function Status({error,ok}:{error:string;ok:string}){return <>{error&&<InlineFeedback tone="error" title="ບັນທຶກບໍ່ສຳເລັດ">{error}</InlineFeedback>}{ok&&<InlineFeedback tone="success">{ok}</InlineFeedback>}</>}
export function WasteForm({batches,enabled=true}:{batches:{id:string;label:string;remaining:number}[];enabled?:boolean}) {
  const router=useRouter(),formRef=useRef<HTMLFormElement>(null);
  const {busy,begin,end}=useSubmission();
  const [error,setError]=useState(""),[ok,setOk]=useState("");
  const [pending,setPending]=useState<{payload:Record<string,FormDataEntryValue>;label:string;quantity:number}|null>(null);
  const available=enabled&&batches.length>0;
  function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!available||busy)return;
    const payload=Object.fromEntries(new FormData(event.currentTarget).entries());
    const batch=batches.find(item=>item.id===payload.batchId);if(!batch)return;
    setError("");setOk("");setPending({payload,label:batch.label,quantity:Number(payload.quantity)});
  }
  async function confirmWaste(){
    if(!pending||!begin())return;
    setError("");
    try{
      await post("/api/finished-goods/adjust",pending.payload);
      setOk("ບັນທຶກຂອງເສຍແລ້ວ");showToast({tone:"success",title:"ບັນທຶກຂອງເສຍແລ້ວ"});
      setPending(null);formRef.current?.reset();router.refresh();
    }catch(caught){setError(caught instanceof Error?caught.message:"ບັນທຶກບໍ່ສຳເລັດ")}finally{end()}
  }
  return <form ref={formRef} className="card form-card color-panel color-domain-refills" onSubmit={submit} aria-busy={busy}>
    <div className="form-section"><h2 className="color-panel-heading">ຂອງເສຍ / ໝົດອາຍຸ</h2><p className="field-help">ຈຳນວນທີ່ບັນທຶກຈະຖືກຫັກອອກຈາກສິນຄ້າຄົງເຫຼືອໃນສາງກາງ.</p>
      {!available&&<InlineFeedback tone="info">{enabled?"ບໍ່ມີລັອດທີ່ມີສິນຄ້າຄົງເຫຼືອ":"ຕ້ອງເຊື່ອມຕໍ່ຖານຂໍ້ມູນກ່ອນບັນທຶກ"}</InlineFeedback>}
      <div className="form-grid form-grid-2">
        <label className="field"><span>ລັອດຜະລິດ</span><select className="form-control" name="batchId" required defaultValue="" disabled={!available||busy}><option value="" disabled>ເລືອກລັອດຜະລິດ</option>{batches.map(item=><option key={item.id} value={item.id}>{item.label} · {item.remaining} ຖ້ວຍ</option>)}</select></label>
        <label className="field"><span>ຈຳນວນ (ຖ້ວຍ)</span><input className="form-control" type="number" inputMode="numeric" min="1" step="1" name="quantity" required disabled={!available||busy}/></label>
        <label className="field"><span>ເຫດຜົນ</span><select className="form-control" name="reason" disabled={!available||busy}><option value="expired">ໝົດອາຍຸ</option><option value="damaged">ເສຍຫາຍ</option><option value="sample">ຕົວຢ່າງ</option><option value="other">ອື່ນໆ</option></select></label>
        <label className="field"><span>ໝາຍເຫດ</span><input className="form-control" name="note" disabled={!available||busy}/></label>
      </div>
    </div>
    <Status error={pending?"":error} ok={ok}/><button className="button button-primary" type="submit" disabled={!available||busy}>{busy?"ກຳລັງບັນທຶກ…":"ບັນທຶກຂອງເສຍ"}</button>
    <ActionDialog open={Boolean(pending)} title="ຢືນຢັນການຫັກສິນຄ້າ?" description={pending?`ຫັກ ${pending.quantity} ຖ້ວຍຈາກ ${pending.label}. ຈຳນວນຄົງເຫຼືອໃນສາງກາງຈະຫຼຸດລົງ.`:""} confirmLabel="ຢືນຢັນບັນທຶກຂອງເສຍ" busy={busy} error={error} onClose={()=>{if(!busy)setPending(null)}} onConfirm={()=>void confirmWaste()}/>
  </form>;
}
export { ClosingForm } from "./daily-closing-form";
export function UserForm(){const {busy,begin,end}=useSubmission();const r=useRouter(),[error,setError]=useState(""),[ok,setOk]=useState("");async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!begin())return;setError("");setOk("");const form=e.currentTarget;try{await post('/api/users',Object.fromEntries(new FormData(form).entries()));setOk('ສ້າງຜູ້ໃຊ້ແລ້ວ');showToast({tone:'success',title:'ສ້າງຜູ້ໃຊ້ແລ້ວ'});form.reset();r.refresh()}catch(x){setError(x instanceof Error?x.message:'ບັນທຶກບໍ່ສຳເລັດ')}finally{end()}}return <form className="card form-card color-panel" method="post" onSubmit={submit} aria-busy={busy}><div className="form-section"><h2 className="color-panel-heading">ຈັດການຜູ້ໃຊ້</h2><div className="form-grid form-grid-2"><label className="field"><span>ຊື່</span><input className="form-control" name="fullName" required/></label><label className="field"><span>ອີເມວ</span><input className="form-control" type="email" name="email" required/></label><label className="field"><span>ສິດການໃຊ້</span><select className="form-control" name="role"><option value="driver">ພະນັກງານສົ່ງ</option><option value="production">ຝ່າຍຜະລິດ</option><option value="admin">ຜູ້ດູແລລະບົບ</option></select></label><label className="field"><span>ລະຫັດຜ່ານ</span><input className="form-control" type="password" minLength={15} maxLength={256} name="password" required/></label></div></div><Status error={error} ok={ok}/><button className="button button-primary" type="submit" disabled={busy}>{busy?"ກຳລັງບັນທຶກ…":"ສ້າງຜູ້ໃຊ້"}</button></form>}
export function RecipeForm({recipes}:{recipes:{id:string;label:string;baseCups:number;items:{rawMaterialId:string;name:string;quantity:number}[]}[];materials:{id:string;name:string}[]}){const {busy,begin,end}=useSubmission();const r=useRouter(),[selected,setSelected]=useState(recipes[0]?.id||''),[error,setError]=useState(""),[ok,setOk]=useState("");const rec=recipes.find(x=>x.id===selected);async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!rec||!begin())return;setError("");setOk("");const f=new FormData(e.currentTarget);const items=rec.items.map(i=>({rawMaterialId:i.rawMaterialId,quantityRequired:Number(f.get('q_'+i.rawMaterialId))}));try{await post('/api/recipes',{recipeId:rec.id,name:f.get('name'),baseCups:Number(f.get('baseCups')),items});setOk('ສ້າງສະບັບສູດໃໝ່ແລ້ວ');showToast({tone:'success',title:'ສ້າງສະບັບສູດໃໝ່ແລ້ວ'});r.refresh()}catch(x){setError(x instanceof Error?x.message:'ບັນທຶກບໍ່ສຳເລັດ')}finally{end()}}return <form className="card form-card color-panel" onSubmit={submit} aria-busy={busy}><div className="form-section"><h2 className="color-panel-heading">ຈັດການສະບັບສູດ</h2><label className="field"><span>ສິນຄ້າ / ສູດ</span><select className="form-control" value={selected} onChange={e=>setSelected(e.target.value)}>{recipes.map(x=><option value={x.id} key={x.id}>{x.label}</option>)}</select></label>{rec&&<><div className="form-grid form-grid-2"><label className="field"><span>ຊື່</span><input className="form-control" name="name" defaultValue={rec.label}/></label><label className="field"><span>ຈຳນວນຖ້ວຍພື້ນຖານ</span><input className="form-control" name="baseCups" type="number" min="1" defaultValue={rec.baseCups}/></label>{rec.items.map(i=><label className="field" key={i.rawMaterialId}><span>{i.name}</span><input className="form-control" name={'q_'+i.rawMaterialId} type="number" step="0.0001" min="0.0001" defaultValue={i.quantity}/></label>)}</div></>}</div><Status error={error} ok={ok}/><button className="button button-primary" type="submit" disabled={!rec||busy}>{busy?"ກຳລັງບັນທຶກ…":"ສ້າງສະບັບໃໝ່"}</button></form>}
