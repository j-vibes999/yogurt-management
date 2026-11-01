import Foundation

/// inventory/receive and inventory/adjust (including action=update_material).
struct SwiftInventoryCommands: Sendable {
    let context: SwiftCommandContext
    private static let roles: Set<String> = ["admin", "production"]
    typealias V = SwiftCommandValue

    func receive(_ request: SwiftCommandRequest) async throws -> EngineResponse {
        let result = try await context.transaction(request, roles: Self.roles, failure: "ບໍ່ສາມາດຮັບວັດຖຸດິບໄດ້") { tx in
            let body = try request.object()
            let supplierName = V.trimmed(body["supplierName"]), rawMaterialID = V.trimmed(body["rawMaterialId"])
            let quantity = V.atScale(body["quantity"], V.stockScale, positive: true), unitPrice = V.atScale(body["unitPrice"], V.unitCostScale)
            let note = V.optionalText(body["note"])
            guard !supplierName.isEmpty, !rawMaterialID.isEmpty, let quantity, let unitPrice else {
                throw SwiftCommandFailure.invalid("ກະລຸນາໃສ່ຜູ້ສະໜອງ, ວັດຖຸດິບ, ຈຳນວນ ແລະລາຄາຕໍ່ຫົວໜ່ວຍທີ່ຖືກຕ້ອງ")
            }
            let submittedDate = body.object["purchaseDate"]
            let purchaseDate: String
            if submittedDate == nil { purchaseDate = businessDateString(Date()) }
            else if case .string(let text) = submittedDate!, let day = SwiftDates.dateOnly(text) { purchaseDate = day }
            else { throw SwiftCommandFailure.invalid("ວັນທີຊື້ບໍ່ຖືກຕ້ອງ") }
            // Hash the submitted date, so a retry without a date does not change identity.
            let payload: JSONValue = .object(["supplierName": .string(supplierName), "rawMaterialId": .string(rawMaterialID), "quantity": .string(V.text(quantity)),
                                              "unitPrice": .string(V.text(unitPrice)), "note": note, "purchaseDate": submittedDate ?? .null])
            return try await tx.idempotent(scope: "inventory.receive", payload: payload) {
                guard let material = try await tx.row("SELECT id,name,unit,is_active AS \"isActive\",current_stock AS \"currentStock\",avg_cost_per_unit AS \"avgCost\" FROM raw_materials WHERE id=$1 FOR UPDATE", [.string(rawMaterialID)]) else {
                    throw SwiftCommandFailure.notFound("ບໍ່ພົບວັດຖຸດິບ")
                }
                guard material["isActive"].bool else { throw SwiftCommandFailure.conflict("ວັດຖຸດິບນີ້ຖືກປິດໃຊ້") }
                let old = material["currentStock"].decimal, oldAverage = material["avgCost"].decimal
                let stock = old + quantity
                guard stock > 0, let newStock = V.atScale(stock, V.stockScale, positive: true),
                      let weightedAverage = V.atScale((old * oldAverage + quantity * unitPrice) / stock, V.unitCostScale, round: true),
                      let totalPrice = V.atScale(quantity * unitPrice, V.moneyScale, round: true) else { throw SwiftCommandFailure.outOfRange }
                let purchaseID = SwiftCommandIDs.next()
                try await tx.execute("INSERT INTO purchase_orders(id,supplier_name,purchase_date,total_cost,note,created_by) VALUES($1,$2,$3::timestamp,$4::numeric,$5,$6)",
                                     [.string(purchaseID), .string(supplierName), .string(purchaseDate + "T12:00:00.000"), .number(totalPrice), note, .string(tx.user.userID)])
                try await tx.execute("INSERT INTO purchase_order_items(id,purchase_order_id,raw_material_id,quantity,unit_price,total_price) VALUES($1,$2,$3,$4::numeric,$5::numeric,$6::numeric)",
                                     [.string(SwiftCommandIDs.next()), .string(purchaseID), .string(rawMaterialID), .number(quantity), .number(unitPrice), .number(totalPrice)])
                try await tx.execute("UPDATE raw_materials SET current_stock=$2::numeric,avg_cost_per_unit=$3::numeric WHERE id=$1", [.string(rawMaterialID), .number(newStock), .number(weightedAverage)])
                try await tx.audit(action: "receive", entityType: "purchase_order", entityID: purchaseID,
                                   summary: "ຮັບ \(material.text("name")) ຈາກ \(supplierName) · \(V.text(quantity)) \(material.text("unit"))")
                return .object(["id": .string(purchaseID), "newStock": .number(newStock), "weightedAvg": .number(weightedAverage), "totalPrice": .number(totalPrice),
                                "materialName": material["name"], "unit": material["unit"]])
            }
        }
        return .json(201, result)
    }

