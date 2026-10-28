export type SearchResult = { id: string; type: string; title: string; detail: string; href: string };

export async function fetchSearchResults(query: string, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<SearchResult[]> {
  const response = await fetcher(`/api/search?q=${encodeURIComponent(query)}`, { signal });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "ຄົ້ນຫາບໍ່ສຳເລັດ. ກະລຸນາລອງໃໝ່.");
  if (!Array.isArray(data?.results) || data.results.some((row: unknown) => !row || typeof row !== "object" || ["id", "type", "title", "detail", "href"].some(key => typeof (row as Record<string, unknown>)[key] !== "string"))) throw new Error("ອ່ານຜົນຄົ້ນຫາບໍ່ໄດ້. ກະລຸນາລອງໃໝ່.");
  return data.results;
}

/** Generation check also protects against a transport that resolves after abort. */
export function createSearchRequest() {
  let generation = 0;
  return {
    next() { const request = ++generation; return { isCurrent: () => request === generation }; },
    cancel() { generation += 1; },
  };
}
