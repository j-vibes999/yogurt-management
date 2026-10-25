import { Prisma } from "@prisma/client";

// Keep intermediate arithmetic above the precision of all stock and cost columns.
const StockDecimal = Prisma.Decimal.clone({ precision: 40, rounding: Prisma.Decimal.ROUND_HALF_UP });
export const STOCK_SCALE = 6;
export const RECIPE_SCALE = 4;
export const UNIT_COST_SCALE = 4;
export const MONEY_SCALE = 2;

export type RecipeRequest = {
  recipeId?: string;
  finishedProductId: string;
  name: string;
  baseCups: number;
  items: { rawMaterialId: string; quantityRequired: number | string }[];
};

export type MaterialUpdateRequest = {
  action: "update_material";
  rawMaterialId: string;
  stock?: number;
  expectedStock?: number;
  stockReason?: string;
  avgCostPerUnit?: number;
};

export function stockDecimal(value: Prisma.Decimal.Value): Prisma.Decimal {
  return new StockDecimal(value);
}

export function decimalAtScale(
  value: unknown,
  scale: number,
  options: { allowNegative?: boolean; positive?: boolean; nonzero?: boolean; round?: boolean } = {},
): Prisma.Decimal | null {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !value.trim())) return null;
  try {
    const decimal = stockDecimal(value);
    if (!decimal.isFinite() || (!options.allowNegative && decimal.isNegative())) return null;
    const rounded = decimal.toDecimalPlaces(scale, Prisma.Decimal.ROUND_HALF_UP);
    // User-entered quantities must survive storage unchanged. Computed costs and
    // recipe scaling opt into rounding once, before the ledger and stock writes.
    if (!options.round && !decimal.eq(rounded)) return null;
    if (rounded.abs().gte(stockDecimal(10).pow(14 - scale))) return null;
    if ((options.positive && !rounded.gt(0)) || (options.nonzero && rounded.isZero())) return null;
    return rounded;
  } catch {
    return null;
  }
}

export function parseBaseCups(value: unknown): number | null {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !value.trim())) return null;
  const cups = Number(value);
  return Number.isSafeInteger(cups) && cups > 0 && cups <= 2147483647 ? cups : null;
}

export function productionRequirement(quantity: Prisma.Decimal.Value, cups: number, baseCups: number): Prisma.Decimal | null {
  if (!parseBaseCups(cups) || !parseBaseCups(baseCups)) return null;
  const required = stockDecimal(quantity).times(cups).div(baseCups);
  return decimalAtScale(required.toString(), STOCK_SCALE, { positive: true, round: true });
}

export function productionCosts(exactMaterialCost: Prisma.Decimal.Value, cups: number) {
  if (!parseBaseCups(cups)) throw new Error("STOCK_VALUE_OUT_OF_RANGE");
  const exact = stockDecimal(exactMaterialCost);
  // The batch total and the per-cup snapshot have different storage scales.
  // Derive each from the original calculation so rounding a small batch total
  // to cents cannot erase a nonzero per-cup cost from its delivery lots.
  const totalMaterialCost = decimalAtScale(exact.toString(), MONEY_SCALE, { round: true });
  const unitCost = decimalAtScale(exact.div(cups).toString(), UNIT_COST_SCALE, { round: true });
  if (!totalMaterialCost || !unitCost) throw new Error("STOCK_VALUE_OUT_OF_RANGE");
  return { totalMaterialCost, unitCost };
}

export function receiptStockAndCost(
  oldStock: Prisma.Decimal.Value,
  oldAverageCost: Prisma.Decimal.Value,
  quantity: Prisma.Decimal.Value,
  unitPrice: Prisma.Decimal.Value,
) {
  const stock = stockDecimal(oldStock).plus(quantity);
  const newStock = decimalAtScale(stock.toString(), STOCK_SCALE, { positive: true });
  const weightedAvg = decimalAtScale(
    stockDecimal(oldStock).times(oldAverageCost).plus(stockDecimal(quantity).times(unitPrice)).div(stock).toString(),
    UNIT_COST_SCALE,
    { round: true },
  );
  const totalPrice = decimalAtScale(stockDecimal(quantity).times(unitPrice).toString(), MONEY_SCALE, { round: true });
  if (!newStock || !weightedAvg || !totalPrice) throw new Error("STOCK_VALUE_OUT_OF_RANGE");
  return { newStock, weightedAvg, totalPrice };
}
