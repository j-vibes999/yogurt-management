"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export function ResponsiveDisclosure({ title, summary, children, className = "" }: { title: string; summary?: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 820px)");
    const sync = () => setOpen(!media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return <details className={`responsive-disclosure-v33 ${className}`.trim()} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><span><strong>{title}</strong>{summary && <small>{summary}</small>}</span><i aria-hidden="true"><ChevronDown size={17} /></i></summary>
    <div className="responsive-disclosure-content-v33">{children}</div>
  </details>;
}
