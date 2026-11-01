import Foundation
import CryptoKit

/// restock-visits (audited fridge count, lot costing and settlement) and settlements/pay.
/// Money is exact Decimal at two places; commission rounds half-up and net is the residual.
struct SwiftFinanceCommands: Sendable {
    let context: SwiftCommandContext
    private static let roles: Set<String> = ["admin", "driver"]
    private static let maximumMoney = Decimal(string: "999999999999.99")!
    typealias V = SwiftCommandValue

    private static let restockMessages: [String: String] = [
        "INVALID_FINANCIAL_SNAPSHOT": "ຂໍ້ມູນລາຄາ ແລະຍອດເງິນທີ່ສົ່ງມາບໍ່ຄົບ ຫຼືບໍ່ຖືກຕ້ອງ; ກະລຸນາໂຫຼດໜ້າຄືນ",
        "STALE_FINANCIAL_SNAPSHOT": "ລາຄາ, ອັດຕາສ່ວນແບ່ງ ຫຼືຍອດຄ້າງເດີມປ່ຽນແປງຫຼັງຈາກເປີດໜ້ານີ້; ກະລຸນາໂຫຼດໜ້າຄືນ ແລະກວດຍອດໃໝ່ກ່ອນປິດຮອບ",
        "MONEY_OUT_OF_RANGE": "ຈຳນວນເງິນເກີນຂອບເຂດທີ່ລະບົບຮອງຮັບ",
        "STALE_INVENTORY": "ຈຳນວນສິນຄ້າໃນຕູ້ ຫຼືການເຕີມສິນຄ້າປ່ຽນແປງຫຼັງຈາກເປີດໜ້ານີ້; ກະລຸນາໂຫຼດໜ້າຄືນກ່ອນປິດຮອບ",
        "STORE_OR_FRIDGE_NOT_FOUND": "ບໍ່ພົບຮ້ານ ຫຼືຕູ້ແຊ່ທີ່ຕິດຕັ້ງຢູ່ຮ້ານນີ້",
        "STORE_INACTIVE": "ຮ້ານນີ້ຖືກປິດໃຊ້ແລ້ວ",
        "INCOMPLETE_AUDIT_LINES": "ກະລຸນານັບສິນຄ້າທຸກລາຍການໃນຕູ້ກ່ອນປິດຮອບ",
        "INVALID_AUDIT_COUNTS": "ຈຳນວນທີ່ນັບຕ້ອງເປັນຈຳນວນເຕັມທີ່ບໍ່ຕິດລົບ",
        "NEGATIVE_SALES": "ຈຳນວນທີ່ນັບເຮັດໃຫ້ຍອດຂາຍຕິດລົບ; ກະລຸນາກວດຈຳນວນອີກຄັ້ງ",
        "PAYMENT_EXCEEDS_BALANCE": "ຈຳນວນເງິນທີ່ຮັບເກີນຍອດທີ່ຕ້ອງຮັບ",
        "IDEMPOTENCY_CONFLICT": "ລະຫັດຄຳຂໍນີ້ຖືກໃຊ້ກັບການກວດຮ້ານອື່ນແລ້ວ; ກະລຸນາໂຫຼດໜ້າຄືນ",
        "STOCK_LOT_MISMATCH": "ຂໍ້ມູນລັອດສິນຄ້າບໍ່ກົງກັບຈຳນວນໃນຕູ້; ກະລຸນາໂຫຼດໜ້າຄືນ ແລະແຈ້ງຜູ້ຈັດການ",
        ]

