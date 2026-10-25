import type { ReactNode } from "react";

export type AppIconName = "search" | "close" | "arrowRight" | "refresh" | "check" | "inbox" | "box" | "store" | "filter" | "sparkles" | "chevronDown";

export function AppIcon({ name, size = 18 }: { name: AppIconName; size?: number }) {
  const common = { width:size, height:size, viewBox:"0 0 24 24", fill:"none", stroke:"currentColor", strokeWidth:1.9, strokeLinecap:"round" as const, strokeLinejoin:"round" as const, "aria-hidden":true };
  const paths: Record<AppIconName, ReactNode> = {
    search:<><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></>,
    close:<><path d="M6 6l12 12M18 6 6 18"/></>,
    arrowRight:<><path d="M5 12h14M13 6l6 6-6 6"/></>,
    refresh:<><path d="M20 7h-6V1"/><path d="M20 7a9 9 0 1 0 1 8"/></>,
    check:<><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></>,
    inbox:<><path d="M4 5h16l-2 14H6Z"/><path d="M4.5 14h4l1.5 2h4l1.5-2h4"/></>,
    box:<><path d="m4 7 8-4 8 4-8 4Z"/><path d="M4 7v10l8 4 8-4V7M12 11v10"/></>,
    store:<><path d="M4 10v10h16V10"/><path d="M3 10h18l-2-6H5Z"/><path d="M8 20v-6h8v6"/></>,
    filter:<><path d="M4 6h16M7 12h10M10 18h4"/></>,
    sparkles:<><path d="m12 3 1.2 3.3L16.5 7.5l-3.3 1.2L12 12l-1.2-3.3-3.3-1.2 3.3-1.2Z"/><path d="m18 14 .7 1.8 1.8.7-1.8.7L18 19l-.7-1.8-1.8-.7 1.8-.7Z"/></>,
    chevronDown:<path d="m7 9 5 5 5-5"/>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}
