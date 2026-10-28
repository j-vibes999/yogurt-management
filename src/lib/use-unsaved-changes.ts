"use client";

import { createElement, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionDialog } from "@/components/action-dialog";
import { shouldWarnForLink } from "./navigation-guard";

/** Guard page exits only while values exist that the caller cannot restore. */
export function useUnsavedChanges(dirty: boolean) {
  const router = useRouter();
  const dirtyRef = useRef(dirty);
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);
  dirtyRef.current = dirty;
  const allowNavigation = useCallback(() => { dirtyRef.current = false; }, []);
  const requestDiscard = useCallback((action: () => void) => {
    if (!dirtyRef.current) { action(); return; }
    setPendingNavigation(() => action);
  }, []);

  useEffect(() => {
    // An autosave can finish while the discard dialog is open.
    if (!dirty && pendingNavigation) {
      setPendingNavigation(null);
      pendingNavigation();
    }
  }, [dirty, pendingNavigation]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const beforeLink = (event: MouseEvent) => {
      if (!dirtyRef.current || event.defaultPrevented || !(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link || !shouldWarnForLink(window.location.href, link.href, { target: link.target, download: link.hasAttribute("download") }, event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const destination = new URL(link.href, window.location.href);
      requestDiscard(() => {
        allowNavigation();
        if (destination.origin === window.location.origin) router.push(`${destination.pathname}${destination.search}${destination.hash}`);
        else window.location.assign(destination.href);
      });
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", beforeLink, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", beforeLink, true);
    };
  }, [allowNavigation, requestDiscard, router]);

  // Call immediately before successful programmatic navigation; the next render
  // again reflects the caller's dirty state so a surviving form stays protected.
  const navigationDialog = createElement(ActionDialog, {
    open: pendingNavigation !== null,
    title: "ມີຂໍ້ມູນທີ່ຍັງບໍ່ໄດ້ເກັບ",
    description: "ການອອກຈາກໜ້ານີ້ ຫຼືປ່ຽນຂໍ້ມູນຈະປະຖິ້ມການປ່ຽນແປງທີ່ຍັງບໍ່ໄດ້ເກັບ. ຢືນຢັນປະຖິ້ມບໍ?",
    confirmLabel: "ປະຖິ້ມການປ່ຽນແປງ",
    onClose: () => setPendingNavigation(null),
    onConfirm: () => { const action = pendingNavigation; setPendingNavigation(null); action?.(); },
  });
  return { allowNavigation, requestDiscard, navigationDialog };
}
