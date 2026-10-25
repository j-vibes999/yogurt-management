"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ActionDialog } from "@/components/action-dialog";
import { showToast } from "@/lib/toast";
import { invalidateShell } from "@/lib/operation-request";

type Status = "waiting" | "preparing" | "delivering" | "completed" | "cancelled";

const next: Partial<Record<Status, Status>> = {
  waiting: "preparing",
  preparing: "delivering",
  delivering: "completed",
};

const labels: Partial<Record<Status, string>> = {
  preparing: "ເລີ່ມຈັດສິນຄ້າ",
  delivering: "ອອກນຳສົ່ງ",
  completed: "ຢືນຢັນສົ່ງສຳເລັດ",
};

export function RefillStatusButton({ id, status, enabled }: { id: string; status: Status; enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const target = next[status];
  const canCancel = status === "waiting" || status === "preparing" || status === "delivering";
  if (!target && !canCancel) return null;

  async function updateStatus(nextStatus: Status) {
    if (!enabled || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/refills/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "ບໍ່ສາມາດອັບເດດສະຖານະໄດ້");
      invalidateShell();
      if (nextStatus === "cancelled") setCancelOpen(false);
      showToast({ tone: nextStatus === "cancelled" ? "warning" : "success", title: nextStatus === "completed" ? "ສົ່ງສິນຄ້າສຳເລັດ" : nextStatus === "cancelled" ? "ຍົກເລີກຄຳຂໍເຕີມສິນຄ້າແລ້ວ" : "ອັບເດດສະຖານະການເຕີມສິນຄ້າແລ້ວ" });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ບໍ່ສາມາດອັບເດດສະຖານະໄດ້");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="refill-actions-v4">
      <div className="refill-action-buttons-v4">
        {target && (
          <button className="button button-primary" type="button" disabled={!enabled || busy} onClick={() => void updateStatus(target)}>
            {busy ? "ກຳລັງບັນທຶກ..." : enabled ? labels[target] : "ຕ້ອງເຊື່ອມຕໍ່ຖານຂໍ້ມູນ"}
          </button>
        )}
        {canCancel && <button className="button button-ghost" type="button" disabled={!enabled || busy} onClick={() => { setError(null); setCancelOpen(true); }}>ຍົກເລີກ</button>}
      </div>
      {error && !cancelOpen && <span className="inline-action-error-v4" role="alert">{error}</span>}
      <ActionDialog
        open={cancelOpen}
        title="ຍົກເລີກຄຳຂໍເຕີມສິນຄ້າ?"
        description="ຄຳຂໍນີ້ຈະປ່ຽນເປັນ ຍົກເລີກແລ້ວ. ຈຳນວນສິນຄ້າສ່ວນກາງຈະບໍ່ຖືກຫັກ ເພາະການສົ່ງຍັງບໍ່ໄດ້ຖືກຢືນຢັນສຳເລັດ."
        confirmLabel="ຍົກເລີກຄຳຂໍ"
        busy={busy}
        error={error}
        onClose={() => { if (!busy) setCancelOpen(false); }}
        onConfirm={() => void updateStatus("cancelled")}
      />
    </div>
  );
}
