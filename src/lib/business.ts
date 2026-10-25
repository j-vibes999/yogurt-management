import { calculateSettlementCents, moneyNumber, roundMoneyCents } from "./money.ts";

export type RestockLineInput = {
  previousStock: number;
  countRemaining: number;
  countExpiredReturned: number;
  countRefilled: number;
  retailPrice: number;
};

export type RestockLineResult = RestockLineInput & {
  unitsSold: number;
  subtotalGross: number;
  hasNegativeSale: boolean;
};

export type SettlementResult = {
  grossAmount: number;
  commissionRate: number;
  storeCommissionAmount: number;
  netPayableAmount: number;
};

const nonNegativeInteger = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * Authoritative formula from the operating specification:
 * unitsSold = (previousStock + countRefilled) - countRemaining - countExpiredReturned
 *
 * The mobile UI treats countRemaining as the final audited physical count used to close
 * the visit. A negative result is preserved as a reconciliation warning instead of
 * silently masking a stock discrepancy.
 */
export function calculateRestockLine(input: RestockLineInput): RestockLineResult {
  const previousStock = nonNegativeInteger(input.previousStock);
  const countRemaining = nonNegativeInteger(input.countRemaining);
  const countExpiredReturned = nonNegativeInteger(input.countExpiredReturned);
  const countRefilled = nonNegativeInteger(input.countRefilled);
  const retailPrice = Math.max(0, Number.isFinite(input.retailPrice) ? input.retailPrice : 0);

  const unitsSold =
    previousStock + countRefilled - countRemaining - countExpiredReturned;

  return {
    previousStock,
    countRemaining,
    countExpiredReturned,
    countRefilled,
    retailPrice,
    unitsSold,
    subtotalGross: money(unitsSold * retailPrice),
    hasNegativeSale: unitsSold < 0,
  };
}

/** Live fridge stock already includes every delivered refill. */
export function calculateLiveRestockLine(input: RestockLineInput): RestockLineResult {
  return { ...calculateRestockLine({ ...input, countRefilled: 0 }), countRefilled: nonNegativeInteger(input.countRefilled) };
}

export function calculateSettlement(
  grossAmount: number,
  commissionRate = 0.3,
): SettlementResult {
  const grossCents = roundMoneyCents(Math.max(0, Number.isFinite(grossAmount) ? grossAmount : 0));
  const gross = moneyNumber(grossCents);
  const rate = Number.isFinite(commissionRate) ? Math.min(1, Math.max(0, commissionRate)) : 0;
  const amounts = calculateSettlementCents(grossCents, rate);
  const storeCommissionAmount = moneyNumber(amounts.storeCommissionCents);
  const netPayableAmount = moneyNumber(amounts.netPayableCents);

  return {
    grossAmount: gross,
    commissionRate: rate,
    storeCommissionAmount,
    netPayableAmount,
  };
}

const moneyFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const percentFormatter = new Intl.NumberFormat("lo-LA", { style: "percent", maximumFractionDigits: 1 });

export function formatMoney(value: number, currency = "LAK") {
  const amount = Number.isFinite(value) ? value : 0;
  return `${moneyFormatter.format(amount)} ${currency}`;
}

export function formatPercent(rate: number) {
  return percentFormatter.format(rate);
}
