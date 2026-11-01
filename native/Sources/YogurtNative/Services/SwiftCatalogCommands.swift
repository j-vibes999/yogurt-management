import Foundation

/// products, products/{id}, materials, materials/{id}, recipes and finished-goods/adjust.
struct SwiftCatalogCommands: Sendable {
    let context: SwiftCommandContext
    typealias V = SwiftCommandValue
    private struct Invalid: Error {}

    /// zod string field: required unless `optional`, trimmed, UTF-16 bounds, `nullable` allows null.
    private static func string(_ fields: [String: JSONValue], _ key: String, min: Int = 0, max: Int, optional: Bool = false, nullable: Bool = false) throws -> String?? {
        guard let value = fields[key] else { if optional { return .none }; throw Invalid() }
        switch value {
        case .null: guard nullable else { throw Invalid() }; return .some(nil)
        case .string(let raw):
            let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard text.utf16.count >= min, text.utf16.count <= max else { throw Invalid() }
            return .some(text)
        default: throw Invalid()
        }
    }
    private static func product(_ row: JSONValue) -> JSONValue {
        .object(["id": row["id"], "code": row["code"], "name": row["name"], "sizeDescription": row["sizeDescription"], "retailPrice": .number(row["retailPrice"].decimal),
                 "shelfLifeDays": row["shelfLifeDays"], "isActive": row["isActive"]])
    }
    private static let productColumns = "id,code,name,size_description AS \"sizeDescription\",retail_price AS \"retailPrice\",shelf_life_days AS \"shelfLifeDays\",is_active AS \"isActive\""

    /// product-input.ts parseProductPrice: two places, at most Decimal(12,2).
    private static func price(_ value: JSONValue) -> String? {
        guard let amount = V.money(value), amount <= Decimal(string: "9999999999.99")! else { return nil }
        return V.moneyString(amount)
    }

    func createProduct(_ request: SwiftCommandRequest) async throws -> EngineResponse {
        let conflict = "ລະຫັດສິນຄ້າ ຫຼືລາຍການນີ້ມີແລ້ວ"
        let result = try await context.transaction(request, roles: ["admin"], failure: "ບັນທຶກບໍ່ສຳເລັດ; ກະລຸນາລອງລາຍການເດີມອີກຄັ້ງ", map: { $0.sqlState == "23505" ? SwiftServiceFailure(status: 409, message: conflict, retryable: false) : nil }) { tx in
            let invalid = SwiftServiceFailure(status: 400, message: "ຂໍ້ມູນສິນຄ້າບໍ່ຖືກຕ້ອງ; ລາຄາຕ້ອງມີທົດສະນິຍົມບໍ່ເກີນ 2 ຕຳແໜ່ງ", retryable: false)
            guard case .object(let fields) = request.json else { throw invalid }
            let code: String, name: String, size: String??
            do { code = (try Self.string(fields, "code", min: 1, max: 40) ?? nil)!; name = (try Self.string(fields, "name", min: 1, max: 120) ?? nil)!; size = try Self.string(fields, "sizeDescription", max: 120, optional: true, nullable: true) }
            catch { throw invalid }
            guard let retail = fields["retailPrice"].flatMap(Self.price), let shelf = fields["shelfLifeDays"].flatMap(V.positiveInteger), shelf <= 3650 else { throw invalid }
            var payload: [String: JSONValue] = ["code": .string(code), "name": .string(name), "retailPrice": .string(retail), "shelfLifeDays": .integer(shelf)]
            if case .some(let value) = size { payload["sizeDescription"] = value.map(JSONValue.string) ?? .null }
            return try await tx.idempotent(scope: "product.create", payload: .object(payload), conflict: conflict) {
                if try await tx.row("SELECT 1 AS found FROM finished_products WHERE code=$1", [.string(code)]) != nil { throw SwiftServiceFailure(status: 409, message: conflict, retryable: false) }
                let id = SwiftCommandIDs.next()
                let sizeValue: JSONValue = (size ?? nil).flatMap { $0.isEmpty ? nil : JSONValue.string($0) } ?? .null
                guard let row = try await tx.returning("INSERT INTO finished_products(id,code,name,size_description,retail_price,shelf_life_days) VALUES($1,$2,$3,$4,$5::numeric,$6::integer) RETURNING \(Self.productColumns)",
                                                       [.string(id), .string(code), .string(name), sizeValue, .string(retail), .integer(shelf)]).first else { throw Invalid() }
                try await tx.audit(action: "create", entityType: "finished_product", entityID: id, summary: "ສ້າງສິນຄ້າ \(name)")
                return .object(["product": Self.product(row)])
            }
        }
        return .json(201, result)
    }

