"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { useId, useState } from "react";
import type { StoreView } from "@/lib/db-data";

type DashboardStore = Pick<StoreView, "id" | "name" | "address" | "stock" | "fridge">;

const INITIAL_VISIBLE_STORES = 5;

function StoreIdentity({ store }: { store: DashboardStore }) {
  return (
    <div className="dashboard-store-identity">
      <strong>{store.name}</strong>
      <span>{store.fridge ? `ຕູ້ແຊ່ ${store.fridge.assetCode}` : "ຍັງບໍ່ມີຕູ້ແຊ່"}</span>
      <p>{store.address || "ຍັງບໍ່ລະບຸທີ່ຢູ່"}</p>
    </div>
  );
}

function StoreStock({ stock }: { stock: number }) {
  return (
    <div className="dashboard-store-stock">
      <strong>{stock.toLocaleString()}</strong>
      <span>ຖ້ວຍ</span>
    </div>
  );
}

function StoreTaskStatus({ store }: { store: DashboardStore }) {
  const status = store.fridge?.status === "maintenance"
    ? { className: "is-info", label: "ບຳລຸງຮັກສາ" }
    : !store.fridge
      ? { className: "is-neutral", label: "ຍັງບໍ່ມີຕູ້ແຊ່" }
      : store.stock === 0
        ? { className: "is-danger", label: "ສິນຄ້າໝົດ" }
        : { className: "is-warning", label: "ຮອດຮອບກວດ" };

  return <span className={`dashboard-row-status ${status.className}`}>{status.label}</span>;
}

function StoreTaskAction({ store, allowRestock }: { store: DashboardStore; allowRestock: boolean }) {
  const canRestock = allowRestock && store.fridge?.status === "active";
  const label = canRestock ? "ເລີ່ມກວດ" : "ເບິ່ງຮ້ານ";

  return (
    <Link
      prefetch={false}
      href={canRestock ? `/driver/restock/${store.id}` : `/stores/${store.id}`}
      className="dashboard-row-action"
      aria-label={`${label} ${store.name}`}
    >
      <span>{label}</span>
      <ArrowRight size={15} aria-hidden="true" />
    </Link>
  );
}

export function DashboardStoreTasks({ stores, allowRestock = true }: { stores: DashboardStore[]; allowRestock?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const visibleStores = expanded ? stores : stores.slice(0, INITIAL_VISIBLE_STORES);

  return (
    <>
      <div id={listId}>
        {stores.length > 0 ? (
          <>
            <div className="dashboard-store-table-wrap">
              <table className="dashboard-store-table" aria-label="ຮ້ານຮອດຮອບກວດ">
                <thead>
                  <tr>
                    <th scope="col">ຮ້ານ / ຕູ້ແຊ່</th>
                    <th scope="col">ຄົງເຫຼືອ</th>
                    <th scope="col">ສະຖານະ</th>
                    <th scope="col">ຈັດການ</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleStores.map((store) => (
                    <tr key={store.id}>
                      <th scope="row"><StoreIdentity store={store} /></th>
                      <td><StoreStock stock={store.stock} /></td>
                      <td><StoreTaskStatus store={store} /></td>
                      <td><StoreTaskAction store={store} allowRestock={allowRestock} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="dashboard-store-mobile-list" aria-label="ຮ້ານຮອດຮອບກວດ">
              {visibleStores.map((store) => (
                <li className="dashboard-store-mobile-row" key={store.id}>
                  <StoreIdentity store={store} />
                  <StoreStock stock={store.stock} />
                  <StoreTaskStatus store={store} />
                  <StoreTaskAction store={store} allowRestock={allowRestock} />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="dashboard-inline-empty" role="status">
            <CheckCircle2 size={18} aria-hidden="true" />
            <span>ບໍ່ມີຮ້ານຮອດຮອບກວດໃນຕອນນີ້</span>
          </div>
        )}
      </div>

      <div className="dashboard-store-list-footer">
        <p aria-live="polite" aria-atomic="true">
          ສະແດງ <strong>{visibleStores.length.toLocaleString()}</strong> ຈາກ <strong>{stores.length.toLocaleString()}</strong> ຮ້ານ
        </p>
        {stores.length > INITIAL_VISIBLE_STORES && (
          <button
            type="button"
            className="dashboard-expand-button"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => setExpanded((value) => !value)}
          >
            <span>{expanded ? "ຍໍ້ລາຍການ" : `ເບິ່ງທັງໝົດ ${stores.length.toLocaleString()} ຮ້ານ`}</span>
            {expanded ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
          </button>
        )}
      </div>
    </>
  );
}
