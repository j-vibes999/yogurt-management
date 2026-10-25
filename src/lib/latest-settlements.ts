/** Settlement lists are ordered newest first by the database query. */
export function latestSettlementsByStore<T extends { storeId: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.storeId)) return false;
    seen.add(item.storeId);
    return true;
  });
}