    func adjust(_ request: SwiftCommandRequest) async throws -> EngineResponse {
        let invalidKey = "ກະລຸນາໃສ່ລະຫັດລາຍການທີ່ຖືກຕ້ອງ"
        let outcome = try await context.transaction(request, roles: Self.roles, failure: "ບໍ່ສາມາດປັບຈຳນວນວັດຖຸດິບໄດ້") { tx -> (Int, JSONValue) in
            let body = try request.object()
            let rawMaterialID = V.trimmed(body["rawMaterialId"])
            if body["action"] == .string("update_material") {
                return (200, try await updateMaterial(tx, body: body, rawMaterialID: rawMaterialID, invalidKey: invalidKey))
            }
            guard let delta = V.atScale(body["quantityDelta"], V.stockScale, allowNegative: true, nonzero: true), !rawMaterialID.isEmpty, !V.trimmed(body["reason"]).isEmpty else {
                throw SwiftCommandFailure.invalid("ກະລຸນາເລືອກວັດຖຸດິບ, ໃສ່ຈຳນວນທີ່ຈະປັບ ແລະເຫດຜົນ")
            }
            let reason = V.trimmed(body["reason"]), note = V.optionalText(body["note"])
            let payload: JSONValue = .object(["rawMaterialId": .string(rawMaterialID), "quantityDelta": .string(V.text(delta)), "reason": .string(reason), "note": note])
            let result = try await tx.idempotent(scope: "inventory.adjust", payload: payload, invalidKey: invalidKey) {
                guard let material = try await tx.row("SELECT current_stock AS \"currentStock\" FROM raw_materials WHERE id=$1 FOR UPDATE", [.string(rawMaterialID)]) else {
                    throw SwiftCommandFailure.notFound("ບໍ່ພົບວັດຖຸດິບ")
                }
                let before = material["currentStock"].decimal
                guard let after = V.atScale(before + delta, V.stockScale) else {
                    throw before + delta < 0 ? SwiftCommandFailure.conflict("ການປັບນີ້ຈະເຮັດໃຫ້ຈຳນວນຄົງເຫຼືອຕິດລົບ") : SwiftServiceFailure(status: 400, message: "ຈຳນວນວັດຖຸດິບເກີນຂອບເຂດທີ່ຮອງຮັບ", retryable: false)
                }
                let adjustmentID = SwiftCommandIDs.next()
                try await tx.execute("INSERT INTO raw_material_adjustments(id,raw_material_id,quantity_delta,reason,note) VALUES($1,$2,$3::numeric,$4,$5)",
                                     [.string(adjustmentID), .string(rawMaterialID), .number(delta), .string(reason), note])
                try await tx.execute("UPDATE raw_materials SET current_stock=$2::numeric WHERE id=$1", [.string(rawMaterialID), .number(after)])
                let result: JSONValue = .object(["id": .string(adjustmentID), "materialId": .string(rawMaterialID), "before": .number(before), "delta": .number(delta), "after": .number(after)])
                try await tx.audit(action: "adjust", entityType: "raw_material", entityID: rawMaterialID,
                                   summary: "ປັບຈຳນວນຄົງເຫຼືອ \(delta > 0 ? "+" : "")\(V.text(delta)) · \(reason)",
                                   metadata: .object(["before": .number(before), "delta": .number(delta), "after": .number(after), "reason": .string(reason), "note": note]))
                return result
            }
            return (201, result)
        }
        return .json(outcome.0, outcome.1)
    }

