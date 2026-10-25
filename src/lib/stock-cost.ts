import { Prisma } from "@prisma/client";

export async function ensureFridgeLots(tx: Prisma.TransactionClient, input: { storeId: string; fridgeId: string; productId: string; currentStock: number }) {
  const where = { fridgeId: input.fridgeId, finishedProductId: input.productId, quantityRemaining: { gt: 0 } };
  const sum = await tx.fridgeStockLot.aggregate({ where, _sum: { quantityRemaining: true } });
  const recorded = sum._sum.quantityRemaining ?? 0;
  if (recorded > input.currentStock) throw new Error("STOCK_LOT_MISMATCH");
  if (recorded < input.currentStock) {
    const quantity = input.currentStock - recorded;
    await tx.fridgeStockLot.create({ data: { storeId: input.storeId, fridgeId: input.fridgeId, finishedProductId: input.productId, quantityReceived: quantity, quantityRemaining: quantity, unitCost: 0, costKnown: false, isLegacy: true } });
  }
}

/**
 * Takes the returned and sold cups out of the fridge's lots (returns first, oldest lots first) and prices them.
 * Lots belong to the fridge they are in, whichever store it stood in when they were delivered.
 */
export async function consumeFridgeLots(tx: Prisma.TransactionClient, input: { storeId: string; fridgeId: string; productId: string; currentStock: number; unitsSold: number; expiredReturned: number }) {
  await ensureFridgeLots(tx, input);
  const lots = await tx.fridgeStockLot.findMany({
    where: { fridgeId: input.fridgeId, finishedProductId: input.productId, quantityRemaining: { gt: 0 } },
    orderBy: [{ isLegacy: "desc" }, { expDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  let returned = input.expiredReturned;
  let sold = input.unitsSold;
  let unknownCostUnits = 0;
  let expiredUnknownUnits = 0;
  let total = new Prisma.Decimal(0);
  let expiredTotal = new Prisma.Decimal(0);
  for (const lot of lots) {
    const returnTake = Math.min(returned, lot.quantityRemaining);
    returned -= returnTake;
    const soldTake = Math.min(sold, lot.quantityRemaining - returnTake);
    sold -= soldTake;
    if (lot.costKnown) {
      total = total.add(new Prisma.Decimal(lot.unitCost).mul(soldTake));
      expiredTotal = expiredTotal.add(new Prisma.Decimal(lot.unitCost).mul(returnTake));
    } else {
      unknownCostUnits += soldTake;
      expiredUnknownUnits += returnTake;
    }
    const take = returnTake + soldTake;
    if (take) await tx.fridgeStockLot.update({ where: { id: lot.id }, data: { quantityRemaining: { decrement: take } } });
  }
  if (returned || sold) throw new Error("STOCK_LOT_MISMATCH");
  return {
    subtotalCost: Number(total.toDecimalPlaces(2)), unitCost: input.unitsSold ? Number(total.div(input.unitsSold).toDecimalPlaces(4)) : 0, costKnown: unknownCostUnits === 0, unknownCostUnits,
    // Returned (expired or damaged) cups are a loss; keep their cost so reports can subtract it.
    expiredCost: Number(expiredTotal.toDecimalPlaces(2)), expiredUnknownUnits,
  };
}
