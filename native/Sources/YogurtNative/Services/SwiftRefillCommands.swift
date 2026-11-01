import Foundation

/// refills (create) and refills/{id} (lifecycle, FIFO batch allocation into fridge lots).
struct SwiftRefillCommands: Sendable {
    let context: SwiftCommandContext
    private static let roles: Set<String> = ["admin", "driver"]
    private static let transitions: [String: [String]] = [
        "waiting": ["preparing", "delivering", "cancelled"], "preparing": ["delivering", "cancelled"],
        "delivering": ["completed", "cancelled"], "completed": [], "cancelled": [],
    ]
    typealias V = SwiftCommandValue

    func create(_ request: SwiftCommandRequest) async throws -> EngineResponse {
        let result = try await context.transaction(request, roles: Self.roles, failure: "ບໍ່ສາມາດສ້າງຄຳຂໍເຕີມສິນຄ້າໄດ້; ກະລຸນາລອງລາຍການເດີມອີກຄັ້ງ") { tx in
            let invalid = SwiftServiceFailure(status: 400, message: "ຂໍ້ມູນຄຳຂໍເຕີມສິນຄ້າບໍ່ຖືກຕ້ອງ")
            guard case .object(let body) = request.json, case .string(let rawStore)? = body["storeId"] else { throw invalid }
            let storeID = rawStore.trimmingCharacters(in: .whitespacesAndNewlines)
            var note: JSONValue = .null
            switch body["note"] {
            case nil, .null?: break
            case .string(let text)?:
                let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                guard trimmed.utf16.count <= 1000 else { throw invalid }
                note = .string(trimmed)
            default: throw invalid
            }
            guard !storeID.isEmpty else { throw invalid }
            var items: [(id: String, quantity: Int)] = []
            if let raw = body["items"] {
                guard case .array(let rows) = raw, !rows.isEmpty else { throw invalid }
                for row in rows {
                    guard case .object(let item) = row, case .string(let id)? = item["finishedProductId"], !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                          let quantity = V.coercedInteger(item["quantity"], minimum: 1, maximum: 100_000) else { throw invalid }
                    items.append((id.trimmingCharacters(in: .whitespacesAndNewlines), quantity))
                }
            }
            func legacy(_ key: String) throws -> Int {
                guard let value = body[key] else { return 0 }
                guard let count = V.coercedInteger(value, minimum: 0, maximum: 100_000) else { throw invalid }
                return count
            }
            let cheese = try legacy("cheeseQty"), mango = try legacy("mangoQty")
            if items.isEmpty && cheese + mango > 0 {
                let products = try await tx.rows("SELECT id,code FROM finished_products WHERE code IN ('YG-CHS-74','YG-MNG-74') AND is_active")
                if cheese > 0, let id = products.first(where: { $0.text("code") == "YG-CHS-74" })?.id { items.append((id, cheese)) }
                if mango > 0, let id = products.first(where: { $0.text("code") == "YG-MNG-74" })?.id { items.append((id, mango)) }
            }
            if items.isEmpty { throw SwiftServiceFailure(status: 400, message: "ກະລຸນາໃສ່ຈຳນວນສິນຄ້າຢ່າງໜ້ອຍ 1 ລາຍການ") }
            let ids = Array(Set(items.map(\.id)))
            if ids.count != items.count { throw SwiftServiceFailure(status: 400, message: "ມີສິນຄ້າຊ້ຳໃນຄຳຂໍເຕີມສິນຄ້າ") }
            let itemJSON: JSONValue = .array(items.map { .object(["finishedProductId": .string($0.id), "quantity": .integer($0.quantity)]) })
            let changed = "ລາຍການປ່ຽນແປງ ຫຼືສິນຄ້າບໍ່ພ້ອມ; ກະລຸນາໂຫຼດຄືນ"
            return try await tx.idempotent(scope: "refill_create", payload: .object(["storeId": .string(storeID), "note": note, "items": itemJSON]), conflict: changed) {
                let available = try await tx.row("SELECT count(*) AS count FROM finished_products WHERE id = ANY($1::text[]) AND is_active", [.string(Self.textArray(ids))])?["count"].decimal ?? 0
                guard available == Decimal(ids.count) else { throw SwiftCommandFailure.conflict(changed) }
                guard let store = try await tx.row("SELECT s.is_active AS active,f.id AS fridge FROM stores s LEFT JOIN fridges f ON f.current_store_id=s.id WHERE s.id=$1", [.string(storeID)]), store["active"].bool else {
                    throw SwiftServiceFailure(status: 404, message: "ບໍ່ພົບຮ້ານ or inactive")
                }
                guard store["fridge"] != .null else { throw SwiftServiceFailure(status: 409, message: "ຮ້ານນີ້ຍັງບໍ່ມີຕູ້ແຊ່") }
                let refillID = SwiftCommandIDs.next()
                let noteText: JSONValue = note == .string("") ? .null : note
                try await tx.execute("INSERT INTO refill_requests(id,store_id,status,note) VALUES($1,$2,'waiting',$3)", [.string(refillID), .string(storeID), noteText])
                for item in items {
                    try await tx.execute("INSERT INTO refill_request_items(id,refill_request_id,finished_product_id,quantity) VALUES($1,$2,$3,$4::integer)",
                                         [.string(SwiftCommandIDs.next()), .string(refillID), .string(item.id), .integer(item.quantity)])
                }
                let total = items.reduce(0) { $0 + $1.quantity }
                try await tx.audit(action: "create", entityType: "refill_request", entityID: refillID, storeID: storeID, summary: "ສ້າງຄຳຂໍເຕີມສິນຄ້າ · \(total) ຖ້ວຍ", metadata: .object(["items": itemJSON]))
                return .object(["id": .string(refillID), "status": .string("waiting")])
            }
        }
        return .json(201, .object(["id": result["id"], "status": result["status"]]))
    }

