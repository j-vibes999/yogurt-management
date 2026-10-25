"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TOAST_EVENT, TOAST_PENDING_KEY, type ToastPayload } from "@/lib/toast";

type ToastItem = ToastPayload & { id: number };

export function ToastCenter() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, number>());

  const remove = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const push = useCallback((payload: ToastPayload) => {
    const id = ++seq.current;
    const item = { ...payload, tone: payload.tone ?? "success", id };
    setItems((current) => [...current.slice(-2), item]);
    const duration = Math.max(1800, payload.duration ?? (item.tone === "error" ? 5200 : 3600));
    timers.current.set(id, window.setTimeout(() => remove(id), duration));
  }, [remove]);

  useEffect(() => {
    const activeTimers = timers.current;
    const pending = window.sessionStorage.getItem(TOAST_PENDING_KEY);
    if (pending) {
      window.sessionStorage.removeItem(TOAST_PENDING_KEY);
      try { push(JSON.parse(pending) as ToastPayload); } catch { /* ignore malformed pending toast */ }
    }
    const onToast = (event: Event) => push((event as CustomEvent<ToastPayload>).detail);
    window.addEventListener(TOAST_EVENT, onToast);
    return () => {
      window.removeEventListener(TOAST_EVENT, onToast);
      for (const timer of activeTimers.values()) window.clearTimeout(timer);
      activeTimers.clear();
    };
  }, [push]);

  return <div className="app-toast-region-v15" aria-live="polite" aria-atomic="false">
    {items.map((item) => <div key={item.id} className={`app-toast-v15 is-${item.tone}`} role={item.tone === "error" ? "alert" : "status"}>
      <div className="app-toast-icon-v15" aria-hidden="true">{item.tone === "success" ? "✓" : item.tone === "error" ? "!" : item.tone === "warning" ? "!" : "i"}</div>
      <div className="app-toast-copy-v15"><strong>{item.title}</strong>{item.message && <span>{item.message}</span>}</div>
      <button type="button" className="app-toast-close-v15" aria-label="ປິດການແຈ້ງເຕືອນ" onClick={() => remove(item.id)}>×</button>
      <span className="app-toast-progress-v15" style={{ animationDuration: `${Math.max(1800, item.duration ?? (item.tone === "error" ? 5200 : 3600))}ms` }} />
    </div>)}
  </div>;
}
