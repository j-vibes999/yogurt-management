"use client";

import { useEffect, useRef, type RefObject } from "react";
import { focusWithoutScroll } from "@/lib/modal-scroll-lock";

const selector = [
  "[data-dialog-autofocus]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
].join(",");

export function useDialogFocus(
  active: boolean,
  dialogRef: RefObject<HTMLElement | null>,
  onEscape?: () => void,
) {
  const escapeRef = useRef(onEscape);
  useEffect(() => { escapeRef.current = onEscape; }, [onEscape]);

  useEffect(() => {
    if (!active) return;
    const root = dialogRef.current;
    if (!root) return;

    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => [...root.querySelectorAll<HTMLElement>(selector)].filter((el) => el.offsetParent !== null);
    const preferred = root.querySelector<HTMLElement>("[data-dialog-autofocus]") ?? focusable()[0] ?? root;
    const timer = window.setTimeout(() => focusWithoutScroll(preferred), 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        escapeRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        focusWithoutScroll(last);
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        focusWithoutScroll(first);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown);
      if (previous?.isConnected) window.setTimeout(() => focusWithoutScroll(previous), 0);
    };
  }, [active, dialogRef]);
}
