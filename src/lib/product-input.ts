import { z } from "zod";
import { moneyDecimalString, parseMoneyCents } from "./money.ts";
import { parseBaseCups } from "./stock-validation.ts";

const MAX_RETAIL_PRICE_CENTS = BigInt("999999999999"); // Decimal(12, 2)
export function parseProductPrice(value: unknown): string | null {
  const cents = parseMoneyCents(value);
  return cents === null || cents > MAX_RETAIL_PRICE_CENTS ? null : moneyDecimalString(cents);
}

const price = z.preprocess(parseProductPrice, z.string());
const shelfLife = z.preprocess(parseBaseCups, z.number().int().positive().max(3650));
const fields = {
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  sizeDescription: z.string().trim().max(120).optional().nullable(),
  retailPrice: price,
  shelfLifeDays: shelfLife,
};

export const createProductSchema = z.object(fields);
export const updateProductSchema = z.object({ ...fields, isActive: z.boolean() })
  .partial().refine(value => Object.keys(value).length > 0);
