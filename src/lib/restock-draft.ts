export type RestockDraftContext = {
  storeId: string;
  fridgeAssetCode: string;
  previousBalance: number;
  commissionRate: number;
  snapshot: (string | number)[][];
};
export type RestockDraftValues = {
  entries: Record<string, { countRemaining: string; countExpiredReturned: string; countRefilled: number }>;
  paymentMethod: "cash" | "bank";
  paidAmount: string;
};

/** Stable content identity excludes timestamps, and includes all editable values. */
export function restockDraftContent(context: RestockDraftContext, values: RestockDraftValues): string {
  return JSON.stringify({ ...context, ...values });
}

export function restoreRestockDraft(raw: string | null, context: RestockDraftContext): { status: "valid"; values: RestockDraftValues } | { status: "empty" | "stale" | "invalid" } {
  if (!raw) return { status: "empty" };
  try {
    const draft = JSON.parse(raw);
    if (!draft || typeof draft !== "object") return { status: "invalid" };
    if (["storeId", "fridgeAssetCode", "previousBalance", "commissionRate"].some(key => draft[key] !== context[key as keyof RestockDraftContext]) || JSON.stringify(draft.snapshot) !== JSON.stringify(context.snapshot)) return { status: "stale" };
    if (!draft.entries || typeof draft.entries !== "object" || !["cash", "bank"].includes(draft.paymentMethod) || typeof draft.paidAmount !== "string" || !/^\d*(?:\.\d*)?$/.test(draft.paidAmount)) return { status: "invalid" };
    const entries: RestockDraftValues["entries"] = {};
    for (const [productId, , refilledSinceAudit] of context.snapshot) {
      const row = draft.entries[String(productId)];
      if (!row || typeof row.countRemaining !== "string" || typeof row.countExpiredReturned !== "string" || !/^[0-9]*$/.test(row.countRemaining) || !/^[0-9]*$/.test(row.countExpiredReturned)) return { status: "invalid" };
      entries[String(productId)] = { countRemaining: row.countRemaining, countExpiredReturned: row.countExpiredReturned, countRefilled: Number(refilledSinceAudit) };
    }
    return { status: "valid", values: { entries, paymentMethod: draft.paymentMethod, paidAmount: draft.paidAmount } };
  } catch { return { status: "invalid" }; }
}
