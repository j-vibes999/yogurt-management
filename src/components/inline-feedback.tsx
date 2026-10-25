import type { ReactNode } from "react";

type Tone = "error" | "success" | "warning" | "info";

export function InlineFeedback({ tone, title, children, className = "" }: { tone: Tone; title?: string; children?: ReactNode; className?: string }) {
  return (
    <div className={`inline-feedback-v41 is-${tone} ${className}`.trim()} role={tone === "error" ? "alert" : "status"}>
      <span className="inline-feedback-icon-v41" aria-hidden="true">{tone === "success" ? "✓" : tone === "error" ? "!" : tone === "warning" ? "!" : "i"}</span>
      <div>{title && <strong>{title}</strong>}{children && <span>{children}</span>}</div>
    </div>
  );
}
