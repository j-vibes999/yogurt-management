"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { createSearchRequest, fetchSearchResults, type SearchResult } from "@/lib/search-request";

type SearchState = { query: string; results: SearchResult[]; status: "idle" | "loading" | "success" | "error"; error?: string };

export function GlobalSearch() {
  const [q, setQ] = useState("");
  const [state, setState] = useState<SearchState>({ query: "", results: [], status: "idle" });
  const [open, setOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestGate = useRef(createSearchRequest());
  const query = q.trim();

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); inputRef.current?.focus(); setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  useEffect(() => {
    const gate = requestGate.current;
    const request = gate.next();
    if (query.length < 2) { setState({ query, results: [], status: "idle" }); return; }
    const controller = new AbortController();
    setState({ query, results: [], status: "loading" });
    const timer = window.setTimeout(async () => {
      try {
        const results = await fetchSearchResults(query, controller.signal);
        if (request.isCurrent()) setState({ query, results, status: "success" });
      } catch (caught) {
        if (controller.signal.aborted || !request.isCurrent()) return;
        setState({ query, results: [], status: "error", error: caught instanceof Error ? caught.message : "ຄົ້ນຫາບໍ່ສຳເລັດ. ກະລຸນາລອງໃໝ່." });
      }
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); gate.cancel(); };
  }, [query, retry]);

  const loading = query.length >= 2 && (state.query !== query || state.status === "loading");
  const results = state.query === query ? state.results : [];

  return <div className="global-search-v5">
    <span className="global-search-icon-v5"><Search size={16} aria-hidden="true" /></span>
    <input aria-label="ຄົ້ນຫາທົ່ວລະບົບ" aria-controls={open && query.length >= 2 ? "global-search-results" : undefined} autoComplete="off" name="globalSearch" ref={inputRef} value={q} onFocus={() => setOpen(true)} onChange={event => setQ(event.target.value)} placeholder="ຄົ້ນຫາ…" />
    <kbd>⌘ K</kbd>
    {open && query.length >= 2 && <div id="global-search-results" className="global-search-results-v5" aria-label="ຜົນຄົ້ນຫາ">
      <div className={loading || state.status === "error" || !results.length ? "search-empty-v5" : "visually-hidden"} role="status" aria-live="polite">
        {loading ? "ກຳລັງຄົ້ນຫາ…" : state.status === "error" ? state.error : results.length ? `ພົບ ${results.length} ລາຍການ` : "ບໍ່ພົບລາຍການ. ລອງຄຳຄົ້ນຫາອື່ນ."}
      </div>
      {!loading && state.status === "error" && <div className="search-retry"><button type="button" className="button button-secondary" onClick={() => setRetry(value => value + 1)}>ລອງຄົ້ນຫາໃໝ່</button></div>}
      {!loading && state.status === "success" && results.map(item => <Link key={`${item.type}:${item.id}`} href={item.href} onClick={() => { setOpen(false); setQ(""); }}><span>{item.type}</span><div><strong>{item.title}</strong><small>{item.detail}</small></div><b><ArrowRight size={16} aria-hidden="true" /></b></Link>)}
    </div>}
  </div>;
}