    static func restockFailure(_ code: String) -> SwiftServiceFailure {
        let status = ["IDEMPOTENCY_CONFLICT", "STORE_INACTIVE", "STOCK_LOT_MISMATCH", "STALE_INVENTORY", "STALE_FINANCIAL_SNAPSHOT"].contains(code) ? 409 : code == "STORE_OR_FRIDGE_NOT_FOUND" ? 404 : 400
        return SwiftServiceFailure(status: status, message: restockMessages[code]!, retryable: false, details: ["code": .string(code)])
    }
    private static let payMessages = ["STORE_NOT_FOUND": "ບໍ່ພົບຮ້ານນີ້", "NO_BALANCE": "ຮ້ານນີ້ບໍ່ມີຍອດຄ້າງ", "PAYMENT_EXCEEDS_BALANCE": "ຈຳນວນເງິນທີ່ຮັບເກີນຍອດຄ້າງ",
                                      "IDEMPOTENCY_CONFLICT": "ລະຫັດຄຳຂໍນີ້ຖືກໃຊ້ກັບການຮັບເງິນອື່ນແລ້ວ; ກະລຸນາໂຫຼດໜ້າຄືນ"]
    static func payFailure(_ code: String) -> SwiftServiceFailure {
        SwiftServiceFailure(status: code == "STORE_NOT_FOUND" ? 404 : code == "IDEMPOTENCY_CONFLICT" ? 409 : 400, message: payMessages[code]!, retryable: false, details: ["code": .string(code)])
    }

    func restock(_ request: SwiftCommandRequest) async throws -> EngineResponse {
        let body = request.json
        guard case .object(let fields) = body else { throw SwiftServiceFailure(status: 400, message: "ຂໍ້ມູນການກວດຮ້ານບໍ່ຖືກຕ້ອງ", retryable: false) }
        let storeID = V.trimmed(body["storeId"]), assetCode = V.trimmed(body["fridgeAssetCode"])
        let lines: [JSONValue] = { if case .array(let rows) = body["lines"] { return rows }; return [] }()
        let paid: Decimal? = fields["paidAmount"] == nil ? 0 : V.money(body["paidAmount"])
        guard let paid else { throw SwiftServiceFailure(status: 400, message: "ຈຳນວນເງິນທີ່ຮັບຕ້ອງບໍ່ຕິດລົບ ແລະມີທົດສະນິຍົມບໍ່ເກີນ 2 ຕຳແໜ່ງ", retryable: false) }
        let method: String? = body["paymentMethod"] == .string("bank") ? "bank" : body["paymentMethod"] == .string("cash") ? "cash" : nil
        if storeID.isEmpty || assetCode.isEmpty || lines.isEmpty { throw SwiftServiceFailure(status: 400, message: "ຂໍ້ມູນຮ້ານ, ຕູ້ແຊ່ ຫຼືລາຍການກວດບໍ່ຄົບ", retryable: false) }
        if paid > 0 && method == nil { throw SwiftServiceFailure(status: 400, message: "ກະລຸນາເລືອກວິທີຮັບເງິນເມື່ອຈຳນວນຮັບຫຼາຍກວ່າ 0", retryable: false) }
        let snapshotPresent = fields["expectedFinancialSnapshot"] != nil
        // The visit note fingerprints JSON.stringify of the submission in its original key order.
        let ordered = SwiftOrderedJSON.parse(request.body)
        let methodJSON: JSONValue = method.map(JSONValue.string) ?? .null
        var hashed: [JSONValue] = [.string(storeID), .string(assetCode), .array(lines), .number(paid), methodJSON]
        var noted: [String] = [SwiftValue.quote(storeID), SwiftValue.quote(assetCode), try ordered?["lines"]?.stringify() ?? "[]", try SwiftValue.canonicalPayload(.number(paid)), method.map(SwiftValue.quote) ?? "null"]
        if snapshotPresent { hashed.append(body["expectedFinancialSnapshot"]); noted.append(try ordered?["expectedFinancialSnapshot"]?.stringify() ?? "null") }
        let requestNote = "restock:" + SwiftValue.sha256("[" + noted.joined(separator: ",") + "]")

        let result: JSONValue
        do {
            result = try await context.transaction(request, roles: Self.roles, failure: "ບໍ່ສາມາດປິດຮອບກວດໄດ້; ກະລຸນາລອງໃໝ່", failureStatus: 500) { tx in
                guard let key = request.operationKey else { throw SwiftServiceFailure(status: 400, message: "ບໍ່ພົບລະຫັດຄຳຂໍ; ກະລຸນາໂຫຼດໜ້າຄືນແລ້ວລອງໃໝ່", retryable: false) }
                guard key.range(of: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", options: .regularExpression) != nil else {
                    throw SwiftServiceFailure(status: 400, message: "ລະຫັດຄຳຂໍບໍ່ຖືກຕ້ອງ; ກະລຸນາໂຫຼດໜ້າຄືນແລ້ວລອງໃໝ່", retryable: false)
                }
                let receipt = "ST-" + key.replacingOccurrences(of: "-", with: "").uppercased()
                return try await tx.idempotent(scope: "restock.complete", payload: .array(hashed), conflict: Self.restockMessages["IDEMPOTENCY_CONFLICT"]!) {
                    try await completeVisit(tx, storeID: storeID, assetCode: assetCode, lines: lines, paid: paid, method: method, snapshot: snapshotPresent ? body["expectedFinancialSnapshot"] : nil, receipt: receipt, note: requestNote)
                }
            }
        } catch let failure as SwiftServiceFailure where failure.status == 409 && failure.message == Self.restockMessages["IDEMPOTENCY_CONFLICT"] && failure.details.isEmpty {
            throw Self.restockFailure("IDEMPOTENCY_CONFLICT")
        }
        return .json(201, result)
    }

