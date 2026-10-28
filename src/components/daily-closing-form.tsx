"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { businessDateString } from "@/lib/date-only";
import { isDailyClosingSnapshot, type DailyClosingSnapshot } from "@/lib/daily-closing";
import { operationFetch } from "@/lib/operation-request";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import { showToast } from "@/lib/toast";
import { InlineFeedback } from "@/components/inline-feedback";

type Fields = { cashAmount: string; bankAmount: string; expenseAmount: string; note: string };
const emptyFields: Fields = { cashAmount: "0.00", bankAmount: "0.00", expenseAmount: "0.00", note: "" };
const fieldsOf = (snapshot: DailyClosingSnapshot | null): Fields => snapshot ? { cashAmount: snapshot.cashAmount, bankAmount: snapshot.bankAmount, expenseAmount: snapshot.expenseAmount, note: snapshot.note ?? "" } : { ...emptyFields };
const loadError = "ໂຫຼດຍອດເກົ່າບໍ່ໄດ້. ກະລຸນາລອງໃໝ່ກ່ອນບັນທຶກ";

export function ClosingForm() {
  const router = useRouter();
  const [date, setDate] = useState("");
  const [snapshot, setSnapshot] = useState<DailyClosingSnapshot | null | undefined>();
  const [fields, setFields] = useState<Fields>({ ...emptyFields });
  const [baseline, setBaseline] = useState(JSON.stringify(emptyFields));
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [ok, setOk] = useState("");
  const [conflict, setConflict] = useState(false), [reload, setReload] = useState(0);
  const pending = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const dirty = JSON.stringify(fields) !== baseline;
  const { requestDiscard, navigationDialog } = useUnsavedChanges(dirty);

  useEffect(() => { setDate(businessDateString()); }, []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => {
    if (!date) return;
    const controller = new AbortController();
    setLoading(true); setSnapshot(undefined); setError(""); setOk(""); setConflict(false);
    async function load() {
      try {
        const response = await fetch(`/api/daily-closing?date=${encodeURIComponent(date)}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || loadError);
        if (data.closingDate !== date || !(data.snapshot === null || isDailyClosingSnapshot(data.snapshot))) throw new Error(loadError);
        if (controller.signal.aborted) return;
        const next = fieldsOf(data.snapshot);
        setSnapshot(data.snapshot); setFields(next); setBaseline(JSON.stringify(next));
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : loadError);
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [date, reload]);

  function update(field: keyof Fields, value: string) {
    setFields(current => ({ ...current, [field]: value })); setOk("");
  }
  function changeDate(value: string) {
    if (value === date || busy) return;
    requestDiscard(() => { setFields({ ...emptyFields }); setBaseline(JSON.stringify(emptyFields)); setDate(value); });
  }
  function reloadLatest() {
    requestDiscard(() => setReload(value => value + 1));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || snapshot === undefined || loading || conflict || !date) return;
    pending.current = true; setBusy(true); setError(""); setOk("");
    try {
      const response = await operationFetch("/api/daily-closing", { closingDate: date, ...fields, expectedSnapshot: snapshot });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (data.code === "STALE_CLOSING") setConflict(true);
        throw new Error(data.error || "ບັນທຶກບໍ່ສຳເລັດ");
      }
      if (!isDailyClosingSnapshot(data.snapshot) || data.id !== data.snapshot.id) throw new Error("ຍັງຢືນຢັນຜົນບັນທຶກບໍ່ໄດ້. ກະລຸນາລອງຄຳຂໍເກົ່າອີກຄັ້ງ");
      const next = fieldsOf(data.snapshot);
      setSnapshot(data.snapshot); setFields(next); setBaseline(JSON.stringify(next));
      setOk("ບັນທຶກຍອດປະຈຳວັນແລ້ວ");
      showToast({ tone: "success", title: "ບັນທຶກຍອດປະຈຳວັນແລ້ວ" });
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "ບັນທຶກບໍ່ສຳເລັດ"); }
    finally { pending.current = false; setBusy(false); }
  }

  const disabled = busy || loading || snapshot === undefined;
  return <form className="card form-card color-panel color-domain-finance" onSubmit={submit} aria-busy={busy || loading}>
    <div className="form-section">
      <h2 className="color-panel-heading">ປິດຍອດປະຈຳວັນ</h2>
      <p className="field-help">ເລືອກວັນທີເພື່ອໂຫຼດຍອດເດີມ ແລ້ວກວດເງິນສົດ, ເງິນໂອນ ແລະລາຍຈ່າຍກ່ອນບັນທຶກ.</p>
      <label className="field"><span>ວັນທີ</span><input className="form-control" name="closingDate" type="date" required value={date} disabled={busy} onChange={event => changeDate(event.target.value)} /></label>
      {loading && <InlineFeedback tone="info">ກຳລັງໂຫຼດຍອດຂອງວັນທີເລືອກ…</InlineFeedback>}
      {!loading && snapshot !== undefined && <InlineFeedback tone={snapshot ? "warning" : "info"}>{snapshot ? "ໂຫຼດຍອດເດີມແລ້ວ — ກວດຕົວເລກກ່ອນບັນທຶກການແກ້ໄຂ" : "ວັນນີ້ຍັງບໍ່ມີຍອດປິດ — ກະລຸນາກອກຍອດໃໝ່"}</InlineFeedback>}
      <div className="form-grid form-grid-2">
        {([["cashAmount", "ເງິນສົດ (LAK)"], ["bankAmount", "ເງິນໂອນ (LAK)"], ["expenseAmount", "ລາຍຈ່າຍ (LAK)"]] as const).map(([name, label]) => <label className="field" key={name}><span>{label}</span><input className="form-control" name={name} type="number" inputMode="decimal" min="0" step="0.01" required disabled={disabled} value={fields[name]} onChange={event => update(name, event.target.value)} /></label>)}
        <label className="field form-span-2"><span>ໝາຍເຫດ</span><input className="form-control" name="note" maxLength={1000} disabled={disabled} value={fields.note} onChange={event => update("note", event.target.value)} /></label>
      </div>
    </div>
    {error && <div ref={errorRef} tabIndex={-1}><InlineFeedback tone="error" title="ບັນທຶກຍອດບໍ່ສຳເລັດ">{error}</InlineFeedback></div>}
    {ok && <InlineFeedback tone="success">{ok}</InlineFeedback>}
    {!loading && (snapshot === undefined || conflict) && <button type="button" className="button button-secondary" onClick={reloadLatest}>ໂຫຼດຍອດລ່າສຸດ</button>}
    <button className="button button-primary" type="submit" disabled={disabled || conflict || !date}>{busy ? "ກຳລັງບັນທຶກ…" : snapshot ? "ບັນທຶກການແກ້ໄຂຍອດ" : "ບັນທຶກປິດຍອດປະຈຳວັນ"}</button>
    {navigationDialog}
  </form>;
}
