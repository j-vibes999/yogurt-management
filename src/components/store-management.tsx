"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ActionDialog } from "@/components/action-dialog";
import { showToast } from "@/lib/toast";
import { InlineFeedback } from "@/components/inline-feedback";
import { invalidateShell } from "@/lib/operation-request";
import { parseMoneyCents } from "@/lib/money";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";

export type EditableStore = {
  id: string;
  name: string;
  contactName: string;
  phone: string;
  whatsapp: string;
  facebook: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  commissionRate: number;
  monthlyElectricity: number;
};

export function StoreDeactivateButton({ id, name, enabled }: { id: string; name: string; enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function deactivate() {
    if (!enabled || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/stores/${encodeURIComponent(id)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "ບໍ່ສາມາດປິດຮ້ານໄດ້");
      setOpen(false);
      showToast({ tone: "success", title: "ປິດການໃຊ້ງານຮ້ານແລ້ວ", message: name });
      invalidateShell();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ບໍ່ສາມາດປິດຮ້ານໄດ້");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="danger-action-v4">
      <button type="button" className="button button-ghost" disabled={!enabled || busy} onClick={() => { setError(null); setOpen(true); }}>
        ປິດການໃຊ້ງານ
      </button>
      <ActionDialog
        open={open}
        title={`ປິດການໃຊ້ງານ “${name}” ?`}
        description="ປະຫວັດການຂາຍ ແລະບັນຊີຈະບໍ່ຖືກລຶບ. ລະບົບຈະບໍ່ຍອມປິດຮ້ານຖ້າຍັງມີ ການເຕີມສິນຄ້າທີ່ກຳລັງເຮັດ ຫຼືຍອດຄ້າງຮັບ."
        confirmLabel="ປິດການໃຊ້ງານ"
        busy={busy}
        error={error}
        onClose={() => { if (!busy) setOpen(false); }}
        onConfirm={() => void deactivate()}
      />
    </div>
  );
}

export function StoreEditForm({ store, enabled }: { store: EditableStore; enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const { allowNavigation, navigationDialog } = useUnsavedChanges(dirty);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enabled || busy) return;
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      const percentCents=parseMoneyCents(payload.commissionRate);
      if(percentCents===null||percentCents>BigInt(10000))throw new Error("ສ່ວນແບ່ງຮ້ານຕ້ອງຢູ່ລະຫວ່າງ 0–100% ແລະມີບໍ່ເກີນ 2 ຕຳແໜ່ງ");
      const commissionRate=`${percentCents/BigInt(10000)}.${(percentCents%BigInt(10000)).toString().padStart(4,"0")}`;
      const response = await fetch(`/api/stores/${encodeURIComponent(store.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, commissionRate }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "ບໍ່ສາມາດບັນທຶກຮ້ານໄດ້");
      showToast({ tone: "success", title: "ບັນທຶກການແກ້ໄຂຮ້ານແລ້ວ", message: store.name });
      setDirty(false);
      allowNavigation();
      router.push("/stores");
      invalidateShell();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ບໍ່ສາມາດບັນທຶກຮ້ານໄດ້");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form-card color-panel" onSubmit={submit} onChangeCapture={() => setDirty(true)}>
      {navigationDialog}
      <div className="form-section">
        <div className="color-panel-heading"><span className="panel-kicker">ຂໍ້ມູນຮ້ານ</span><h2>ແກ້ໄຂຂໍ້ມູນຮ້ານ</h2></div>
        <div className="form-grid form-grid-2">
          <label className="field"><span>ຊື່ຮ້ານ *</span><input className="form-control" name="name" required defaultValue={store.name} /></label>
          <label className="field"><span>ຊື່ຜູ້ຕິດຕໍ່</span><input className="form-control" name="contactName" defaultValue={store.contactName} /></label>
          <label className="field"><span>ເບີໂທ</span><input className="form-control" name="phone" defaultValue={store.phone} /></label>
          <label className="field"><span>WhatsApp</span><input className="form-control" name="whatsapp" defaultValue={store.whatsapp} /></label>
          <label className="field"><span>Facebook</span><input className="form-control" name="facebook" defaultValue={store.facebook} /></label>
          <label className="field"><span>ສ່ວນແບ່ງຮ້ານ (%)</span><input className="form-control" name="commissionRate" type="number" min="0" max="100" step="0.01" defaultValue={(store.commissionRate * 100).toFixed(2)} /></label>
          <label className="field form-span-2"><span>ທີ່ຢູ່</span><textarea className="form-control form-textarea" name="address" rows={3} defaultValue={store.address} /></label>
          <label className="field"><span>ເສັ້ນຂະໜານ</span><input className="form-control" name="latitude" inputMode="decimal" defaultValue={store.latitude ?? ""} /></label>
          <label className="field"><span>ເສັ້ນແວງ</span><input className="form-control" name="longitude" inputMode="decimal" defaultValue={store.longitude ?? ""} /></label>
          <label className="field"><span>ງົບຄ່າໄຟ/ເດືອນ (LAK)</span><input className="form-control" name="monthlyElectricity" type="number" inputMode="decimal" step="0.01" min="0" defaultValue={store.monthlyElectricity} /></label>
        </div>
      </div>
      {error && <InlineFeedback tone="error" title="ບັນທຶກບໍ່ສຳເລັດ">{error}</InlineFeedback>}
      <div className="form-actions">
        <Link href="/stores" className="button button-secondary">ຍົກເລີກ</Link>
        <button className="button button-primary" aria-busy={busy} disabled={!enabled || busy}>{busy ? "ກຳລັງບັນທຶກ..." : enabled ? "ບັນທຶກການແກ້ໄຂ" : "ຕ້ອງເຊື່ອມຕໍ່ຖານຂໍ້ມູນ"}</button>
      </div>
    </form>
  );
}