    private func completeVisit(_ tx: SwiftCommandTransaction, storeID: String, assetCode: String, lines: [JSONValue], paid: Decimal, method: String?, snapshot: JSONValue?, receipt: String, note: String) async throws -> JSONValue {
        if let existing = try await tx.row("""
        SELECT st.id,st.store_id AS "storeId",st.restock_visit_id AS "visitId",v.note,st.gross_amount AS gross,st.store_commission_amount AS commission,st.net_payable_amount AS net,
        st.previous_balance AS previous,st.paid_amount AS paid,st.closing_balance AS closing,st.payment_status::text AS status,
        COALESCE((SELECT sum(round(i.subtotal_cost,2)) FROM restock_visit_items i WHERE i.restock_visit_id=st.restock_visit_id),0) AS cost
        FROM settlements st JOIN restock_visits v ON v.id=st.restock_visit_id WHERE st.receipt_number=$1
        """, [.string(receipt)]) {
            guard existing.text("storeId") == storeID, existing["note"] == .string(note) else { throw Self.restockFailure("IDEMPOTENCY_CONFLICT") }
            let cost = existing["cost"].decimal
            return .object(["visitId": existing["visitId"], "settlementId": existing["id"], "receiptNumber": .string(receipt), "grossAmount": .number(existing["gross"].decimal), "totalCost": .number(cost),
                            "grossMarginBeforeStoreShare": .number(existing["gross"].decimal - cost), "storeCommissionAmount": .number(existing["commission"].decimal), "netPayableAmount": .number(existing["net"].decimal),
                            "previousBalance": .number(existing["previous"].decimal), "paidAmount": .number(existing["paid"].decimal), "closingBalance": .number(existing["closing"].decimal), "paymentStatus": existing["status"]])
        }
        guard let store = try await tx.row("""
        SELECT s.id,s.is_active AS active,s.commission_rate AS rate,f.id AS "fridgeId",f.asset_code AS "assetCode",
        COALESCE((SELECT closing_balance FROM settlements WHERE store_id=s.id ORDER BY settlement_date DESC,id DESC LIMIT 1),0) AS previous
        FROM stores s LEFT JOIN fridges f ON f.current_store_id=s.id WHERE s.id=$1 FOR UPDATE OF s
        """, [.string(storeID)]), store["fridgeId"] != .null, store.text("assetCode") == assetCode else { throw Self.restockFailure("STORE_OR_FRIDGE_NOT_FOUND") }
        guard store["active"].bool else { throw Self.restockFailure("STORE_INACTIVE") }
        let fridgeID = store.text("fridgeId")
        let inventory = try await tx.rows("""
        SELECT i.id,i.finished_product_id AS "productId",i.current_stock AS stock,p.retail_price AS price FROM fridge_inventory i JOIN finished_products p ON p.id=i.finished_product_id
        WHERE i.store_id=$1 AND i.fridge_id=$2 ORDER BY i.id FOR UPDATE OF i
        """, [.string(storeID), .string(fridgeID)])
        let refilled = Dictionary(uniqueKeysWithValues: try await tx.rows("""
        SELECT inv.finished_product_id AS "productId",COALESCE(SUM(item.quantity),0) AS quantity FROM fridge_inventory inv
        JOIN fridges f ON f.id=inv.fridge_id AND f.current_store_id=inv.store_id
        LEFT JOIN refill_requests req ON req.store_id=inv.store_id AND req.status='completed' AND req.delivered_at IS NOT NULL AND (inv.last_audit_date IS NULL OR req.delivered_at > inv.last_audit_date)
        LEFT JOIN refill_request_items item ON item.refill_request_id=req.id AND item.finished_product_id=inv.finished_product_id
        WHERE inv.store_id=$1 GROUP BY inv.finished_product_id
        """, [.string(storeID)]).map { ($0.text("productId"), $0["quantity"].decimal) })
        guard lines.allSatisfy({ if case .object = $0 { return true }; return false }) else { throw Self.restockFailure("INCOMPLETE_AUDIT_LINES") }
        var byProduct: [String: JSONValue] = [:]
        for line in lines { byProduct[V.jsString(line["productId"] == .null ? nil : line["productId"])] = line }
        guard byProduct.count == lines.count, byProduct.count == inventory.count else { throw Self.restockFailure("INCOMPLETE_AUDIT_LINES") }
        let previous = try SwiftValue.rounded(store["previous"].decimal, scale: 2)
        if let snapshot { try verify(snapshot, inventory: inventory, previous: previous, rate: store["rate"].decimal) }

        var gross: Decimal = 0, totalCost: Decimal = 0
        var items: [(product: String, values: [JSONValue])] = [], updates: [(id: JSONValue, stock: Int)] = []
        func ranged(_ value: Decimal) throws -> Decimal { guard value >= 0, value <= Self.maximumMoney else { throw Self.restockFailure("MONEY_OUT_OF_RANGE") }; return value }
        for row in inventory {
            guard let input = byProduct[row.text("productId")] else { throw Self.restockFailure("INCOMPLETE_AUDIT_LINES") }
            guard let expectedPrevious = V.wholeCount(input["previousStock"]), let remaining = V.wholeCount(input["countRemaining"]),
                  let returned = V.wholeCount(input["countExpiredReturned"]), let expectedRefilled = V.wholeCount(input["countRefilled"]) else { throw Self.restockFailure("INVALID_AUDIT_COUNTS") }
            let stock = NSDecimalNumber(decimal: row["stock"].decimal).intValue
            let refilledCount = NSDecimalNumber(decimal: refilled[row.text("productId")] ?? 0).intValue
            guard expectedPrevious == stock, expectedRefilled == refilledCount else { throw Self.restockFailure("STALE_INVENTORY") }
            let sold = stock - remaining - returned
            guard sold >= 0 else { throw Self.restockFailure("NEGATIVE_SALES") }
            let price = try SwiftValue.rounded(row["price"].decimal, scale: 2)
            let lineGross = try ranged(price * Decimal(sold))
            let consumed: SwiftStockLots.Consumption
            do { consumed = try await SwiftStockLots.consume(tx, storeID: storeID, fridgeID: fridgeID, productID: row.text("productId"), currentStock: stock, unitsSold: sold, expiredReturned: returned) }
            catch is SwiftStockLotMismatch { throw Self.restockFailure("STOCK_LOT_MISMATCH") }
            let lineCost = try ranged(consumed.subtotalCost)
            gross = try ranged(gross + lineGross); totalCost = try ranged(totalCost + lineCost)
            items.append((row.text("productId"), [.integer(stock), .integer(remaining), .integer(returned), .integer(refilledCount), .integer(sold), .number(price), .string(V.moneyString(lineGross)),
                                                  .number(consumed.unitCost), .string(V.moneyString(lineCost)), .bool(consumed.costKnown), .integer(consumed.unknownCostUnits),
                                                  .string(V.moneyString(try ranged(consumed.expiredCost))), .integer(consumed.expiredUnknownUnits)]))
            updates.append((row["id"], remaining))
        }
        let commission = try SwiftValue.rounded(gross * store["rate"].decimal, scale: 2), net = gross - commission
        let totalDue = try ranged(previous + net)
        guard paid <= totalDue else { throw Self.restockFailure("PAYMENT_EXCEEDS_BALANCE") }
        let closing = totalDue - paid
        let status = closing == 0 ? "paid" : paid > 0 ? "partial" : "pending"
        let now = SwiftServiceJSON.iso(Date())
        let visitID = SwiftCommandIDs.next()
        try await tx.execute("INSERT INTO restock_visits(id,store_id,fridge_id,visit_date,status,driver_user_id,note) VALUES($1,$2,$3,$4::timestamp,'completed',$5,$6)",
                             [.string(visitID), .string(storeID), .string(fridgeID), .string(now), .string(tx.user.userID), .string(note)])
        for item in items {
            try await tx.execute("""
            INSERT INTO restock_visit_items(id,restock_visit_id,finished_product_id,previous_stock,count_remaining,count_expired_returned,count_refilled,units_sold,retail_price,subtotal_gross,unit_cost,subtotal_cost,cost_known,unknown_cost_units,expired_cost,expired_unknown_units)
            VALUES($1,$2,$3,$4::integer,$5::integer,$6::integer,$7::integer,$8::integer,$9::numeric,$10::numeric,$11::numeric,$12::numeric,$13::boolean,$14::integer,$15::numeric,$16::integer)
            """, [.string(SwiftCommandIDs.next()), .string(visitID), .string(item.product)] + item.values)
        }
        for update in updates {
            try await tx.execute("UPDATE fridge_inventory SET current_stock=$2::integer,last_audit_date=$3::timestamp WHERE id=$1", [update.id, .integer(update.stock), .string(now)])
        }
        let settlementID = SwiftCommandIDs.next()
        try await tx.execute("""
        INSERT INTO settlements(id,restock_visit_id,store_id,gross_amount,store_commission_amount,net_payable_amount,payment_status,payment_method,previous_balance,paid_amount,closing_balance,receipt_number,settlement_date)
        VALUES($1,$2,$3,$4::numeric,$5::numeric,$6::numeric,$7::"PaymentStatus",$8::"PaymentMethod",$9::numeric,$10::numeric,$11::numeric,$12,$13::timestamp)
        """, [.string(settlementID), .string(visitID), .string(storeID), .string(V.moneyString(gross)), .string(V.moneyString(commission)), .string(V.moneyString(net)), .string(status),
              paid > 0 ? (method.map(JSONValue.string) ?? .null) : .null, .string(V.moneyString(previous)), .string(V.moneyString(paid)), .string(V.moneyString(closing)), .string(receipt), .string(now)])
        try await tx.audit(action: "complete", entityType: "restock_visit", entityID: visitID, storeID: storeID, summary: "ປິດຮອບກວດ ແລະບັນທຶກ \(receipt)")
        return .object(["visitId": .string(visitID), "settlementId": .string(settlementID), "receiptNumber": .string(receipt), "grossAmount": .number(gross), "totalCost": .number(totalCost),
                        "grossMarginBeforeStoreShare": .number(gross - totalCost), "storeCommissionAmount": .number(commission), "netPayableAmount": .number(net),
                        "previousBalance": .number(previous), "paidAmount": .number(paid), "closingBalance": .number(closing), "paymentStatus": .string(status)])
    }