    func updateProduct(_ request: SwiftCommandRequest, id: String) async throws -> EngineResponse {
        let conflict = "ລະຫັດສິນຄ້າ ຫຼືລາຍການນີ້ມີແລ້ວ"
        let result = try await context.transaction(request, roles: ["admin"], failure: "ບັນທຶກບໍ່ສຳເລັດ; ກະລຸນາລອງລາຍການເດີມອີກຄັ້ງ", map: { $0.sqlState == "23505" ? SwiftServiceFailure(status: 409, message: conflict, retryable: false) : nil }) { tx in
            let invalid = SwiftServiceFailure(status: 400, message: "ຂໍ້ມູນສິນຄ້າບໍ່ຖືກຕ້ອງ; ລາຄາຕ້ອງມີທົດສະນິຍົມບໍ່ເກີນ 2 ຕຳແໜ່ງ", retryable: false)
            guard case .object(let fields) = request.json else { throw invalid }
            var changes: [String: JSONValue] = [:]
            do {
                if case .some(let value) = try Self.string(fields, "code", min: 1, max: 40, optional: true) { changes["code"] = .string(value!) }
                if case .some(let value) = try Self.string(fields, "name", min: 1, max: 120, optional: true) { changes["name"] = .string(value!) }
                if case .some(let value) = try Self.string(fields, "sizeDescription", max: 120, optional: true, nullable: true) { changes["sizeDescription"] = value.map(JSONValue.string) ?? .null }
            } catch { throw invalid }
            if let raw = fields["retailPrice"] { guard let retail = Self.price(raw) else { throw invalid }; changes["retailPrice"] = .string(retail) }
            if let raw = fields["shelfLifeDays"] { guard let shelf = V.positiveInteger(raw), shelf <= 3650 else { throw invalid }; changes["shelfLifeDays"] = .integer(shelf) }
            if let raw = fields["isActive"] { guard case .bool = raw else { throw invalid }; changes["isActive"] = raw }
            guard !changes.isEmpty else { throw invalid }
            return try await tx.idempotent(scope: "product.update", payload: .object(changes.merging(["id": .string(id)], uniquingKeysWith: { _, new in new })), conflict: conflict) {
                guard let before = try await tx.row("SELECT \(Self.productColumns) FROM finished_products WHERE id=$1 FOR UPDATE", [.string(id)]) else {
                    throw SwiftServiceFailure(status: 404, message: "ບໍ່ພົບສິນຄ້າ", retryable: false)
                }
                if let code = changes["code"], code != before["code"], try await tx.row("SELECT 1 AS found FROM finished_products WHERE code=$1 AND id<>$2", [code, .string(id)]) != nil {
                    throw SwiftServiceFailure(status: 409, message: conflict, retryable: false)
                }
                guard let after = try await tx.returning("""
                UPDATE finished_products SET code=$2,name=$3,size_description=$4,retail_price=$5::numeric,shelf_life_days=$6::integer,is_active=$7::boolean WHERE id=$1 RETURNING \(Self.productColumns)
                """, [.string(id), changes["code"] ?? before["code"], changes["name"] ?? before["name"], changes["sizeDescription"] ?? before["sizeDescription"],
                      changes["retailPrice"] ?? before["retailPrice"], changes["shelfLifeDays"] ?? before["shelfLifeDays"], changes["isActive"] ?? before["isActive"]]).first else { throw Invalid() }
                try await tx.audit(action: "update", entityType: "finished_product", entityID: id, summary: "ແກ້ໄຂສິນຄ້າ \(after.text("name"))",
                                   metadata: .object(["before": Self.product(before), "after": Self.product(after)]))
                return .object(["product": Self.product(after)])
            }
        }
        return .json(200, result)
    }

    // MARK: materials

    private static func material(_ row: JSONValue) -> JSONValue {
        .object(["id": row["id"], "code": row["code"], "name": row["name"], "category": row["category"], "unit": row["unit"], "minStock": .number(row["minStock"].decimal),
                 "cost": .number(row["cost"].decimal), "isActive": row["isActive"]])
    }
    private static let materialColumns = "id,code,name,category::text AS category,unit,min_stock_alert AS \"minStock\",avg_cost_per_unit AS cost,is_active AS \"isActive\",current_stock AS stock"

