"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ListToolbar, FilterChips } from "@/components/list-toolbar";
import { EmptyState } from "@/components/empty-state";

type L = {
  id: string;
  actionKey: string;
  actionLabel: string;
  summary: string;
  entityType: string;
  storeName: string;
  userName: string;
  createdAt: string;
  diff: ReactNode;
};

export function AuditDirectory({ logs, total, query, filter }: { logs: L[]; total: number; query: string; filter: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(query);
  const [f, setF] = useState(filter);

  useEffect(() => { setQ(query); }, [query]);
  useEffect(() => { setF(filter); }, [filter]);

  useEffect(() => {
    if (q === query) return;
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (q.trim()) next.set("q", q.trim()); else next.delete("q");
      next.set("page", "1");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [q, query, params, pathname, router]);

  function changeFilter(value: string) {
    setF(value);
    const next = new URLSearchParams(params.toString());
    if (value === "all") next.delete("filter"); else next.set("filter", value);
    next.set("page", "1");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return <>
    <ListToolbar query={q} onQuery={setQ} placeholder="ຄົ້ນຫາຮ້ານ, ຜູ້ໃຊ້, ການປ່ຽນແປງ..." resultText={`${total} ລາຍການ`}>
      <FilterChips value={f} onChange={changeFilter} items={[
        { key: "all", label: "ທັງໝົດ" },
        { key: "update", label: "ແກ້ໄຂ" },
        { key: "adjust", label: "ປັບຈຳນວນ" },
        { key: "expense", label: "ລາຍຈ່າຍ" },
        { key: "user", label: "ຜູ້ໃຊ້" },
      ]}/>
    </ListToolbar>
    {logs.length ? <div className="card audit-log-card-v5 color-panel">{logs.map((x) => <div className="audit-log-row-v5" key={x.id}>
      <span className={`audit-action-v5 ${x.actionKey}`}>{x.actionLabel}</span>
      <div><strong>{x.summary}</strong><small>{x.storeName ? `${x.storeName} · ` : ""}{x.entityType}</small>{x.diff}</div>
      <div className="audit-who-v5"><strong>{x.userName}</strong><small>{x.createdAt}</small></div>
    </div>)}</div> : <EmptyState icon="search" title="ບໍ່ພົບປະຫວັດທີ່ກົງກັນ" description="ລອງປ່ຽນຄຳຄົ້ນຫາ ຫຼືຕົວກອງ" action={(q || f !== "all") ? <button type="button" className="button button-secondary" onClick={() => { setQ(""); changeFilter("all"); }}>ລ້າງຕົວກອງ</button> : undefined} />}
  </>;
}
