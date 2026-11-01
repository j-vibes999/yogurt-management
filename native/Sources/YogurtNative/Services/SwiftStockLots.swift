import Foundation

/// stock-cost.ts: fridge stock lots carry delivered cost. Lots belong to the fridge they are in.
enum SwiftStockLots {
    /// ensureFridgeLots: record untracked legacy stock as one unknown-cost lot.
    static func ensure(_ tx: SwiftCommandTransaction, storeID: String, fridgeID: String, productID: String, currentStock: Int) async throws {
        let recorded = try await tx.row("SELECT COALESCE(SUM(quantity_remaining),0) AS total FROM fridge_stock_lots WHERE fridge_id=$1 AND finished_product_id=$2 AND quantity_remaining>0",
                                        [.string(fridgeID), .string(productID)])?["total"].decimal ?? 0
        let current = Decimal(currentStock)
        if recorded > current { throw SwiftStockLotMismatch() }
        if recorded < current {
            let quantity = NSDecimalNumber(decimal: current - recorded).intValue
            try await tx.execute("INSERT INTO fridge_stock_lots(id,store_id,fridge_id,finished_product_id,quantity_received,quantity_remaining,unit_cost,cost_known,is_legacy) VALUES($1,$2,$3,$4,$5::integer,$5::integer,0,false,true)",
                                 [.string(SwiftCommandIDs.next()), .string(storeID), .string(fridgeID), .string(productID), .integer(quantity)])
        }
    }

    struct Consumption: Sendable {
        let subtotalCost: Decimal, unitCost: Decimal, costKnown: Bool, unknownCostUnits: Int, expiredCost: Decimal, expiredUnknownUnits: Int
    }

    /// consumeFridgeLots: returned cups first, then sold cups, oldest lots first.
    static func consume(_ tx: SwiftCommandTransaction, storeID: String, fridgeID: String, productID: String, currentStock: Int, unitsSold: Int, expiredReturned: Int) async throws -> Consumption {
        try await ensure(tx, storeID: storeID, fridgeID: fridgeID, productID: productID, currentStock: currentStock)
        let lots = try await tx.rows("""
        SELECT id,quantity_remaining AS remaining,unit_cost AS "unitCost",cost_known AS "costKnown" FROM fridge_stock_lots
        WHERE fridge_id=$1 AND finished_product_id=$2 AND quantity_remaining>0 ORDER BY is_legacy DESC,exp_date ASC NULLS LAST,created_at ASC,id ASC
        """, [.string(fridgeID), .string(productID)])
        var returned = expiredReturned, sold = unitsSold, unknown = 0, expiredUnknown = 0
        var total: Decimal = 0, expiredTotal: Decimal = 0
        for lot in lots {
            let remaining = NSDecimalNumber(decimal: lot["remaining"].decimal).intValue
            let returnTake = min(returned, remaining); returned -= returnTake
            let soldTake = min(sold, remaining - returnTake); sold -= soldTake
            if lot["costKnown"].bool {
                total += lot["unitCost"].decimal * Decimal(soldTake)
                expiredTotal += lot["unitCost"].decimal * Decimal(returnTake)
            } else { unknown += soldTake; expiredUnknown += returnTake }
            let take = returnTake + soldTake
            if take > 0 { try await tx.execute("UPDATE fridge_stock_lots SET quantity_remaining=quantity_remaining-$2::integer WHERE id=$1", [lot["id"], .integer(take)]) }
        }
        if returned != 0 || sold != 0 { throw SwiftStockLotMismatch() }
        return Consumption(subtotalCost: try SwiftValue.rounded(total, scale: 2), unitCost: unitsSold > 0 ? try SwiftValue.rounded(total / Decimal(unitsSold), scale: 4) : 0,
                           costKnown: unknown == 0, unknownCostUnits: unknown, expiredCost: try SwiftValue.rounded(expiredTotal, scale: 2), expiredUnknownUnits: expiredUnknown)
    }
}

/// STOCK_LOT_MISMATCH: recorded lots exceed the counted stock.
struct SwiftStockLotMismatch: Error {}

extension SwiftCommandValue {
    /// zod `z.coerce.number()`: JS Number(value). nil stands for NaN.
    static func coercedNumber(_ value: JSONValue?) -> Decimal? {
        guard let value else { return nil }
        switch value {
        case .null: return 0
        case .bool(let flag): return flag ? 1 : 0
        case .number(let number): return number
        case .string(let raw):
            let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if text.isEmpty { return 0 }
            return decimal(.string(text))
        case .array, .object: return nil
        }
    }
    /// `z.coerce.number().int()` within bounds.
    static func coercedInteger(_ value: JSONValue?, minimum: Int, maximum: Int) -> Int? {
        guard let number = coercedNumber(value), let integral = try? SwiftValue.rounded(number, scale: 0), integral == number,
              number >= Decimal(minimum), number <= Decimal(maximum) else { return nil }
        return NSDecimalNumber(decimal: number).intValue
    }
}