    func update(_ request: SwiftCommandRequest, id: String) async throws -> EngineResponse {
        let failed = "ບໍ່ສາມາດອັບເດດສະຖານະການເຕີມສິນຄ້າໄດ້"
        let result = try await context.transaction(request, roles: Self.roles, failure: failed, failureStatus: 400, failureRetryable: nil) { tx -> JSONValue in
            guard case .object(let body) = request.json else { throw SwiftServiceFailure(status: 400, message: failed) }
            let next = V.jsString(body["status"])
            guard Self.transitions[next] != nil else { throw SwiftServiceFailure(status: 400, message: "ສະຖານະການເຕີມສິນຄ້າບໍ່ຖືກຕ້ອງ") }
            guard let refill = try await tx.row("""
            SELECT r.id,r.store_id AS "storeId",r.status::text AS status,r.delivered_at AS "deliveredAt",s.name AS "storeName",s.is_active AS "storeActive",
            COALESCE((SELECT json_agg(json_build_object('productId',i.finished_product_id,'quantity',i.quantity) ORDER BY i.id) FROM refill_request_items i WHERE i.refill_request_id=r.id),'[]'::json) AS items
            FROM refill_requests r JOIN stores s ON s.id=r.store_id WHERE r.id=$1 FOR UPDATE OF r
            """, [.string(id)]) else { throw SwiftServiceFailure(status: 404, message: "ບໍ່ພົບຄຳຂໍເຕີມສິນຄ້າ") }
            let current = refill.text("status")
            if current == next { return .object(["id": refill["id"], "status": .string(current), "alreadyApplied": .bool(true)]) }
            guard Self.transitions[current]?.contains(next) == true else { throw SwiftServiceFailure(status: 409, message: "ບໍ່ສາມາດປ່ຽນໄປສະຖານະນີ້ໄດ້") }
            var deductions: [JSONValue] = []
            if next == "completed" {
                guard refill["storeActive"].bool else { throw SwiftServiceFailure(status: 409, message: "ຮ້ານນີ້ຖືກປິດໃຊ້") }
                guard let fridge = try await tx.row("""
                SELECT f.id,f.status::text AS status,f.capacity_cups AS capacity,
                COALESCE((SELECT json_agg(json_build_object('productId',i.finished_product_id,'stock',i.current_stock)) FROM fridge_inventory i WHERE i.fridge_id=f.id),'[]'::json) AS inventory
                FROM fridges f WHERE f.current_store_id=$1 FOR UPDATE OF f
                """, [refill["storeId"]]) else { throw SwiftServiceFailure(status: 409, message: "ຮ້ານນີ້ຍັງບໍ່ມີຕູ້ແຊ່") }
                guard fridge.text("status") == "active" else { throw SwiftServiceFailure(status: 409, message: "ຕູ້ແຊ່ຢູ່ໃນສະຖານະບຳລຸງ") }
                let inventory = fridge["inventory"].array
                let currentTotal = SwiftServiceJSON.sum(inventory, "stock"), incoming = SwiftServiceJSON.sum(refill["items"].array, "quantity"), capacity = fridge["capacity"].decimal
                if currentTotal + incoming > capacity {
                    throw SwiftServiceFailure(status: 409, message: "ຕູ້ແຊ່ບັນຈຸບໍ່ພໍ: ມີແລ້ວ \(V.text(currentTotal)) ຖ້ວຍ + ເຕີມ \(V.text(incoming)) ຖ້ວຍ ເກີນຄວາມຈຸ \(V.text(capacity)) ຖ້ວຍ")
                }
                let now = Date()
                for item in refill["items"].array {
                    let productID = item.text("productId"), quantity = NSDecimalNumber(decimal: item["quantity"].decimal).intValue
                    let stock = inventory.first { $0.text("productId") == productID }.map { NSDecimalNumber(decimal: $0["stock"].decimal).intValue } ?? 0
                    try await SwiftStockLots.ensure(tx, storeID: refill.text("storeId"), fridgeID: fridge.id, productID: productID, currentStock: stock)
                    let batches = try await tx.rows("""
                    SELECT id,quantity_remaining AS remaining,unit_cost AS "unitCost",cost_known AS "costKnown",exp_date AS "expDate" FROM production_batches
                    WHERE finished_product_id=$1 AND status='completed' AND exp_date >= $2::timestamp AND quantity_remaining>0 ORDER BY exp_date ASC,mfg_date ASC,id ASC FOR UPDATE
                    """, [.string(productID), .string(SwiftServiceJSON.iso(now))])
                    let available = SwiftServiceJSON.sum(batches, "remaining")
                    if available < Decimal(quantity) {
                        let name = try await tx.row("SELECT name FROM finished_products WHERE id=$1", [.string(productID)])?.text("name") ?? productID
                        throw SwiftServiceFailure(status: 409, message: "ສິນຄ້າໃນສາງບໍ່ພໍ: \(name) ມີ \(V.text(available)) ຖ້ວຍ (ທີ່ຍັງບໍ່ໝົດອາຍຸ), ຕ້ອງການ \(quantity) ຖ້ວຍ")
                    }
                    var need = quantity
                    for batch in batches where need > 0 {
                        let take = min(need, NSDecimalNumber(decimal: batch["remaining"].decimal).intValue)
                        try await tx.execute("UPDATE production_batches SET quantity_remaining=quantity_remaining-$2::integer WHERE id=$1", [batch["id"], .integer(take)])
                        try await tx.execute("""
                        INSERT INTO fridge_stock_lots(id,store_id,fridge_id,finished_product_id,production_batch_id,refill_request_id,quantity_received,quantity_remaining,unit_cost,cost_known,exp_date)
                        VALUES($1,$2,$3,$4,$5,$6,$7::integer,$7::integer,$8::numeric,$9::boolean,$10::timestamp)
                        """, [.string(SwiftCommandIDs.next()), refill["storeId"], .string(fridge.id), .string(productID), batch["id"], refill["id"], .integer(take), batch["unitCost"], batch["costKnown"], batch["expDate"]])
                        deductions.append(.object(["productId": .string(productID), "batchId": batch["id"], "quantity": .integer(take)]))
                        need -= take
                    }
                    try await tx.execute("""
                    INSERT INTO fridge_inventory(id,fridge_id,store_id,finished_product_id,current_stock) VALUES($1,$2,$3,$4,$5::integer)
                    ON CONFLICT (fridge_id,finished_product_id) DO UPDATE SET store_id=EXCLUDED.store_id,current_stock=fridge_inventory.current_stock+EXCLUDED.current_stock
                    """, [.string(SwiftCommandIDs.next()), .string(fridge.id), refill["storeId"], .string(productID), .integer(quantity)])
                }
                try await tx.execute("UPDATE refill_requests SET status='completed',delivered_at=$2::timestamp WHERE id=$1", [refill["id"], .string(SwiftServiceJSON.iso(Date()))])
            } else {
                try await tx.execute("UPDATE refill_requests SET status=$2::\"RefillRequestStatus\" WHERE id=$1", [refill["id"], .string(next)])
            }
            try await tx.audit(action: "status", entityType: "refill_request", entityID: refill.id, summary: "ເຕີມສິນຄ້າ → \(next)")
            return .object(["id": refill["id"], "status": .string(next), "deductions": .array(deductions), "storeName": refill["storeName"]])
        }
        return .json(200, result)
    }

    /// A PostgreSQL text[] literal for bound IDs (IDs are validated alphanumerics).
    static func textArray(_ values: [String]) -> String {
        "{" + values.map { "\"" + $0.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\"" }.joined(separator: ",") + "}"
    }
}

extension SwiftCommandValue {
    /// `String(value ?? "")` without trimming, as status/action fields use it.
    static func jsString(_ value: JSONValue?) -> String {
        guard let value else { return "" }
        if case .string(let text) = value { return text }
        return trimmed(value)
    }
}
