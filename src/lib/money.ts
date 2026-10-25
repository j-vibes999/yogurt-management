/** Money is stored at two decimal places. Keep all arithmetic in integer cents. */
export const MAX_MONEY_CENTS = BigInt("99999999999999");
const ZERO = BigInt(0);
const ONE = BigInt(1);
const HUNDRED = BigInt(100);

/** Reject coercible values, negatives, and values finer than the database scale. */
export function parseMoneyCents(value: unknown): bigint | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const cents = BigInt(whole) * HUNDRED + BigInt(fraction.padEnd(2, "0"));
  return cents <= MAX_MONEY_CENTS ? cents : null;
}

/** Preserve the commission column's four-decimal precision without coercion. */
export function parseCommissionRate(value: unknown): string | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,4})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const scale = BigInt(10000);
  const units = BigInt(whole) * scale + BigInt(fraction.padEnd(4, "0"));
  return units <= scale ? `${units / scale}.${String(units % scale).padStart(4, "0")}` : null;
}

/** Convert the form's 0–100 percent entry to a four-decimal database rate. */
export function commissionRateFromPercent(value: unknown): string | null {
  const basisPoints = parseMoneyCents(value);
  const scale = BigInt(10000);
  return basisPoints !== null && basisPoints <= scale
    ? `${basisPoints / scale}.${String(basisPoints % scale).padStart(4, "0")}`
    : null;
}

export function moneyDecimalString(cents: bigint): string {
  const sign = cents < ZERO ? "-" : "";
  const absolute = cents < ZERO ? -cents : cents;
  return `${sign}${absolute / HUNDRED}.${String(absolute % HUNDRED).padStart(2, "0")}`;
}

export function moneyNumber(cents: bigint): number {
  return Number(moneyDecimalString(cents));
}

export function assertMoneyRange(cents: bigint): bigint {
  if (cents < ZERO || cents > MAX_MONEY_CENTS) throw new Error("MONEY_OUT_OF_RANGE");
  return cents;
}

function decimalRatio(value: number | string): { numerator: bigint; denominator: bigint } {
  const text = String(value);
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match) throw new Error("INVALID_MONEY");
  const fraction = match[3] ?? "";
  const exponent = Number(match[4] ?? 0) - fraction.length;
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) throw new Error("INVALID_MONEY");
  let numerator = BigInt(match[2] + fraction);
  let denominator = ONE;
  if (exponent >= 0) numerator *= BigInt(10) ** BigInt(exponent);
  else denominator = BigInt(10) ** BigInt(-exponent);
  if (match[1] === "-") numerator = -numerator;
  return { numerator, denominator };
}

/** PostgreSQL numeric uses half-up rounding. Net is the exact gross residual. */
function roundRatio(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < ZERO;
  const absolute = negative ? -numerator : numerator;
  const rounded = (absolute * BigInt(2) + denominator) / (denominator * BigInt(2));
  return negative ? -rounded : rounded;
}

export function roundMoneyCents(value: number | string): bigint {
  const { numerator, denominator } = decimalRatio(value);
  return roundRatio(numerator * HUNDRED, denominator);
}

export function calculateSettlementCents(grossCents: bigint, commissionRate: number | string) {
  const { numerator, denominator } = decimalRatio(commissionRate);
  if (grossCents < ZERO || numerator < ZERO || numerator > denominator) throw new Error("INVALID_SETTLEMENT");
  const storeCommissionCents = roundRatio(grossCents * numerator, denominator);
  return { grossCents, storeCommissionCents, netPayableCents: grossCents - storeCommissionCents };
}

/** Stock counts are entered as whole counts; blank/decimal/exponent input is invalid. */
export function parseWholeCount(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "string" && !/^\d+$/.test(value)) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 && count <= 2147483647 ? count : null;
}
