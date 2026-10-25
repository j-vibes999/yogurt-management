import type { ReactNode } from "react";
import { AppIcon, type AppIconName } from "@/components/app-icon";

export function EmptyState({ icon="inbox", title, description, action, compact=false }: { icon?:AppIconName; title:string; description?:string; action?:ReactNode; compact?:boolean }) {
  return <div className={`empty-state-v25 ${compact ? "is-compact" : ""}`}>
    <div className="empty-state-icon-v25"><AppIcon name={icon} size={compact?18:22}/></div>
    <div className="empty-state-copy-v25"><strong>{title}</strong>{description&&<span>{description}</span>}</div>
    {action&&<div className="empty-state-action-v25">{action}</div>}
  </div>;
}