    /// `z.coerce.number().nonnegative()` as JS Number, kept in JS's own decimal text.
    private static func nonnegativeNumber(_ value: JSONValue) -> Decimal? {
        guard let number = V.jsNumber(value), number >= 0 else { return nil }
        return number
    }

    func createMaterial(_ request: SwiftCommandRequest) async throws -> EngineResponse {
        let conflict = "ລະຫັດວັດຖຸດິບ ຫຼືລາຍການນີ້ມີແລ້ວ"
        let result = try await context.transaction(request, roles: ["admin"], failure: "ບັນທຶກບໍ່ສຳເລັດ; ກະລຸນາລອງຄືນ", map: { $0.sqlState == "23505" ? SwiftServiceFailure(status: 409, message: conflict, retryable: false) : nil }) { tx in
            let invalid = SwiftServiceFailure(status: 400, message: "ຂໍ້ມູນວັດຖຸດິບບໍ່ຖືກຕ້ອງ", retryable: false)
            guard case .object(let fields) = request.json else { throw invalid }
            let code: String, name: String, unit: String
            do { code = (try Self.string(fields, "code", min: 1, max: 40) ?? nil)!; name = (try Self.string(fields, "name", min: 1, max: 120) ?? nil)!; unit = (try Self.string(fields, "unit", min: 1, max: 30) ?? nil)! }
            catch { throw invalid }
            guard case .string(let category)? = fields["category"], ["ingredient", "packaging"].contains(category) else { throw invalid }
            guard let minimum = fields["minStock"].map(Self.nonnegativeNumber) ?? 0, let cost = fields["avgCostPerUnit"].map(Self.nonnegativeNumber) ?? 0 else { throw invalid }
            guard let minimumValue = V.atScale(minimum, 3), let costValue = V.atScale(cost, V.unitCostScale) else { throw SwiftServiceFailure(status: 400, message: "ຈຳນວນ ຫຼືລາຄາລະອຽດເກີນໄປ", retryable: false) }
            let payload: JSONValue = .object(["code": .string(code), "name": .string(name), "category": .string(category), "unit": .string(unit), "minStock": .number(minimum), "avgCostPerUnit": .number(cost)])
            return try await tx.idempotent(scope: "material_create", payload: payload, conflict: conflict) {
                if try await tx.row("SELECT 1 AS found FROM raw_materials WHERE code=$1", [.string(code)]) != nil { throw SwiftServiceFailure(status: 409, message: conflict, retryable: false) }
                let id = SwiftCommandIDs.next()
                guard let row = try await tx.returning("INSERT INTO raw_materials(id,code,name,category,unit,min_stock_alert,avg_cost_per_unit) VALUES($1,$2,$3,$4::\"RawMaterialCategory\",$5,$6::numeric,$7::numeric) RETURNING \(Self.materialColumns)",
                                                       [.string(id), .string(code), .string(name), .string(category), .string(unit), .number(minimumValue), .number(costValue)]).first else { throw Invalid() }
                try await tx.audit(action: "create", entityType: "raw_material", entityID: id, summary: "ສ້າງວັດຖຸດິບ \(name)")
                return .object(["material": Self.material(row)])
            }
        }
        return .json(201, result)
    }

