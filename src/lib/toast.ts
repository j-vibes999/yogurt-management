export type ToastTone = "success" | "error" | "warning" | "info";
export type ToastPayload = { tone?: ToastTone; title: string; message?: string; duration?: number };
export const TOAST_EVENT = "yogurt:toast";
export const TOAST_PENDING_KEY = "yogurt:pending-toast";

export function showToast(payload: ToastPayload) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ToastPayload>(TOAST_EVENT, { detail: payload }));
}

export function persistToast(payload: ToastPayload) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(TOAST_PENDING_KEY, JSON.stringify(payload));
}
