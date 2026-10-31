import type { UserRole } from "@/lib/auth-session";

const allRoles: UserRole[] = ["admin", "production", "driver"];
const productionRoles: UserRole[] = ["admin", "production"];
const deliveryRoles: UserRole[] = ["admin", "driver"];
const adminRoles: UserRole[] = ["admin"];

/** Native read capabilities are independent of the existing mutation routes. */
export const nativeResourceRoles = {
  overview: allRoles, stores: allRoles, store: allRoles, map: allRoles,
  refills: allRoles, restock: deliveryRoles, inventory: productionRoles,
  production: productionRoles, settlements: deliveryRoles, expenses: adminRoles,
  expense: adminRoles, reports: adminRoles, notifications: allRoles,
  operations: adminRoles, fridges: adminRoles, audit: adminRoles,
  catalog: allRoles, closing: adminRoles,
} satisfies Record<string, UserRole[]>;

export type NativeResource = keyof typeof nativeResourceRoles;
export function isNativeResource(value: string): value is NativeResource {
  return Object.hasOwn(nativeResourceRoles, value);
}
export function rolesForNativeApi(pathname: string, method: string): UserRole[] {
  if (method !== "GET" && method !== "HEAD") return [];
  const resource = pathname.slice("/api/native/v1/".length);
  // Unknown names reach the route's 404 without granting access to a model.
  return isNativeResource(resource) ? [...nativeResourceRoles[resource]] : [...allRoles];
}

export type NativeQuery = { id?: string; query?: string; filter?: string; page?: number; historyPage?: number; period?: "today" | "week" | "month"; date?: string };
const queryKeys: Partial<Record<NativeResource, string[]>> = {
  store: ["id"], restock: ["id"], expense: ["id"], refills: ["id"],
  settlements: ["query", "filter", "page"], expenses: ["query", "filter", "page", "id"],
  audit: ["query", "filter", "page"], production: ["historyPage"], reports: ["period"], closing: ["date"],
};
const filters: Partial<Record<NativeResource, string[]>> = {
  settlements: ["pending", "partial", "paid", "all"],
  expenses: ["all", "month", "electricity", "transport", "maintenance"],
  audit: ["all", "update", "adjust", "expense", "user"],
};

/** Strict, bounded query parsing happens before any business loader runs. */
export function parseNativeQuery(resource: NativeResource, params: URLSearchParams): NativeQuery | null {
  const allowed = queryKeys[resource] ?? [];
  for (const key of params.keys()) if (!allowed.includes(key) || params.getAll(key).length !== 1) return null;
  const result: NativeQuery = {};
  if (["store", "restock", "expense"].includes(resource) && !params.has("id")) return null;
  if (params.has("id")) {
    const id = params.get("id")!;
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(id)) return null;
    result.id = id;
  }
  if (params.has("query")) {
    const query = params.get("query")!.trim();
    if (query.length > (resource === "audit" ? 120 : 200) || /[\u0000-\u001f\u007f]/.test(query)) return null;
    result.query = query;
  }
  if (params.has("filter")) {
    const filter = params.get("filter")!;
    if (!filters[resource]?.includes(filter)) return null;
    result.filter = filter;
  }
  for (const key of ["page", "historyPage"] as const) {
    if (!params.has(key)) continue;
    const value = params.get(key)!;
    if (!/^[1-9]\d{0,6}$/.test(value) || Number(value) > 1_000_000) return null;
    result[key] = Number(value);
  }
  if (params.has("period")) {
    const period = params.get("period")!;
    if (!["today", "week", "month"].includes(period)) return null;
    result.period = period as NativeQuery["period"];
  }
  if (resource === "closing") {
    const date = params.get("date") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const parsed = new Date(`${date}T12:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
    result.date = date;
  }
  return result;
}
