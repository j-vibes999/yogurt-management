import { moneyDecimalString, parseMoneyCents } from "./money.ts";

export type DailyClosingSnapshot = {
  id: string;
  cashAmount: string;
  bankAmount: string;
  expenseAmount: string;
  note: string | null;
};

export function isDailyClosingSnapshot(value: unknown): value is DailyClosingSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Record<string, unknown>;
  return typeof snapshot.id === "string" && snapshot.id.trim().length > 0
    && (snapshot.note === null || typeof snapshot.note === "string")
    && ["cashAmount", "bankAmount", "expenseAmount"].every(field => typeof snapshot[field] === "string" && parseMoneyCents(snapshot[field]) !== null);
}

export function dailyClosingSnapshot(row: { id: string; cashAmount: unknown; bankAmount: unknown; expenseAmount: unknown; note: string | null }): DailyClosingSnapshot {
  const amount = (value: unknown) => {
    const cents = parseMoneyCents(String(value));
    if (cents === null) throw new Error("INVALID_STORED_CLOSING");
    return moneyDecimalString(cents);
  };
  return { id: row.id, cashAmount: amount(row.cashAmount), bankAmount: amount(row.bankAmount), expenseAmount: amount(row.expenseAmount), note: row.note };
}

export function matchesDailyClosingSnapshot(current: DailyClosingSnapshot | null, expected: DailyClosingSnapshot | null | undefined): boolean {
  if (!current) return expected == null;
  if (!expected || current.id !== expected.id || current.note !== expected.note) return false;
  return (["cashAmount", "bankAmount", "expenseAmount"] as const).every(field => parseMoneyCents(current[field]) === parseMoneyCents(expected[field]));
}
