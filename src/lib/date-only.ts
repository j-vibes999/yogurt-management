export function parseDateOnly(value: unknown): Date | null {
  const text=String(value??"").trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date=new Date(`${text}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0,10)!==text ? null : date;
}

const businessCalendar = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Vientiane", year: "numeric", month: "2-digit", day: "2-digit" });
export function businessDateString(date = new Date()): string {
  const parts = businessCalendar.formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function businessDateOnly(date = new Date()): Date { return parseDateOnly(businessDateString(date))!; }

/** Half-open calendar ranges in Laos, independent of the server's timezone. */
export function businessReportRange(period: string, now = new Date()): { from: Date; to: Date } {
  const day = businessDateString(now);
  const date = parseDateOnly(day)!;
  const midnight = (value: Date) => new Date(`${value.toISOString().slice(0, 10)}T00:00:00+07:00`);
  if (period === "month") {
    const from = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 12));
    const to = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 12));
    return { from: midnight(from), to: midnight(to) };
  }
  const from = new Date(date);
  if (period === "7d") from.setUTCDate(from.getUTCDate() - 6);
  const to = new Date(date);
  to.setUTCDate(to.getUTCDate() + 1);
  return { from: midnight(from), to: midnight(to) };
}