    /// The submitted price, rate and balance must match the store's current values.
    private func verify(_ snapshot: JSONValue, inventory: [JSONValue], previous: Decimal, rate: Decimal) throws {
        guard case .object = snapshot, case .array(let retail) = snapshot["retailPrices"] else { throw Self.restockFailure("INVALID_FINANCIAL_SNAPSHOT") }
        var prices: [String: Decimal?] = [:]
        for price in retail {
            guard case .object = price, case .string(let product) = price["productId"], prices[product] == nil else { throw Self.restockFailure("INVALID_FINANCIAL_SNAPSHOT") }
            prices[product] = .some(V.money(price["retailPrice"]))
        }
        let rateText: String? = { switch snapshot["commissionRate"] { case .string(let text): return text; case .number(let number): return try? SwiftValue.canonicalPayload(.number(number)); default: return nil } }()
        guard let expectedBalance = V.money(snapshot["previousBalance"]), let rateText, rateText.range(of: "^[0-9]+(?:\\.[0-9]+)?$", options: .regularExpression) != nil,
              let submittedRate = Double(rateText), submittedRate.isFinite, submittedRate <= 1, prices.count == inventory.count, !prices.values.contains(where: { $0 == nil }) else {
            throw Self.restockFailure("INVALID_FINANCIAL_SNAPSHOT")
        }
        // JS compares Number(snapshot rate) with Number(store rate).
        let currentRate = NSDecimalNumber(decimal: rate).doubleValue
        if expectedBalance != previous || submittedRate != currentRate || inventory.contains(where: { row in
            guard let submitted = prices[row.text("productId")] ?? nil, let current = try? SwiftValue.rounded(row["price"].decimal, scale: 2) else { return true }
            return submitted != current
        }) { throw Self.restockFailure("STALE_FINANCIAL_SNAPSHOT") }
    }

