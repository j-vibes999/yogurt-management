"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { invalidateShell } from "@/lib/operation-request";

export function DashboardRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className="dashboard-refresh"
      disabled={pending}
      aria-busy={pending}
      onClick={() => startTransition(() => { invalidateShell(); router.refresh(); })}
    >
      <RefreshCw size={14} aria-hidden="true" />
      <span>{pending ? "ກຳລັງໂຫຼດ..." : "ໂຫຼດໃໝ່"}</span>
    </button>
  );
}
