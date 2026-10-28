"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { ActionDialog } from "@/components/action-dialog";
import { showToast } from "@/lib/toast";
import { InlineFeedback } from "@/components/inline-feedback";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { moneyDecimalString, parseMoneyCents } from "@/lib/money";
import { parseDateOnly } from "@/lib/date-only";
import { operationFetch } from "@/lib/operation-request";

type StoreOption = { id: string; name: string };
export type EditableExpense = { id: string; category: string; amount: number; incurredAt: string; storeId: string | null; storeName?: string | null; note: string | null; receiptUrl: string | null };

const expenseEditSchema = z.object({
  category: z.string().trim().min(1, "ກະລຸນາໃສ່ປະເພດ"),
  amount: z.string().refine((value) => { const cents = parseMoneyCents(value); return cents !== null && cents > BigInt(0); }, "ຈຳນວນເງິນຕ້ອງຫຼາຍກວ່າ 0 ແລະມີບໍ່ເກີນ 2 ຕຳແໜ່ງ"),
  incurredAt: z.string().refine((value) => parseDateOnly(value) !== null, "ກະລຸນາໃສ່ວັນທີທີ່ຖືກຕ້ອງ"),
  storeId: z.string().optional(),
  note: z.string().optional(),
});
type ExpenseEditValues = z.infer<typeof expenseEditSchema>;