    func updateMaterial(_ request: SwiftCommandRequest, id: String) async throws -> EngineResponse {
        let conflict = "ລະຫັດ ຫຼືລາຍການນີ້ມີແລ້ວ"
        let result = try await context.transaction(request, roles: ["admin"], failure: "ບັນທຶກບໍ່ສຳເລັດ; ກະລຸນາລອງຄືນ", map: { $0.sqlState == "23505" ? SwiftServiceFailure(status: 409, message: conflict, retryable: false) : nil }) { tx in
            let invalid = SwiftServiceFailure(status: 400, message: "ຂໍ້ມູນວັດຖຸດິບບໍ່ຖືກຕ້ອງ", retryable: false)
            guard case .object(let fields) = request.json else { throw invalid }
            var payload: [String: JSONValue] = [:]
            var code: String?, name: String?, unit: String?, category: String?, cost: Decimal?, minimum: Decimal?, active: Bool?
            do {
                if case .some(let value) = try Self.string(fields, "code", min: 1, max: 40, optional: true) { code = value; payload["code"] = .string(value!) }
                if case .some(let value) = try Self.string(fields, "name", min: 1, max: 120, optional: true) { name = value; payload["name"] = .string(value!) }
                if case .some(let value) = try Self.string(fields, "unit", min: 1, max: 30, optional: true) { unit = value; payload["unit"] = .string(value!) }
            } catch { throw invalid }
            if let raw = fields["category"] { guard case .string(let value) = raw, ["ingredient", "packaging"].contains(value) else { throw invalid }; category = value; payload["category"] = raw }
            if let raw = fields["avgCostPerUnit"] { guard let value = Self.nonnegativeNumber(raw) else { throw invalid }; cost = value; payload["avgCostPerUnit"] = .number(value) }
            if let raw = fields["minStock"] { guard let value = Self.nonnegativeNumber(raw) else { throw invalid }; minimum = value; payload["minStock"] = .number(value) }
            if let raw = fields["isActive"] { guard case .bool(let value) = raw else { throw invalid }; active = value; payload["isActive"] = raw }
            guard !payload.isEmpty else { throw invalid }
            let costValue = cost.map { V.atScale($0, V.unitCostScale) }, minimumValue = minimum.map { V.atScale($0, 3) }
            if costValue == .some(nil) || minimumValue == .some(nil) { throw SwiftServiceFailure(status: 400, message: "ຈຳນວນ ຫຼືລາຄາລະອຽດເກີນໄປ", retryable: false) }
            payload["id"] = .string(id)
            return try await tx.idempotent(scope: "material_update", payload: .object(payload), conflict: conflict) {
                guard let before = try await tx.row("SELECT \(Self.materialColumns) FROM raw_materials WHERE id=$1 FOR UPDATE", [.string(id)]) else {
                    throw SwiftServiceFailure(status: 404, message: "ບໍ່ພົບວັດຖຸດິບ", retryable: false)
                }
                if let unit, unit != before.text("unit") {
                    let used = try await tx.row("""
                    SELECT EXISTS(SELECT 1 FROM purchase_order_items WHERE raw_material_id=$1) OR EXISTS(SELECT 1 FROM recipe_items WHERE raw_material_id=$1) OR EXISTS(SELECT 1 FROM raw_material_adjustments WHERE raw_material_id=$1) AS used
                    """, [.string(id)])?["used"].bool ?? true
                    if before["stock"].decimal != 0 || used { throw SwiftServiceFailure(status: 409, message: "ວັດຖຸດິບນີ້ມີສະຕັອກ ຫຼືປະຫວັດແລ້ວ; ສ້າງວັດຖຸດິບໃໝ່ເມື່ອປ່ຽນໜ່ວຍ", retryable: false) }
                }
                if let code, code != before.text("code"), try await tx.row("SELECT 1 AS found FROM raw_materials WHERE code=$1 AND id<>$2", [.string(code), .string(id)]) != nil {
                    throw SwiftServiceFailure(status: 409, message: conflict, retryable: false)
                }
                guard let after = try await tx.returning("""
                UPDATE raw_materials SET code=$2,name=$3,category=$4::"RawMaterialCategory",unit=$5,avg_cost_per_unit=$6::numeric,min_stock_alert=$7::numeric,is_active=$8::boolean WHERE id=$1 RETURNING \(Self.materialColumns)
                """, [.string(id), .string(code ?? before.text("code")), .string(name ?? before.text("name")), .string(category ?? before.text("category")), .string(unit ?? before.text("unit")),
                      .number((costValue ?? nil) ?? before["cost"].decimal), .number((minimumValue ?? nil) ?? before["minStock"].decimal), .bool(active ?? before["isActive"].bool)]).first else { throw Invalid() }
                try await tx.audit(action: "update", entityType: "raw_material", entityID: id, summary: "ແກ້ໄຂວັດຖຸດິບ \(after.text("name"))",
                                   metadata: .object(["before": Self.material(before), "after": Self.material(after)]))
                return .object(["material": Self.material(after)])
            }
        }
        return .json(200, result)
    }

    // MARK: recipes and write-offs

