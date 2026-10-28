import { moneyNumber, parseMoneyCents } from "./money.ts";

export type PendingRequest = { key: string; body: string; paidAmount: number };

type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Keep unresolved requests in this page when browser persistence is unavailable. */
export function createPendingStorage(getStorage: () => BrowserStorage) {
  const memory = new Map<string, string>();
  return {
    read(key: string): string | null {
      if (memory.has(key)) return memory.get(key)!;
      try { return getStorage().getItem(key); } catch { return null; }
    },
    write(key: string, value: string): boolean {
      memory.set(key, value);
      try { getStorage().setItem(key, value); return true; } catch { return false; }
    },
    isPersisted(key: string, value: string): boolean {
      try { return getStorage().getItem(key) === value; } catch { return false; }
    },
    remove(key: string) {
      memory.delete(key);
      try { getStorage().removeItem(key); } catch { /* Storage can be disabled. */ }
    },
  };
}

export const pendingStorage = createPendingStorage(() => window.localStorage);

/** Never restore another signed-in account's unresolved financial request. */
export function financialStorageKeys(userId: string, storeId: string) {
  const owner = `${encodeURIComponent(userId)}:${encodeURIComponent(storeId)}`;
  return {
    draft: `yogurt-restock-draft:${owner}`,
    payment: `yogurt-payment-pending:${owner}`,
    visit: `yogurt-restock-pending:${owner}`,
  };
}

export type LegacyFinancialRequest = PendingRequest & { storageKey: string; receiptNumber: string };
export function legacyFinancialRequests(storeId: string, storage = pendingStorage): LegacyFinancialRequest[] {
  return [
    { storageKey: `yogurt-payment-pending:${storeId}`, prefix: "PM" },
    { storageKey: `yogurt-restock-pending:${storeId}`, prefix: "ST" },
  ].flatMap(({ storageKey, prefix }) => {
    const request = parsePendingRequest(storage.read(storageKey), storeId);
    return request ? [{ ...request, storageKey, receiptNumber: `${prefix}-${request.key.replaceAll("-", "").toUpperCase()}` }] : [];
  });
}

export function parsePendingRequest(raw: string | null, storeId: string): PendingRequest | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (typeof value.key !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.key) || typeof value.body !== "string") return null;
    const body = JSON.parse(value.body) as Record<string, unknown>;
    const paidCents = parseMoneyCents(body.paidAmount);
    if (body.storeId !== storeId || paidCents === null) return null;
    return { key: value.key, body: value.body, paidAmount: moneyNumber(paidCents) };
  } catch { return null; }
}