export function ExpenseVoidButton({ id, enabled }: { id: string; enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("ບັນທຶກຜິດ");

  async function voidExpense() {
    if (!enabled || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await operationFetch(`/api/expenses/${encodeURIComponent(id)}`, { reason: reason.trim() || "Voided by user" }, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "ບໍ່ສາມາດຍົກເລີກລາຍຈ່າຍໄດ້");
      setOpen(false);
      showToast({ tone: "warning", title: "ຍົກເລີກລາຍຈ່າຍແລ້ວ", message: "ລາຍການຍັງຄົງຢູ່ໃນປະຫວັດລະບົບ" });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ບໍ່ສາມາດຍົກເລີກລາຍຈ່າຍໄດ້");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="danger-action-v4">
      <button type="button" className="button button-ghost" disabled={!enabled || busy} onClick={() => { setError(null); setOpen(true); }}>ຍົກເລີກລາຍຈ່າຍ</button>
      <ActionDialog
        open={open}
        title="ຍົກເລີກລາຍຈ່າຍນີ້?"
        description="ລາຍການຈະບໍ່ຖືກນັບໃນລາຍງານ ແຕ່ຈະຍັງເກັບປະຫວັດການແກ້ໄຂໄວ້."
        confirmLabel="ຍົກເລີກລາຍຈ່າຍ"
        busy={busy}
        error={error}
        onClose={() => { if (!busy) setOpen(false); }}
        onConfirm={() => void voidExpense()}
      >
        <label className="field action-dialog-field-v4"><span>ເຫດຜົນ *</span><textarea className="form-control form-textarea" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} placeholder="ອະທິບາຍເຫດຜົນທີ່ຍົກເລີກ" /></label>
      </ActionDialog>
    </div>
  );
}

export function ExpenseEditForm({ expense, stores, enabled, modal = false, onCancel, onSaved, onBusyChange }: { expense: EditableExpense; stores: StoreOption[]; enabled: boolean; modal?: boolean; onCancel?: () => void; onSaved?: () => void; onBusyChange?: (busy: boolean) => void }) {
  const amountErrorId = useId();
  const dateErrorId = useId();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const receiptRef = useRef<HTMLInputElement>(null);
  const uploadedReceipt = useRef<{ fingerprint: string; url: string } | null>(null);
  const { register, handleSubmit, formState: { errors } } = useForm<ExpenseEditValues>({
    resolver: zodResolver(expenseEditSchema),
    defaultValues: {
      category: expense.category, amount: moneyDecimalString(parseMoneyCents(expense.amount)!), incurredAt: expense.incurredAt,
      storeId: expense.storeId ?? "", note: expense.note ?? "",
    },
  });

  const submit = handleSubmit(async (values) => {
    if (!enabled || busy) return;
    setBusy(true);
    onBusyChange?.(true);
    setError(null);
    try {
      let receiptUrl = expense.receiptUrl ?? "";
      const file = receiptRef.current?.files?.[0];
      if (file instanceof File && file.size > 0) {
        const fingerprint = JSON.stringify([file.name, file.size, file.lastModified, file.type]);
        if (uploadedReceipt.current?.fingerprint === fingerprint) receiptUrl = uploadedReceipt.current.url;
        else {
          const upload = new FormData(); upload.set("file", file);
          const uploaded = await fetch("/api/uploads/receipts", { method: "POST", body: upload });
          const uploadData = await uploaded.json().catch(() => ({}));
          if (!uploaded.ok) throw new Error(typeof uploadData.error === "string" ? uploadData.error : "Receipt upload failed");
          receiptUrl = typeof uploadData.url === "string" ? uploadData.url : receiptUrl;
          uploadedReceipt.current = { fingerprint, url: receiptUrl };
        }
      }
      const response = await operationFetch(`/api/expenses/${encodeURIComponent(expense.id)}`, {
        ...values, amount: moneyDecimalString(parseMoneyCents(values.amount)!), receiptUrl,
        expectedExpenseSnapshot: { category: expense.category, amount: moneyDecimalString(parseMoneyCents(expense.amount)!), incurredAt: expense.incurredAt, storeId: expense.storeId, note: expense.note, receiptUrl: expense.receiptUrl },
      }, { method: "PATCH" });
      const responseData = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseData.error || "ບໍ່ສາມາດແກ້ລາຍຈ່າຍໄດ້");
      showToast({ tone: "success", title: "ແກ້ໄຂລາຍຈ່າຍສຳເລັດ" });
      if (modal) onSaved?.(); else router.push("/expenses");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ບໍ່ສາມາດແກ້ລາຍຈ່າຍໄດ້");
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  });

  return (
    <form className={modal ? "expense-edit-form-v22" : "card form-card color-panel"} onSubmit={submit} noValidate aria-busy={busy}>
      <div className="form-section">
        {!modal && <div className="color-panel-heading"><span className="panel-kicker">ແກ້ໄຂລາຍຈ່າຍ</span><h2>ແກ້ໄຂລາຍຈ່າຍ</h2></div>}
        <div className="form-grid form-grid-2">
          <label className="field"><span>ປະເພດ</span><input className="form-control" data-expense-edit-autofocus {...register("category")} list="expense-edit-category-options" aria-invalid={!!errors.category} placeholder="ພິມປະເພດລາຍຈ່າຍ..." autoComplete="off" required /><datalist id="expense-edit-category-options"><option value="ຄ່າໄຟ"/><option value="ຄ່ານ້ຳມັນ"/><option value="ຄ່າຂົນສົ່ງ"/><option value="ຄ່າສ້ອມແປງ"/><option value="ຄ່າເຊົ່າ"/><option value="ຄ່າອຸປະກອນ"/><option value="ອື່ນໆ"/></datalist>{errors.category && <small className="field-error" role="alert">{errors.category.message}</small>}</label>
          <label className="field"><span>ຈຳນວນເງິນ (LAK) *</span><input className="form-control" {...register("amount")} type="number" inputMode="decimal" min="0.01" step="0.01" required aria-invalid={!!errors.amount} aria-describedby={errors.amount ? amountErrorId : undefined} />{errors.amount && <small id={amountErrorId} className="field-error" role="alert">{errors.amount.message}</small>}</label>
          <label className="field"><span>ວັນທີ *</span><input className="form-control" {...register("incurredAt")} type="date" required aria-invalid={!!errors.incurredAt} aria-describedby={errors.incurredAt ? dateErrorId : undefined} />{errors.incurredAt && <small id={dateErrorId} className="field-error" role="alert">{errors.incurredAt.message}</small>}</label>
          <label className="field"><span>ຮ້ານ</span><select className="form-control" {...register("storeId")}><option value="">ລາຍຈ່າຍກາງ</option>{expense.storeId && !stores.some((store) => store.id === expense.storeId) && <option value={expense.storeId}>{expense.storeName || "ຮ້ານເດີມ"} · ປິດໃຊ້ງານ</option>}{stores.map((store) => <option value={store.id} key={store.id}>{store.name}</option>)}</select></label>
          <label className="field form-span-2"><span>ໝາຍເຫດ</span><textarea className="form-control form-textarea" {...register("note")} rows={3} /></label>
          <label className="field form-span-2"><span>ໃບເສັດ / ຫຼັກຖານໃໝ່</span><input className="form-control" ref={receiptRef} name="receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" />{expense.receiptUrl && <small>ມີໄຟລ໌ແລ້ວ: <a href={expense.receiptUrl} target="_blank" rel="noreferrer">ເບິ່ງໃບເສັດ</a></small>}</label>
        </div>
      </div>
      {error && <InlineFeedback tone="error" title="ບັນທຶກບໍ່ສຳເລັດ">{error}</InlineFeedback>}
      <div className="form-actions">{modal ? <button type="button" className="button button-secondary" onClick={onCancel} disabled={busy}>ຍົກເລີກ</button> : <Link href="/expenses" className="button button-secondary">ຍົກເລີກ</Link>}<button className="button button-primary" aria-busy={busy} disabled={!enabled || busy}>{busy ? "ກຳລັງບັນທຶກ..." : enabled ? "ບັນທຶກ" : "ຕ້ອງເຊື່ອມຕໍ່ຖານຂໍ້ມູນ"}</button></div>
    </form>
  );
}