    func createRecipe(_ request: SwiftCommandRequest) async throws -> EngineResponse {
        let result = try await context.transaction(request, roles: ["admin", "production"], failure: "ບໍ່ສາມາດບັນທຶກສະບັບສູດໄດ້") { tx in
            guard case .object = request.json else { throw SwiftServiceFailure(status: 400, message: "ຂໍ້ມູນສູດບໍ່ຖືກຕ້ອງ", retryable: false) }
            let body = request.json
            let recipeID = V.trimmed(body["recipeId"]), productID = V.trimmed(body["finishedProductId"])
            let sources: [JSONValue] = { if case .array(let rows) = body["items"] { return rows }; return [] }()
            guard !(recipeID.isEmpty && productID.isEmpty), let baseCups = body.object["baseCups"].flatMap(V.positiveInteger), !sources.isEmpty, sources.count <= 200 else {
                throw SwiftServiceFailure(status: 400, message: "ຂໍ້ມູນສູດບໍ່ຖືກຕ້ອງ", retryable: false)
            }
            let items = sources.map { source -> (id: String, quantity: Decimal?) in
                let item: JSONValue = { if case .object = source { return source }; return .object([:]) }()
                return (V.trimmed(item["rawMaterialId"]), V.atScale(item["quantityRequired"], V.recipeScale, positive: true))
            }
            if items.contains(where: { $0.id.isEmpty || $0.quantity == nil }) || Set(items.map(\.id)).count != items.count {
                throw SwiftServiceFailure(status: 400, message: "ວັດຖຸດິບໃນສູດຫ້າມຊ້ຳ ແລະຈຳນວນທຸກລາຍການຕ້ອງຫຼາຍກວ່າ 0", retryable: false)
            }
            let name = V.trimmed(body["name"])
            let payload: JSONValue = .object(["recipeId": .string(recipeID), "finishedProductId": .string(productID), "baseCups": .integer(baseCups), "name": .string(name),
                                              "items": .array(items.map { .object(["rawMaterialId": .string($0.id), "quantityRequired": .string(V.text($0.quantity!))]) })])
            return try await tx.idempotent(scope: "recipes.create", payload: payload, invalidKey: "ກະລຸນາໃສ່ລະຫັດລາຍການທີ່ຖືກຕ້ອງ") {
                let notFound = SwiftServiceFailure(status: 404, message: "ບໍ່ພົບສິນຄ້າ ຫຼືສູດທີ່ເປີດໃຊ້", retryable: false)
                let old = recipeID.isEmpty ? nil : try await tx.row("SELECT finished_product_id AS \"productId\",name FROM recipes WHERE id=$1", [.string(recipeID)])
                if !recipeID.isEmpty && old == nil { throw notFound }
                let product = old.map { $0.text("productId") }.flatMap { $0.isEmpty ? nil : $0 } ?? productID
                guard let row = try await tx.row("SELECT name,is_active AS active FROM finished_products WHERE id=$1", [.string(product)]), row["active"].bool else { throw notFound }
                // A row write makes a concurrent first-recipe creator retry its stale snapshot.
                try await tx.execute("UPDATE finished_products SET id=id WHERE id=$1", [.string(product)])
                let active = try await tx.row("SELECT count(*) AS count FROM raw_materials WHERE id = ANY($1::text[]) AND is_active", [.string(SwiftRefillCommands.textArray(items.map(\.id)))])?["count"].decimal ?? 0
                guard active == Decimal(items.count) else { throw SwiftServiceFailure(status: 409, message: "ບໍ່ພົບວັດຖຸດິບ ຫຼືວັດຖຸດິບຖືກປິດໃຊ້", retryable: false) }
                let version = (try await tx.row("SELECT COALESCE(max(version),0) AS version FROM recipes WHERE finished_product_id=$1", [.string(product)])?["version"].decimal ?? 0) + 1
                try await tx.execute("UPDATE recipes SET is_default=false WHERE finished_product_id=$1", [.string(product)])
                let id = SwiftCommandIDs.next()
                let recipeName = !name.isEmpty ? name : (old.map { $0.text("name") }.flatMap { $0.isEmpty ? nil : $0 } ?? row.text("name"))
                try await tx.execute("INSERT INTO recipes(id,finished_product_id,name,version,base_cups,is_default) VALUES($1,$2,$3,$4::integer,$5::integer,true)",
                                     [.string(id), .string(product), .string(recipeName), .number(version), .integer(baseCups)])
                for item in items {
                    try await tx.execute("INSERT INTO recipe_items(id,recipe_id,raw_material_id,quantity_required) VALUES($1,$2,$3,$4::numeric)",
                                         [.string(SwiftCommandIDs.next()), .string(id), .string(item.id), .number(item.quantity!)])
                }
                try await tx.audit(action: "recipe_version", entityType: "recipe", entityID: id, summary: "ສ້າງສະບັບສູດ \(V.text(version)) · \(recipeName)")
                return .object(["id": .string(id), "version": .number(version)])
            }
        }
        return .json(201, result)
    }

