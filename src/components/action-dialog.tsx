"use client";

import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, Check, X } from "lucide-react";

type Props = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
  error?: string | null;
  tone?: "danger" | "primary";
  children?: ReactNode;
};

export function ActionDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
  busy = false,
  error,
  tone = "danger",
  children,
}: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="action-dialog-backdrop-v4" />
        <div className="action-dialog-positioner-v42">
        <Dialog.Content
          className="action-dialog-v4"
          onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
          onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}
        >
          <Dialog.Close asChild disabled={busy}>
            <button className="action-dialog-close-v4" type="button" aria-label="ປິດ" disabled={busy}>
              <X size={18} aria-hidden="true" />
            </button>
          </Dialog.Close>
          <span className={`action-dialog-icon-v4 ${tone}`} aria-hidden="true">
            {tone === "danger" ? <AlertTriangle size={22} /> : <Check size={22} />}
          </span>
          <div className="action-dialog-copy-v4">
            <Dialog.Title asChild><h2>{title}</h2></Dialog.Title>
            <Dialog.Description asChild><p>{description}</p></Dialog.Description>
          </div>
          {children && <div className="action-dialog-content-v4">{children}</div>}
          {error && <div className="action-dialog-error-v4" role="alert">{error}</div>}
          <div className="action-dialog-actions-v4">
            <Dialog.Close asChild disabled={busy}>
              <button type="button" className="button button-secondary" disabled={busy}>ຍົກເລີກ</button>
            </Dialog.Close>
            <button type="button" className={`button ${tone === "danger" ? "button-danger" : "button-primary"} ${busy ? "is-busy" : ""}`} aria-busy={busy} disabled={busy} onClick={onConfirm}>
              {busy && <span className="button-spinner-v13" aria-hidden="true" />}
              <span>{busy ? "ກຳລັງບັນທຶກ..." : confirmLabel}</span>
            </button>
          </div>
        </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