    private func updateMaterial(_ tx: SwiftCommandTransaction, body: JSONValue, rawMaterialID: String, invalidKey: String) async throws -> JSONValue {
        let fields = body.object
        let stockPresent = fields["stock"] != nil, pricePresent = fields["avgCostPerUnit"] != nil, minimumPresent = fields["minStock"] != nil
        let namePresent = fields["name"] != nil, unitPresent = fields["unit"] != nil
        let stock = stockPresent ? V.atScale(body["stock"], V.stockScale) : nil
        let expected = stockPresent ? V.atScale(body["expectedStock"], V.stockScale) : nil
        let price = pricePresent ? V.atScale(body["avgCostPerUnit"], V.unitCostScale) : nil
        let minimum = minimumPresent ? V.atScale(body["minStock"], 3) : nil
        let name = namePresent ? V.trimmed(body["name"]) : "", unit = unitPresent ? V.trimmed(body["unit"]) : ""
        let stockReason = V.trimmed(body["stockReason"])
        if rawMaterialID.isEmpty || (!stockPresent && !pricePresent && !minimumPresent && !namePresent && !unitPresent)
            || (stockPresent && (stock == nil || expected == nil)) || (pricePresent && price == nil)
            || (minimumPresent && minimum == nil) || (namePresent && name.isEmpty) || (unitPresent && unit.isEmpty) {
            throw SwiftCommandFailure.invalid("ຂໍ້ມູນວັດຖຸດິບບໍ່ຖືກຕ້ອງ")
        }
        return try await tx.idempotent(scope: "inventory.update_material", payload: body, invalidKey: invalidKey) {
            guard let before = try await tx.row("SELECT id,name,unit,current_stock AS stock,min_stock_alert AS \"minStock\",avg_cost_per_unit AS cost FROM raw_materials WHERE id=$1 FOR UPDATE", [.string(rawMaterialID)]) else {
                throw SwiftCommandFailure.notFound("ບໍ່ພົບວັດຖຸດິບ")
            }
            if stock != nil, before["stock"].decimal != expected! { throw SwiftCommandFailure.conflict("ຈຳນວນຄົງເຫຼືອປ່ຽນແປງແລ້ວ ກະລຸນາໂຫຼດໜ້າໃໝ່ແລ້ວລອງອີກຄັ້ງ") }
            if unitPresent, unit != before.text("unit") { throw SwiftCommandFailure.conflict("ບໍ່ສາມາດປ່ຽນຫົວໜ່ວຍຂອງວັດຖຸດິບທີ່ມີແລ້ວ") }
            var after = (name: namePresent ? name : before.text("name"), stock: before["stock"].decimal, minimum: minimum ?? before["minStock"].decimal, cost: price ?? before["cost"].decimal)
            if let stock, stock != before["stock"].decimal {
                guard !stockReason.isEmpty else { throw SwiftCommandFailure.invalid("ກະລຸນາໃສ່ເຫດຜົນເມື່ອປ່ຽນຈຳນວນຄົງເຫຼືອ") }
                try await tx.execute("INSERT INTO raw_material_adjustments(id,raw_material_id,quantity_delta,reason,note) VALUES($1,$2,$3::numeric,'manual_correction',$4)",
                                     [.string(SwiftCommandIDs.next()), .string(rawMaterialID), .number(stock - before["stock"].decimal), .string(stockReason)])
                after.stock = stock
            }
            try await tx.execute("UPDATE raw_materials SET name=$2,current_stock=$3::numeric,min_stock_alert=$4::numeric,avg_cost_per_unit=$5::numeric WHERE id=$1",
                                 [.string(rawMaterialID), .string(after.name), .number(after.stock), .number(after.minimum), .number(after.cost)])
            let unitText = before.text("unit")
            func snapshot(_ name: String, _ stock: Decimal, _ minimum: Decimal, _ cost: Decimal) -> JSONValue {
                .object(["name": .string(name), "unit": .string(unitText), "stock": .number(stock), "minStock": .number(minimum), "cost": .number(cost)])
            }
            try await tx.audit(action: "update", entityType: "raw_material", entityID: rawMaterialID,
                               summary: "ແກ້ໄຂ \(after.name) · ຈຳນວນຄົງເຫຼືອ \(V.text(before["stock"].decimal)) → \(V.text(after.stock)) \(unitText) · ຕົ້ນທຶນ \(SwiftReadDashboard.localeString(after.cost)) LAK/\(unitText)",
                               metadata: .object(["before": snapshot(before.text("name"), before["stock"].decimal, before["minStock"].decimal, before["cost"].decimal),
                                                  "after": snapshot(after.name, after.stock, after.minimum, after.cost)]))
            return .object(["id": .string(rawMaterialID), "stock": .number(after.stock), "minStock": .number(after.minimum), "avgCostPerUnit": .number(after.cost)])
        }
    }
}

enum SwiftDates {
    /// date-only.ts parseDateOnly: a real calendar day `YYYY-MM-DD` (after trimming).
    static func dateOnly(_ raw: String) -> String? {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.range(of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", options: .regularExpression) != nil else { return nil }
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.calendar = Calendar(identifier: .gregorian); formatter.dateFormat = "yyyy-MM-dd"; formatter.isLenient = false
        guard let date = formatter.date(from: text), formatter.string(from: date) == text else { return nil }
        return text
    }
}
