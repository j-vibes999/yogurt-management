"use client";

import { useRouter } from "next/navigation";
import { showToast } from "@/lib/toast";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { focusWithoutScroll, useModalScrollLock } from "@/lib/modal-scroll-lock";
import { invalidateShell } from "@/lib/operation-request";

type Fridge = {
  id: string;
  assetCode: string;
  model: string;
  serialNo: string;
  capacityCups: number;
  status: "active" | "maintenance";
  storeId: string | null;
  storeName: string;
  stockTotal: number;
};
type StoreOption = { id: string; name: string };

export function FridgeManager({ fridge, stores, enabled }: { fridge: Fridge; stores: StoreOption[]; enabled: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedStore,setSelectedStore]=useState(fridge.storeId ?? "");
  const [selectedStatus,setSelectedStatus]=useState<"active"|"maintenance">(fridge.status);
  const dialogRef = useRef<HTMLFormElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => { if(!busy){ setOpen(false); setError(null); setSuccess(null); } }, [busy]);

  useModalScrollLock(open);
  useEffect(()=>{
    if(!open) return;
    const timer=window.setTimeout(()=>focusWithoutScroll(firstFieldRef.current),30);
    function onKeyDown(e:KeyboardEvent){
      if(e.key==="Escape"){ e.preventDefault(); close(); return; }
      if(e.key!=="Tab") return;
      const root=dialogRef.current; if(!root) return;
      const focusable=[...root.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]')].filter(el=>el.offsetParent!==null);
      if(!focusable.length) return;
      const first=focusable[0], last=focusable[focusable.length-1];
      if(e.shiftKey && document.activeElement===first){e.preventDefault();focusWithoutScroll(last);}
      else if(!e.shiftKey && document.activeElement===last){e.preventDefault();focusWithoutScroll(first);}
    }
    document.addEventListener("keydown",onKeyDown);
    return()=>{window.clearTimeout(timer);document.removeEventListener("keydown",onKeyDown);};
  },[open,close]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enabled || busy) return;
    setBusy(true); setError(null); setSuccess(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/fridges/${encodeURIComponent(fridge.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "ບໍ່ສາມາດບັນທຶກຕູ້ແຊ່ໄດ້");
      setSuccess("ບັນທຶກຕູ້ແຊ່ສຳເລັດ ✓");
      showToast({ tone: "success", title: "ບັນທຶກຕູ້ແຊ່ສຳເລັດ", message: fridge.assetCode });
      invalidateShell();
      router.refresh();
      window.setTimeout(()=>setOpen(false),650);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ບໍ່ສາມາດບັນທຶກຕູ້ແຊ່ໄດ້");
    } finally { setBusy(false); }
  }

  const moving = selectedStore !== (fridge.storeId ?? "");
  const maintenanceChange = selectedStatus === "maintenance" && fridge.status !== "maintenance";
  const blockedByStock = fridge.stockTotal > 0 && (moving || maintenanceChange);

  return <div className="fridge-manager-v6">
    <button type="button" className="button button-ghost" onClick={() => {setSelectedStore(fridge.storeId??"");setSelectedStatus(fridge.status);setOpen(true);}}>
      ຈັດການ
    </button>
    {open && <div className="fridge-modal-backdrop-v6" role="presentation" onMouseDown={(e)=>{if(e.target===e.currentTarget)close();}}>
      <form ref={dialogRef} onSubmit={save} className="fridge-modal-v6 color-panel" role="dialog" aria-modal="true" aria-labelledby={`fridge-title-${fridge.id}`}>
        <header className="fridge-modal-head-v6 color-panel-heading">
          <div><span className="panel-kicker">ຕູ້ແຊ່</span><h2 id={`fridge-title-${fridge.id}`}>ແກ້ໄຂ {fridge.assetCode}</h2><p>{fridge.storeName || "ຍັງບໍ່ຜູກຮ້ານ"}</p></div>
          <button type="button" className="fridge-modal-close-v6" aria-label="ປິດ" onClick={close} disabled={busy}>×</button>
        </header>

        <div className="fridge-modal-body-v6">
          {fridge.stockTotal > 0 && <div className="fridge-stock-note-v6"><strong>ມີສິນຄ້າ {fridge.stockTotal} ຖ້ວຍ</strong><span>ຕ້ອງຈັດການສິນຄ້າຄົງເຫຼືອ ໃຫ້ເຫຼືອ 0 ກ່ອນຍ້າຍຮ້ານ ຫຼືເຂົ້າບຳລຸງ.</span></div>}
          <section className="fridge-modal-section-v6"><div className="fridge-modal-section-title-v6 color-section-heading"><strong>ຂໍ້ມູນຕູ້</strong><span>ລະຫັດຕູ້, ໝາຍເລກປະຈຳເຄື່ອງ, ຮຸ່ນ ແລະຄວາມຈຸ</span></div>
            <div className="form-grid form-grid-2 fridge-form-grid-v6">
              <label className="field"><span>ລະຫັດຕູ້</span><input ref={firstFieldRef} className="form-control" name="assetCode" defaultValue={fridge.assetCode} required /></label>
              <label className="field"><span>ໝາຍເລກປະຈຳເຄື່ອງ</span><input className="form-control" name="serialNo" defaultValue={fridge.serialNo === "—" ? "" : fridge.serialNo} /></label>
              <label className="field"><span>ຮຸ່ນ</span><input className="form-control" name="model" defaultValue={fridge.model === "—" ? "" : fridge.model} /></label>
              <label className="field"><span>ຄວາມຈຸ (ຖ້ວຍ)</span><input className="form-control" name="capacityCups" type="number" min="1" defaultValue={fridge.capacityCups} required /></label>
            </div>
          </section>
          <section className="fridge-modal-section-v6"><div className="fridge-modal-section-title-v6 color-section-heading"><strong>ການໃຊ້ງານ</strong><span>ສະຖານະ ແລະຮ້ານທີ່ຕິດຕັ້ງ</span></div>
            <div className="form-grid form-grid-2 fridge-form-grid-v6">
              <label className="field"><span>ສະຖານະ</span><select className="form-control" name="status" value={selectedStatus} onChange={e=>setSelectedStatus(e.target.value as "active"|"maintenance")}><option value="active">ປົກກະຕິ</option><option value="maintenance">ບຳລຸງຮັກສາ</option></select></label>
              <label className="field"><span>ຮ້ານ</span><select className="form-control" name="currentStoreId" value={selectedStore} onChange={e=>setSelectedStore(e.target.value)}><option value="">ບໍ່ຜູກຮ້ານ</option>{stores.map(store=><option value={store.id} key={store.id}>{store.name}</option>)}</select></label>
            </div>
          </section>
          {blockedByStock && <div className="fridge-blocked-v6"><strong>ຍັງບັນທຶກການຍ້າຍ/ບຳລຸງບໍ່ໄດ້</strong><span>ຕູ້ນີ້ຍັງມີສິນຄ້າ {fridge.stockTotal} ຖ້ວຍ. ກະລຸນາຈັດການສິນຄ້າຄົງເຫຼືອ ກ່ອນ.</span></div>}
          {error && <div className="fridge-modal-message-v6 is-error" role="alert"><strong>ບັນທຶກບໍ່ສຳເລັດ</strong><span>{error}</span></div>}
          {success && <div className="fridge-modal-message-v6 is-success" role="status">{success}</div>}
        </div>

        <footer className="fridge-modal-foot-v6">
          <button type="button" className="button button-ghost" onClick={close} disabled={busy}>ຍົກເລີກ</button>
          <button className={`button button-primary ${busy?"is-busy":""}`} disabled={!enabled || busy || blockedByStock}>
            {busy && <span className="button-spinner-v13" aria-hidden="true"/>}<span>{busy ? "ກຳລັງບັນທຶກ..." : "ບັນທຶກການປ່ຽນແປງ"}</span>
          </button>
        </footer>
      </form>
    </div>}
  </div>;
}
