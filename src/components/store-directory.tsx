"use client";

import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { StoreDeactivateButton } from "@/components/store-management";

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

export function StoreDirectory({ stores, enabled }: { stores: StoreItem[]; enabled: boolean }) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("attention");
  const [sort, setSort] = useState<"priority"|"name"|"stock">("priority");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuId(null); };
    document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close);
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
                  <div className="store-card-title-v4"><span className={`store-state-v4 ${statusClass}`} /><div><Link prefetch={false} className="store-title-link-v1" href={`/stores/${store.id}`}><strong>{store.name}</strong><span aria-hidden="true">↗</span></Link><span>{store.contactName} · {store.phone}</span></div></div>
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
                    <Link href={`/driver/restock/${store.id}`} className="button button-primary store-check-v7">ກວດຮ້ານ</Link>
                    <button type="button" className="store-more-v7" aria-label={`ຈັດການ ${store.name}`} aria-expanded={menuId === store.id} onClick={() => setMenuId(menuId === store.id ? null : store.id)}>•••</button>
                    {menuId === store.id && <div className="store-more-menu-v7">
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
        <EmptyState icon="store" title="ບໍ່ພົບຮ້ານ" description="ລອງປ່ຽນຄຳຄົ້ນຫາ ຫຼື ຕົວກອງ." action={<button type="button" className="button button-secondary" onClick={() => { setQuery(""); setFilter("attention"); }}>ລ້າງ ຕົວກອງ</button>} />
      )}
    </section>
  );
}
