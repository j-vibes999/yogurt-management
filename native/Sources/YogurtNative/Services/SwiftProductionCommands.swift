import Foundation

/// production-batches: scale the default recipe, deduct materials and snapshot batch cost.
struct SwiftProductionCommands: Sendable {
    let context: SwiftCommandContext
    typealias V = SwiftCommandValue

    func create(_ request: SwiftCommandRequest) async throws -> EngineResponse {
        let result = try await context.transaction(request, roles: ["admin", "production"], failure: "ບໍ່ສາມາດສ້າງລັອດຜະລິດໄດ້") { tx in
            let invalid = SwiftServiceFailure(status: 400, message: "ສິນຄ້າ ຫຼືຈຳນວນຜະລິດບໍ່ຖືກຕ້ອງ", retryable: false)
            guard case .object(let body) = request.json, case .string(let rawProduct)? = body["productId"] else { throw invalid }
            let productID = rawProduct.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !productID.isEmpty, let cupsValue = body["cups"], let cups = V.positiveInteger(cupsValue), cups <= 100_000 else { throw invalid }
            let outOfRange = SwiftServiceFailure(status: 400, message: "ມູນຄ່າການຜະລິດເກີນຂອບເຂດທີ່ຮອງຮັບ", retryable: false)
            let invalidRecipe = SwiftServiceFailure(status: 400, message: "ຈຳນວນວັດຖຸດິບໃນສູດນ້ອຍເກີນໄປສຳລັບການຜະລິດຄັ້ງນີ້", retryable: false)
            let payload: JSONValue = .object(["productId": .string(productID), "cups": .integer(cups)])
            return try await tx.idempotent(scope: "production.create", payload: payload, invalidKey: "ກະລຸນາໃສ່ລະຫັດລາຍການທີ່ຖືກຕ້ອງ") {
                guard let product = try await tx.row("""
                SELECT p.id,p.code,p.name,p.shelf_life_days AS "shelfLifeDays",p.is_active AS active,
                (SELECT json_build_object('id',r.id,'version',r.version,'baseCups',r.base_cups,'items',COALESCE((SELECT json_agg(json_build_object('rawMaterialId',i.raw_material_id,'quantityRequired',i.quantity_required,
                  'name',m.name,'unit',m.unit,'active',m.is_active,'stock',m.current_stock,'cost',m.avg_cost_per_unit) ORDER BY i.id) FROM recipe_items i JOIN raw_materials m ON m.id=i.raw_material_id WHERE i.recipe_id=r.id),'[]'::json))
                 FROM recipes r WHERE r.finished_product_id=p.id AND r.is_default ORDER BY r.version DESC LIMIT 1) AS recipe
                FROM finished_products p WHERE p.id=$1
                """, [.string(productID)]), product["active"].bool, product["recipe"] != .null else {
                    throw SwiftServiceFailure(status: 404, message: "ບໍ່ພົບສິນຄ້າທີ່ເປີດໃຊ້ ຫຼືສູດຫຼັກ", retryable: false)
                }
                let recipe = product["recipe"], items = recipe["items"].array
                guard !items.isEmpty else { throw invalidRecipe }
                // Lock the recipe's materials in a stable order before reading their stock.
                let ids = items.map { $0.text("rawMaterialId") }.sorted { $0.compare($1, locale: Locale(identifier: "en_US")) == .orderedAscending }
                let fresh = try await tx.rows("SELECT id,current_stock AS stock,avg_cost_per_unit AS cost,is_active AS active FROM raw_materials WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE",
                                              [.string(SwiftRefillCommands.textArray(ids))])
                struct Requirement { let id: String, name: String, unit: String, available: Decimal, required: Decimal, cost: Decimal; var materialCost: Decimal { required * cost } }
                var requirements: [Requirement] = []
                for item in items {
                    let current = fresh.first { $0.id == item.text("rawMaterialId") } ?? item
                    guard current["active"].bool else { throw SwiftServiceFailure(status: 409, message: "ສູດນີ້ມີວັດຖຸດິບທີ່ຖືກປິດໃຊ້", retryable: false) }
                    let baseCups = recipe["baseCups"].decimal
                    guard baseCups > 0, let required = V.atScale(item["quantityRequired"].decimal * Decimal(cups) / baseCups, V.stockScale, positive: true, round: true) else { throw invalidRecipe }
                    requirements.append(Requirement(id: item.text("rawMaterialId"), name: item.text("name"), unit: item.text("unit"), available: current["stock"].decimal, required: required, cost: current["cost"].decimal))
                }
                let shortages = requirements.filter { $0.available < $0.required }
                if !shortages.isEmpty {
                    throw SwiftServiceFailure(status: 409, message: "ວັດຖຸດິບບໍ່ພໍສຳລັບການຜະລິດຄັ້ງນີ້", retryable: false, details: ["shortages": .array(shortages.map {
                        .object(["rawMaterialId": .string($0.id), "name": .string($0.name), "unit": .string($0.unit), "available": .number($0.available), "required": .number($0.required)])
                    })])
                }
                let exact = requirements.reduce(Decimal(0)) { $0 + $1.materialCost }
                guard let totalCost = V.atScale(exact, V.moneyScale, round: true), let unitCost = V.atScale(exact / Decimal(cups), V.unitCostScale, round: true) else { throw outOfRange }
                for item in requirements.sorted(by: { $0.id.compare($1.id, locale: Locale(identifier: "en_US")) == .orderedAscending }) {
                    try await tx.execute("UPDATE raw_materials SET current_stock=current_stock-$2::numeric WHERE id=$1", [.string(item.id), .number(item.required)])
                }
                let now = Date(), expires = now.addingTimeInterval(Double(NSDecimalNumber(decimal: product["shelfLifeDays"].decimal).intValue) * 86400)
                let prefix = String(product.text("code").filter { $0.isASCII && ($0.isLetter || $0.isNumber) }.prefix(6)).uppercased()
                let stamp = String(SwiftServiceJSON.iso(now).filter { !"-:TZ.".contains($0) }.prefix(14))
                let batchNumber = "\(prefix.isEmpty ? "BATCH" : prefix)-\(stamp)-\(UUID().uuidString.prefix(8).uppercased())"
                let batchID = SwiftCommandIDs.next()
                try await tx.execute("""
                INSERT INTO production_batches(id,batch_number,recipe_id,finished_product_id,quantity_produced,quantity_remaining,total_material_cost,unit_cost,cost_known,mfg_date,exp_date,status)
                VALUES($1,$2,$3,$4,$5::integer,$5::integer,$6::numeric,$7::numeric,true,$8::timestamp,$9::timestamp,'completed')
                """, [.string(batchID), .string(batchNumber), recipe["id"], .string(productID), .integer(cups), .number(totalCost), .number(unitCost), .string(SwiftServiceJSON.iso(now)), .string(SwiftServiceJSON.iso(expires))])
                try await tx.audit(action: "create", entityType: "production_batch", entityID: batchID, summary: "ຜະລິດ \(product.text("name")) · \(cups) ຖ້ວຍ",
                                   metadata: .object(["productId": .string(productID), "batchNumber": .string(batchNumber), "unitCost": .number(unitCost), "costKnown": .bool(true)]))
                return .object(["id": .string(batchID), "batchNumber": .string(batchNumber), "productId": .string(productID), "productName": product["name"], "recipeVersion": recipe["version"],
                                "quantityProduced": .integer(cups), "quantityRemaining": .integer(cups), "totalMaterialCost": .number(totalCost), "unitCost": .number(unitCost), "costKnown": .bool(true),
                                "mfgDate": .string(SwiftServiceJSON.iso(now)), "expDate": .string(SwiftServiceJSON.iso(expires)),
                                "materialsUsed": .array(requirements.map { .object(["name": .string($0.name), "unit": .string($0.unit), "quantity": .number($0.required), "avgCostPerUnit": .number($0.cost), "materialCost": .number($0.materialCost)]) })])
            }
        }
        return .json(201, result)
    }
}
