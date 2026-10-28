"use client";

import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { StoreDeactivateButton } from "@/components/store-management";
import { canRoleOpen } from "@/lib/access-policy";
import type { UserRole } from "@/lib/auth-session";

type StoreItem = {
  id: string;
  name: string;
  contactName: string;
  phone: string;
  address: string;
  fridgeStartDate: string;
  monthlyElectricity: number;
  stock: number;
  due: boolean;
  fridge: { assetCode: string; capacityCups: number; status: "active" | "maintenance" } | null;
};

type FilterKey = "attention" | "all" | "due" | "low" | "maintenance";

export function StoreDirectory({ stores, enabled, role }: { stores: StoreItem[]; enabled: boolean; role: UserRole | null }) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("attention");
  const [sort, setSort] = useState<"priority"|"name"|"stock">("priority");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const canAudit = enabled && canRoleOpen(role, "/driver");
  const canManage = enabled && canRoleOpen(role, "/stores/new");
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // The confirmation is portaled outside this menu and must remain mounted while it is open.
    const confirmationOpen = () => Boolean(document.querySelector('[role="dialog"][data-state="open"]'));
    const close = (event: MouseEvent) => { if (!confirmationOpen() && menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuId(null); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || confirmationOpen() || !menuRef.current) return;
      menuRef.current.querySelector<HTMLButtonElement>("button")?.focus();
      setMenuId(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, []);

  const counts = useMemo(() => ({
    all: stores.length,
    attention: stores.filter((store) => store.due || store.stock / Math.max(store.fridge?.capacityCups ?? 100, 1) <= 0.35 || store.fridge?.status === "maintenance").length,
    due: stores.filter((store) => store.due).length,
    low: stores.filter((store) => store.stock / Math.max(store.fridge?.capacityCups ?? 100, 1) <= 0.35).length,
    maintenance: stores.filter((store) => store.fridge?.status === "maintenance").length,
  }), [stores]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return stores.filter((store) => {
      const capacity = store.fridge?.capacityCups ?? 100;
      const low = store.stock / Math.max(capacity, 1) <= 0.35;
      const matchesText = !needle || [store.name, store.contactName, store.phone, store.address, store.fridge?.assetCode ?? ""]
        .join(" ")
        .toLocaleLowerCase()
        .includes(needle);
      const matchesFilter = filter === "all"
        || (filter === "attention" && (store.due || low || store.fridge?.status === "maintenance"))
        || (filter === "due" && store.due)
        || (filter === "low" && low)
        || (filter === "maintenance" && store.fridge?.status === "maintenance");
      return matchesText && matchesFilter;
    });
  }, [query, filter, stores]);

  const filters: Array<{ key: FilterKey; label: string }> = [
    { key: "attention", label: "ຕ້ອງຈັດການ" },
    { key: "all", label: "ທັງໝົດ" },
    { key: "due", label: "ຮອດຮອບ" },
    { key: "low", label: "ຈຳນວນຄົງເຫຼືອຕ່ຳ" },
    { key: "maintenance", label: "ບຳລຸງ" },
  ];

  return (
    <section className="store-directory-v4">
      <div className="store-toolbar-v4">
        <label className="store-search-v4">
          <span aria-hidden="true">⌕</span>
          <input aria-label="ຄົ້ນຫາຮ້ານ" placeholder="ຄົ້ນຫາຮ້ານ, ເບີໂທ, ຜູ້ຕິດຕໍ່, ລະຫັດຕູ້..." value={query} onChange={(event) => setQuery(event.target.value)} />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="ລ້າງການຄົ້ນຫາ">×</button>}
        </label>
        <div className="store-filter-row-v4">
          {filters.map((item) => <button key={item.key} type="button" className={filter === item.key ? "is-active" : undefined} aria-pressed={filter === item.key} onClick={() => setFilter(item.key)}>{item.label}<span>{counts[item.key]}</span></button>)}
        </div>
        <label className="list-sort-v1">ຮຽງ <select value={sort} onChange={e=>setSort(e.target.value as "priority"|"name"|"stock")}><option value="priority">ຕ້ອງຈັດການກ່ອນ</option><option value="stock">ຈຳນວນຄົງເຫຼືອຕ່ຳກ່ອນ</option><option value="name">ຕາມຊື່ຮ້ານ</option></select></label>
        <div className="store-result-v4" role="status" aria-live="polite" aria-atomic="true">ພົບ <strong>{filtered.length}</strong> ຈາກ {stores.length} ຮ້ານ</div>
      </div>

      {filtered.length ? (
        <>
        <div id={listId} className={`store-card-list-v4 progressive-list-v33 ${expanded ? "is-expanded" : ""}`}>
          {[...filtered].sort((a,b) => {
            if(sort==="name") return a.name.localeCompare(b.name);
            if(sort==="stock") return (a.stock/Math.max(a.fridge?.capacityCups??100,1))-(b.stock/Math.max(b.fridge?.capacityCups??100,1)) || a.name.localeCompare(b.name);
            const priority = (x: StoreItem) => x.fridge?.status === "maintenance" ? 0 : x.due ? 1 : (x.stock / Math.max(x.fridge?.capacityCups ?? 100, 1) <= .35 ? 2 : 3);
            return priority(a)-priority(b) || a.name.localeCompare(b.name);
          }).map((store) => {
            const capacity = store.fridge?.capacityCups ?? 100;
            const percent = Math.max(0, Math.min(100, Math.round((store.stock / Math.max(capacity, 1)) * 100)));
            const maintenance = store.fridge?.status === "maintenance";
            const low = percent <= 35;
            const statusClass = maintenance ? "maintenance" : store.due ? "due" : low ? "low" : "ok";
            const statusLabel = maintenance ? "ບຳລຸງຮັກສາ" : store.due ? "ຮອດຮອບກວດ" : low ? "ຈຳນວນຄົງເຫຼືອຕ່ຳ" : "ປົກກະຕິ";
            return (
              <article className="store-card-v4" key={store.id}>
                <div className="store-card-main-v4">
                  <div className="store-card-title-v4"><span className={`store-state-v4 ${statusClass}`} /><div>{enabled ? <Link prefetch={false} className="store-title-link-v1" href={`/stores/${store.id}`}><strong>{store.name}</strong><span aria-hidden="true">↗</span></Link> : <strong>{store.name}</strong>}<span>{store.contactName} · {store.phone}</span></div></div>
                  <p>{store.address}</p>
                </div>
                <div className="store-card-fridge-v4">
                  <span className="store-card-label-v4">ຕູ້ແຊ່</span>
                  <strong>{store.fridge?.assetCode ?? "—"}</strong>
                  <span>ເລີ່ມ {store.fridgeStartDate}</span>
                </div>
                <div className="store-card-stock-v4">
                  <div className="store-stock-head-v4"><span>ຄົງເຫຼືອ</span><strong>{store.stock}/{capacity}</strong></div>
                  <div className="store-stock-meter-v4"><i className={low ? "low" : ""} style={{ width: `${percent}%` }} /></div>
                  <span>{percent}% · ຄ່າໄຟ {store.monthlyElectricity.toLocaleString()} LAK/ເດືອນ</span>
                </div>
                <div className="store-card-actions-v4">
                  <span className={`store-status-v4 ${statusClass}`}>{statusLabel}</span>
                  <div className="store-action-line-v7" ref={menuId === store.id ? menuRef : undefined}>
                    {canAudit && store.fridge ? <Link href={`/driver/restock/${store.id}`} className="button button-primary store-check-v7">ກວດຮ້ານ</Link> : enabled && <Link href={`/stores/${store.id}`} className="button button-secondary store-check-v7">ເບິ່ງຮ້ານ</Link>}
                    {canManage && <button type="button" className="store-more-v7" aria-label={`ຈັດການ ${store.name}`} aria-expanded={menuId === store.id} aria-controls={`${listId}-menu-${store.id}`} onClick={() => setMenuId(menuId === store.id ? null : store.id)}>•••</button>}
                    {canManage && menuId === store.id && <div className="store-more-menu-v7" id={`${listId}-menu-${store.id}`}>
                      <Link prefetch={false} href={`/stores/${store.id}`}>ເບິ່ງພາບລວມຮ້ານ</Link>
                      <Link prefetch={false} href={`/stores/${store.id}/edit`}>ແກ້ໄຂຮ້ານ</Link>
                      <div className="store-more-danger-v7"><StoreDeactivateButton id={store.id} name={store.name} enabled={enabled} /></div>
                    </div>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        {filtered.length>5&&<button type="button" className="progressive-toggle-v33" aria-controls={listId} aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>{expanded?"ຍໍ້ລາຍການ":"ເບິ່ງທັງໝົດ"} · {filtered.length} ຮ້ານ</button>}
        </>
      ) : (
        <EmptyState
          icon="store"
          title={!stores.length ? "ຍັງບໍ່ມີຮ້ານ" : filter === "attention" && !query.trim() ? "ບໍ່ມີຮ້ານທີ່ຕ້ອງຈັດການ" : "ບໍ່ພົບຮ້ານທີ່ກົງກັນ"}
          description={!stores.length ? "ເພີ່ມຮ້ານ ແລະຜູກຕູ້ແຊ່ ເພື່ອເລີ່ມຈັດການສິນຄ້າ." : filter === "attention" && !query.trim() ? "ເບິ່ງຮ້ານທັງໝົດໄດ້ ເພື່ອກວດລາຍລະອຽດ." : "ລອງປ່ຽນຄຳຄົ້ນຫາ ຫຼືຕົວກອງ."}
          action={stores.length ? <button type="button" className="button button-secondary" onClick={() => { setQuery(""); setFilter("all"); }}>ເບິ່ງຮ້ານທັງໝົດ</button> : canManage ? <Link href="/stores/new" className="button button-primary">+ ເພີ່ມຮ້ານ</Link> : undefined}
        />
      )}
    </section>
  );
}
