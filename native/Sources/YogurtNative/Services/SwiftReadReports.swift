import Foundation

enum SwiftReadReports {
    static func range(period: String, now: Date = Date()) throws -> Range<Date> {
        let day = businessDateString(now)
        let today = try SwiftValue.laosDayRange(day)
        if period == "month" {
            var calendar = Calendar(identifier:.gregorian); calendar.timeZone = TimeZone(identifier:"Asia/Vientiane")!
            let components = calendar.dateComponents([.year,.month],from:now)
            guard let start = calendar.date(from:components), let end = calendar.date(byAdding:.month,value:1,to:start) else { throw SwiftValue.Failure.invalidDate }
            return start..<end
        }
        return (period == "week" ? today.lowerBound.addingTimeInterval(-6 * 86400) : today.lowerBound)..<today.upperBound
    }

    static func load(_ connection: SwiftSQLConnection, period: String, now: Date) async throws -> JSONValue {
        let bounds = try range(period:period,now:now)
        let params: [JSONValue] = [.string(SwiftServiceJSON.iso(bounds.lowerBound)),.string(SwiftServiceJSON.iso(bounds.upperBound)),.string(SwiftServiceJSON.iso(now.addingTimeInterval(-7 * 86400)))]
        let payload = try await connection.rows(reportSQL,params).first?["value"] ?? .null
        let stores = payload["stores"].array; let aggs = payload["storeAggs"].array; let expenses = payload["expenseAggs"].array; let sales = payload["productAggs"].array
        let central = payload["centralWasteRows"].array.first ?? .null
        func sum(_ rows:[JSONValue],_ key:String) -> Decimal { SwiftServiceJSON.sum(rows,key) }
        func money(_ n:Decimal) throws -> JSONValue { .number(try SwiftValue.rounded(n,scale:2)) }
        let gross = sum(aggs,"gross"), share = sum(aggs,"commission"), cost = sum(aggs,"product_cost"), expense = sum(expenses,"total"), storeWaste = sum(aggs,"waste_cost"), centralWaste = central["cost"].decimal
        var storeRows: [JSONValue] = []
        for store in stores {
            let agg = aggs.first { $0["store_id"] == store["id"] } ?? .null
            let exp = expenses.first { $0["store_id"] == store["id"] } ?? .null
            let g = agg["gross"].decimal, s = agg["commission"].decimal, c = agg["product_cost"].decimal, w = agg["waste_cost"].decimal, e = exp["total"].decimal
            if g > 0 || e > 0 || c > 0 || w > 0 {
                storeRows.append(.object(["storeId":store["id"],"storeName":store["name"],"gross":.number(g),"storeShare":.number(s),"electricity":.number(exp["electricity"].decimal),"transport":.number(exp["transport"].decimal),"expenseTotal":.number(e),"otherExpenses":try money(e - exp["electricity"].decimal - exp["transport"].decimal),"electricityBudget":store["monthlyElectricity"],"productCost":.number(c),"wasteCost":.number(w),"profit":try money(g - s - e - c - w)]))
            }
        }
        storeRows.sort { $0["gross"].decimal > $1["gross"].decimal }
        let products = sales.map { JSONValue.object(["productId":$0["product_id"],"code":$0["code"],"name":$0["name"],"unitsSold":$0["units_sold"]]) }
        return .object(["source":.string("database"),"monthGross":try money(gross),"storeShare":try money(share),"expenses":try money(expense),"productCost":try money(cost),"wasteCost":try money(storeWaste + centralWaste),"storeWasteCost":try money(storeWaste),"centralWasteCost":try money(centralWaste),"wasteUnits":.number(sum(aggs,"waste_units") + central["units"].decimal),"costMode":.string(aggs.allSatisfy { $0["all_actual"].bool && $0["waste_actual"].bool } && central["all_known"].bool ? "actual" : "estimated"),"netProfit":try money(gross - share - cost - storeWaste - centralWaste - expense),"unallocatedExpenses":.number(sum(expenses.filter { $0["store_id"] == .null },"total")),"electricityBudget":.number(sum(stores,"monthlyElectricity")),"weeklyGross":payload["weeklyRows"].array.first?["gross"] ?? .integer(0),"cheeseSold":.number(sum(products.filter { SwiftReadProjection.cheese($0) },"unitsSold")),"mangoSold":.number(sum(products.filter { SwiftReadProjection.mango($0) },"unitsSold")),"productSales":.array(products),"storeRows":.array(storeRows),"range":.object(["from":params[0],"to":params[1],"timeZone":.string("Asia/Vientiane")])])
    }
    private static let reportSQL = """
WITH stores AS (SELECT id,name,monthly_electricity AS "monthlyElectricity" FROM stores ORDER BY name),
storeAggs AS (
        WITH per_settlement AS (
          SELECT s.id, s.store_id, s.gross_amount, s.store_commission_amount,
                 COALESCE(SUM(CASE WHEN i.units_sold > 0 THEN
                   CASE WHEN i.unknown_cost_units IS NOT NULL THEN i.subtotal_cost + ROUND(i.unknown_cost_units * i.retail_price * 0.28, 2)
                     WHEN i.subtotal_cost > 0 THEN i.subtotal_cost ELSE ROUND(i.subtotal_gross * 0.28, 2) END
                   ELSE 0 END), 0)
                   + CASE WHEN COUNT(i.id) = 0 AND s.gross_amount > 0 THEN ROUND(s.gross_amount * 0.28, 2) ELSE 0 END AS cogs,
                 CASE WHEN COUNT(i.id) = 0 THEN s.gross_amount = 0
                   ELSE BOOL_AND(i.units_sold <= 0 OR COALESCE(i.cost_known, false)) END AS all_actual,
                 -- Returned (expired or damaged) cups keep their lot cost; unknown-cost cups use the same 28% estimate.
                 COALESCE(SUM(i.expired_cost + CASE WHEN i.expired_unknown_units > 0 THEN ROUND(i.expired_unknown_units * i.retail_price * 0.28, 2) ELSE 0 END), 0) AS waste_cost,
                 COALESCE(SUM(i.count_expired_returned), 0) AS waste_units,
                 COALESCE(BOOL_AND(i.expired_unknown_units = 0), true) AS waste_actual
          FROM settlements s
          LEFT JOIN restock_visit_items i ON i.restock_visit_id = s.restock_visit_id
          WHERE s.settlement_date >= ($1::timestamptz AT TIME ZONE 'UTC') AND s.settlement_date < ($2::timestamptz AT TIME ZONE 'UTC')
          GROUP BY s.id
        )
        SELECT store_id,
               COALESCE(SUM(gross_amount),0) AS gross,
               COALESCE(SUM(store_commission_amount),0) AS commission,
               COALESCE(SUM(cogs),0) AS product_cost,
               BOOL_AND(all_actual) AS all_actual,
               COALESCE(SUM(waste_cost),0) AS waste_cost,
               COALESCE(SUM(waste_units),0) AS waste_units,
               BOOL_AND(waste_actual) AS waste_actual
        FROM per_settlement
        GROUP BY store_id
      ),
expenseAggs AS (
        SELECT store_id,
               COALESCE(SUM(amount),0) AS total,
               COALESCE(SUM(CASE WHEN LOWER(BTRIM(category)) IN ('fuel','transport','ຄ່ານ້ຳມັນ','ຄ່າຂົນສົ່ງ') THEN amount ELSE 0 END),0) AS transport,
               COALESCE(SUM(CASE WHEN LOWER(BTRIM(category)) IN ('electricity','ຄ່າໄຟ','ຄ່າໄຟຟ້າ') THEN amount ELSE 0 END),0) AS electricity
        FROM expenses
        WHERE voided_at IS NULL AND incurred_at >= ($1::timestamptz AT TIME ZONE 'UTC') AND incurred_at < ($2::timestamptz AT TIME ZONE 'UTC')
        GROUP BY store_id
      ),
productAggs AS (
        SELECT p.id AS product_id, p.code, p.name, COALESCE(SUM(i.units_sold),0) AS units_sold
        FROM settlements s
        JOIN restock_visit_items i ON i.restock_visit_id = s.restock_visit_id
        JOIN finished_products p ON p.id = i.finished_product_id
        WHERE s.settlement_date >= ($1::timestamptz AT TIME ZONE 'UTC') AND s.settlement_date < ($2::timestamptz AT TIME ZONE 'UTC')
        GROUP BY p.id, p.code, p.name
        ORDER BY p.code
      ),
weeklyRows AS (
        SELECT COALESCE(SUM(gross_amount),0) AS gross
        FROM settlements
        WHERE settlement_date >= ($3::timestamptz AT TIME ZONE 'UTC')
      ),
centralWasteRows AS (
        SELECT COALESCE(SUM(CASE WHEN a.cost_known THEN ROUND(a.quantity * a.unit_cost, 2) ELSE ROUND(a.quantity * p.retail_price * 0.28, 2) END),0) AS cost,
               COALESCE(SUM(a.quantity),0) AS units,
               COALESCE(BOOL_AND(a.cost_known), true) AS all_known
        FROM finished_goods_adjustments a
        JOIN finished_products p ON p.id = a.finished_product_id
        WHERE a.created_at >= ($1::timestamptz AT TIME ZONE 'UTC') AND a.created_at < ($2::timestamptz AT TIME ZONE 'UTC')
      )
SELECT json_build_object('stores',COALESCE((SELECT json_agg(x) FROM stores x),'[]'::json), 'storeAggs',COALESCE((SELECT json_agg(x) FROM storeAggs x),'[]'::json), 'expenseAggs',COALESCE((SELECT json_agg(x) FROM expenseAggs x),'[]'::json), 'productAggs',COALESCE((SELECT json_agg(x) FROM productAggs x),'[]'::json), 'weeklyRows',COALESCE((SELECT json_agg(x) FROM weeklyRows x),'[]'::json), 'centralWasteRows',COALESCE((SELECT json_agg(x) FROM centralWasteRows x),'[]'::json)) AS value
"""
}
