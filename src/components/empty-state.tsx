import type { ReactNode } from "react";
import { AppIcon, type AppIconName } from "@/components/app-icon";

export function EmptyState({ icon="inbox", title, description, action, compact=false }: { icon?:AppIconName; title:string; description?:string; action?:ReactNode; compact?:boolean }) {
  return <div className={`empty-state ${compact ? "is-compact" : ""}`.trim()}>
    <div className="empty-state-icon" aria-hidden="true"><AppIcon name={icon} size={compact?18:22}/></div>
    <div className="empty-state-copy"><strong>{title}</strong>{description&&<span>{description}</span>}</div>
    {action&&<div className="empty-state-action">{action}</div>}
  </div>;
}