    func pay(_ request: SwiftCommandRequest) async throws -> EngineResponse {
        do {
            let result = try await context.transaction(request, roles: Self.roles, failure: "ບໍ່ສາມາດບັນທຶກການຮັບເງິນໄດ້; ກະລຸນາລອງໃໝ່", failureStatus: 500) { tx in
                let body = request.json
                let storeID = V.trimmed(body["storeId"])
                let paid = V.money(body["paidAmount"])
                let method: String? = body["paymentMethod"] == .string("bank") ? "bank" : body["paymentMethod"] == .string("cash") ? "cash" : nil
                guard !storeID.isEmpty, let paid, paid > 0 else { throw SwiftServiceFailure(status: 400, message: "ກະລຸນາໃສ່ຈຳນວນເງິນຫຼາຍກວ່າ 0", retryable: false) }
                guard let method else { throw SwiftServiceFailure(status: 400, message: "ກະລຸນາເລືອກວິທີຮັບເງິນ", retryable: false) }
                guard let key = request.operationKey else { throw SwiftServiceFailure(status: 400, message: "ບໍ່ພົບລະຫັດຄຳຂໍ; ກະລຸນາໂຫຼດໜ້າຄືນແລ້ວລອງໃໝ່", retryable: false) }
                guard key.range(of: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", options: .regularExpression) != nil else {
                    throw SwiftServiceFailure(status: 400, message: "ລະຫັດຄຳຂໍບໍ່ຖືກຕ້ອງ; ກະລຸນາໂຫຼດໜ້າຄືນແລ້ວລອງໃໝ່", retryable: false)
                }
                let receipt = "PM-" + key.replacingOccurrences(of: "-", with: "").uppercased()
                let note = "payment_only:[" + SwiftValue.quote(storeID) + "," + (try SwiftValue.canonicalPayload(.number(paid))) + "," + SwiftValue.quote(method) + "]"
                let payload: JSONValue = .object(["storeId": .string(storeID), "paidAmount": .string(V.moneyString(paid)), "paymentMethod": .string(method)])
                return try await tx.idempotent(scope: "settlement.pay", payload: payload, conflict: Self.payMessages["IDEMPOTENCY_CONFLICT"]!) {
                    if let existing = try await tx.row("""
                    SELECT st.id,st.store_id AS "storeId",v.note,st.previous_balance AS previous,st.paid_amount AS paid,st.closing_balance AS closing,st.payment_status::text AS status
                    FROM settlements st JOIN restock_visits v ON v.id=st.restock_visit_id WHERE st.receipt_number=$1
                    """, [.string(receipt)]) {
                        guard existing.text("storeId") == storeID, existing["note"] == .string(note) else { throw Self.payFailure("IDEMPOTENCY_CONFLICT") }
                        return .object(["settlementId": existing["id"], "receiptNumber": .string(receipt), "previousBalance": .number(existing["previous"].decimal),
                                        "paidAmount": .number(existing["paid"].decimal), "closingBalance": .number(existing["closing"].decimal), "paymentStatus": existing["status"]])
                    }
                    guard let store = try await tx.row("""
                    SELECT s.id,f.id AS "fridgeId",COALESCE((SELECT closing_balance FROM settlements WHERE store_id=s.id ORDER BY settlement_date DESC,id DESC LIMIT 1),0) AS previous,
                    (SELECT v.fridge_id FROM restock_visits v WHERE v.store_id=s.id ORDER BY v.visit_date DESC,v.id DESC LIMIT 1) AS "lastFridgeId"
                    FROM stores s LEFT JOIN fridges f ON f.current_store_id=s.id WHERE s.id=$1 FOR UPDATE OF s
                    """, [.string(storeID)]) else { throw Self.payFailure("STORE_NOT_FOUND") }
                    // A payment-only record still needs a fridge; use the latest visit's when it has left.
                    let fridge = store["fridgeId"] != .null ? store["fridgeId"] : store["lastFridgeId"]
                    guard fridge != .null else { throw Self.payFailure("STORE_NOT_FOUND") }
                    let previous = try SwiftValue.rounded(store["previous"].decimal, scale: 2)
                    guard previous > 0 else { throw Self.payFailure("NO_BALANCE") }
                    guard paid <= previous else { throw Self.payFailure("PAYMENT_EXCEEDS_BALANCE") }
                    let closing = previous - paid, status = closing == 0 ? "paid" : "partial"
                    let now = SwiftServiceJSON.iso(Date()), visitID = SwiftCommandIDs.next(), settlementID = SwiftCommandIDs.next()
                    try await tx.execute("INSERT INTO restock_visits(id,store_id,fridge_id,visit_date,status,driver_user_id,note) VALUES($1,$2,$3,$4::timestamp,'draft',$5,$6)",
                                         [.string(visitID), .string(storeID), fridge, .string(now), .string(tx.user.userID), .string(note)])
                    try await tx.execute("""
                    INSERT INTO settlements(id,restock_visit_id,store_id,gross_amount,store_commission_amount,net_payable_amount,previous_balance,paid_amount,closing_balance,payment_status,payment_method,receipt_number,settlement_date)
                    VALUES($1,$2,$3,0,0,0,$4::numeric,$5::numeric,$6::numeric,$7::"PaymentStatus",$8::"PaymentMethod",$9,$10::timestamp)
                    """, [.string(settlementID), .string(visitID), .string(storeID), .string(V.moneyString(previous)), .string(V.moneyString(paid)), .string(V.moneyString(closing)),
                          .string(status), .string(method), .string(receipt), .string(now)])
                    try await tx.audit(action: "update", entityType: "settlement", entityID: settlementID, storeID: storeID,
                                       summary: "ຮັບເງິນຄ້າງ \(SwiftReadDashboard.localeString(paid)) LAK · \(receipt)",
                                       metadata: .object(["before": .object(["balance": .number(previous)]), "after": .object(["balance": .number(closing)])]))
                    return .object(["settlementId": .string(settlementID), "receiptNumber": .string(receipt), "previousBalance": .number(previous), "paidAmount": .number(paid),
                                    "closingBalance": .number(closing), "paymentStatus": .string(status)])
                }
            }
            return .json(201, result)
        } catch let failure as SwiftServiceFailure where failure.status == 409 && failure.message == Self.payMessages["IDEMPOTENCY_CONFLICT"] && failure.details.isEmpty {
            throw Self.payFailure("IDEMPOTENCY_CONFLICT")
        }
    }
}

extension SwiftValue {
    static func sha256(_ text: String) -> String { SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined() }
}