    func adjustFinishedGoods(_ request: SwiftCommandRequest) async throws -> EngineResponse {
        let changed = "ສິນຄ້າບໍ່ພໍ ຫຼືລາຍການປ່ຽນແປງ; ກະລຸນາໂຫຼດຄືນ"
        let result = try await context.transaction(request, roles: ["admin", "production"], failure: "ບັນທຶກບໍ່ສຳເລັດ; ກະລຸນາລອງລາຍການເດີມອີກຄັ້ງ") { tx in
            let body = request.json
            func text(_ key: String) -> String { if case .string(let value) = body[key] { return value.trimmingCharacters(in: .whitespacesAndNewlines) }; return "" }
            let batchID = text("batchId"), reason = text("reason"), note = text("note")
            guard !batchID.isEmpty, let quantity = V.wholeCount(body["quantity"]), quantity > 0, quantity <= 100_000, !reason.isEmpty, reason.utf16.count <= 200, note.utf16.count <= 1000 else {
                throw SwiftServiceFailure(status: 400, message: "ກະລຸນາເລືອກລັອດຜະລິດ, ໃສ່ຈຳນວນເຕັມ ແລະເຫດຜົນ", retryable: false)
            }
            let payload: JSONValue = .object(["batchId": .string(batchID), "quantity": .integer(quantity), "reason": .string(reason), "note": .string(note)])
            return try await tx.idempotent(scope: "finished_goods_adjust", payload: payload, conflict: changed) {
                guard let batch = try await tx.row("SELECT id,batch_number AS number,finished_product_id AS product,quantity_remaining AS remaining,unit_cost AS cost,cost_known AS known,status::text AS status FROM production_batches WHERE id=$1 FOR UPDATE",
                                                   [.string(batchID)]), batch.text("status") == "completed" else { throw SwiftServiceFailure(status: 404, message: "ບໍ່ພົບລັອດຜະລິດ", retryable: false) }
                let remaining = NSDecimalNumber(decimal: batch["remaining"].decimal).intValue
                guard quantity <= remaining else { throw SwiftServiceFailure(status: 409, message: changed, retryable: false) }
                try await tx.execute("UPDATE production_batches SET quantity_remaining=quantity_remaining-$2::integer WHERE id=$1", [.string(batchID), .integer(quantity)])
                let id = SwiftCommandIDs.next()
                try await tx.execute("INSERT INTO finished_goods_adjustments(id,production_batch_id,finished_product_id,quantity,reason,note,created_by,unit_cost,cost_known) VALUES($1,$2,$3,$4::integer,$5,$6,$7,$8::numeric,$9::boolean)",
                                     [.string(id), .string(batchID), batch["product"], .integer(quantity), .string(reason), note.isEmpty ? .null : .string(note), .string(tx.user.userID), batch["cost"], batch["known"]])
                try await tx.audit(action: "waste", entityType: "production_batch", entityID: batchID, summary: "\(reason) · \(quantity) cups · \(batch.text("number"))",
                                   metadata: .object(["quantity": .integer(quantity), "reason": .string(reason), "note": .string(note), "beforeStock": .integer(remaining), "afterStock": .integer(remaining - quantity)]))
                return .object(["id": .string(id)])
            }
        }
        return .json(201, result)
    }
}

extension SwiftCommandValue {
    /// JS `Number(value)` as a Decimal written the way JS prints that double; nil for NaN/Infinity.
    static func jsNumber(_ value: JSONValue) -> Decimal? {
        guard let exact = coercedNumber(value), let double = Double(NSDecimalNumber(decimal: exact).stringValue), double.isFinite,
              let text = try? SwiftValue.canonicalPayload(.number(exact)) else { return nil }
        return Decimal(string: text, locale: Locale(identifier: "en_US_POSIX"))
    }
}
