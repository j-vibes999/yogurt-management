import Foundation

/// stores (create with its fridge), stores/{id} (edit, deactivate) and fridges/{id} (edit, move).
struct SwiftStoreCommands: Sendable {
    let context: SwiftCommandContext
    typealias V = SwiftCommandValue
    private struct Invalid: Error {}

    /// zod `z.string().trim().max(n).optional().nullable()` (or required with `min`).
    private static func text(_ fields: [String: JSONValue], _ key: String, max: Int, min: Int = 0, optional: Bool = true, trim: Bool = true) throws -> String?? {
        guard let value = fields[key] else { if optional { return .none }; throw Invalid() }
        switch value {
        case .null: guard optional else { throw Invalid() }; return .some(nil)
        case .string(let raw):
            let text = trim ? raw.trimmingCharacters(in: .whitespacesAndNewlines) : raw
            guard text.utf16.count >= min, text.utf16.count <= max else { throw Invalid() }
            return .some(text)
        default: throw Invalid()
        }
    }
    /// zod `z.union([z.number(), z.string()]).optional().nullable()`: the raw value.
    private static func numberOrString(_ fields: [String: JSONValue], _ key: String) throws -> JSONValue? {
        guard let value = fields[key] else { return nil }
        switch value { case .null, .number, .string: return value; default: throw Invalid() }
    }
    private static func nonEmpty(_ value: String??) -> JSONValue { (value ?? nil).flatMap { $0.isEmpty ? nil : JSONValue.string($0) } ?? .null }
    /// Coordinates are stored from JS numbers; nil means absent/blank, `.some(nil)` means invalid.
    private static func coordinate(_ value: JSONValue?, limit: Decimal) -> Decimal?? {
        guard let value, value != .null else { return .none }
        if case .string(let text) = value, text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return .none }
        guard let number = V.jsNumber(value), abs(number) <= limit else { return .some(nil) }
        return .some(number)
    }
    /// money.ts parseCommissionRate: up to four places, at most 1, as `d.dddd`.
    static func commissionRate(_ value: JSONValue) -> String? {
        let text: String
        switch value { case .string(let raw): text = raw.trimmingCharacters(in: .whitespacesAndNewlines); case .number(let number): text = (try? SwiftValue.canonicalPayload(.number(number))) ?? ""; default: return nil }
        guard text.range(of: "^[0-9]+(?:\\.[0-9]{1,4})?$", options: .regularExpression) != nil, let rate = Decimal(string: text, locale: Locale(identifier: "en_US_POSIX")), rate <= 1 else { return nil }
        return try? SwiftValue.decimalString(rate, scale: 4)
    }

    func create(_ request: SwiftCommandRequest) async throws -> EngineResponse {
        let duplicate = "Fridge asset code or serial number is already in use"
        let result = try await context.transaction(request, roles: ["admin"], failure: "Unable to create store", failureStatus: 500,
                                                   map: { $0.sqlState == "23505" ? SwiftServiceFailure(status: 409, message: duplicate, retryable: false) : nil }) { tx in
            let invalid = SwiftServiceFailure(status: 400, message: "ຂໍ້ມູນຮ້ານບໍ່ຖືກຕ້ອງ", retryable: false)
            guard case .object(let fields) = request.json else { throw invalid }
            var payload: [String: JSONValue] = [:]
            var texts: [String: String??] = [:]
            let numbers: [String: JSONValue?]
            do {
                for (key, max, min) in [("name", 160, 1), ("assetCode", 80, 1)] {
                    let value = try Self.text(fields, key, max: max, min: min, optional: false); texts[key] = value; payload[key] = .string(value!!)
                }
                for (key, max) in [("contactName", 160), ("phone", 80), ("whatsapp", 80), ("facebook", 240), ("address", 500), ("fridgeModel", 160), ("serialNo", 160)] {
                    let value = try Self.text(fields, key, max: max); texts[key] = value
                    if case .some(let item) = value { payload[key] = item.map(JSONValue.string) ?? .null }
                }
                let start = try Self.text(fields, "fridgeStartDate", max: .max, trim: false); texts["fridgeStartDate"] = start
                if case .some(let item) = start { payload["fridgeStartDate"] = item.map(JSONValue.string) ?? .null }
                var raw: [String: JSONValue?] = [:]
                for key in ["latitude", "longitude", "monthlyElectricity", "commissionRate", "capacityCups"] { let value = try Self.numberOrString(fields, key); raw[key] = value; if let value { payload[key] = value } }
                numbers = raw
            } catch { throw invalid }
            let latitude = Self.coordinate(numbers["latitude"] ?? nil, limit: 90), longitude = Self.coordinate(numbers["longitude"] ?? nil, limit: 180)
            if latitude == .some(nil) || longitude == .some(nil) { throw SwiftServiceFailure(status: 400, message: "ຄ່າເສັ້ນຂະໜານ ຫຼືເສັ້ນແວງບໍ່ຖືກຕ້ອງ", retryable: false) }
            let startText = (texts["fridgeStartDate"] ?? nil) ?? nil
            let startDay: String
            if let startText, !startText.isEmpty { guard let day = SwiftDates.dateOnly(startText) else { throw SwiftServiceFailure(status: 400, message: "ວັນທີເລີ່ມໃຊ້ຕູ້ແຊ່ບໍ່ຖືກຕ້ອງ", retryable: false) }; startDay = day }
            else { startDay = businessDateString(Date()) }
            func valueOrDefault(_ key: String, _ fallback: JSONValue) -> JSONValue { let value = numbers[key] ?? nil; return value == nil || value == .null ? fallback : value! }
            let monthly = V.money(valueOrDefault("monthlyElectricity", .integer(200_000))), capacity = V.wholeCount(valueOrDefault("capacityCups", .integer(100)))
            let rate = Self.commissionRate(valueOrDefault("commissionRate", .string("0.30")))
            guard let monthly, let capacity, (1...10_000).contains(capacity), let rate else {
                throw SwiftServiceFailure(status: 400, message: "ຄ່າໄຟຕ້ອງມີບໍ່ເກີນ 2 ຕຳແໜ່ງ, ອັດຕາສ່ວນແບ່ງມີບໍ່ເກີນ 4 ຕຳແໜ່ງ ແລະຄວາມຈຸຕູ້ຕ້ອງເປັນຈຳນວນເຕັມ", retryable: false)
            }
            let monthlyText = V.moneyString(monthly)
            payload["monthlyElectricity"] = .string(monthlyText); payload["capacityCups"] = .integer(capacity); payload["commissionRate"] = .string(rate)
            return try await tx.idempotent(scope: "store.create", payload: .object(payload), invalidKey: "Invalid store request key", missingKey: "Store request key is required",
                                           conflict: "This request key was used for a different store") {
                let assetCode = (texts["assetCode"]!)!!, serial = Self.nonEmpty(texts["serialNo"] ?? .none)
                if try await tx.row("SELECT 1 AS found FROM fridges WHERE asset_code=$1 OR ($2::text IS NOT NULL AND serial_no=$2)", [.string(assetCode), serial]) != nil {
                    throw SwiftServiceFailure(status: 409, message: duplicate, retryable: false)
                }
                let name = (texts["name"]!)!!
                let phone = Self.nonEmpty(texts["phone"] ?? .none), whatsappText = Self.nonEmpty(texts["whatsapp"] ?? .none)
                let storeID = SwiftCommandIDs.next(), fridgeID = SwiftCommandIDs.next()
                let model: JSONValue = { if case .some(.some(let text)) = texts["fridgeModel"] ?? .none, !text.isEmpty { return .string(text) }; return .string("Yogurt Display 100") }()
                try await tx.execute("""
                INSERT INTO stores(id,name,contact_name,phone,whatsapp,facebook,address,latitude,longitude,fridge_start_date,commission_rate,monthly_electricity,is_active)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8::numeric,$9::numeric,$10::timestamp,$11::numeric,$12::numeric,true)
                """, [.string(storeID), .string(name), Self.nonEmpty(texts["contactName"] ?? .none), phone, whatsappText == .null ? phone : whatsappText,
                      Self.nonEmpty(texts["facebook"] ?? .none), Self.nonEmpty(texts["address"] ?? .none), (latitude ?? nil).map(JSONValue.number) ?? .null,
                      (longitude ?? nil).map(JSONValue.number) ?? .null, .string(startDay + "T12:00:00.000"), .string(rate), .string(monthlyText)])
                try await tx.execute("INSERT INTO fridges(id,asset_code,model,serial_no,capacity_cups,current_store_id,status) VALUES($1,$2,$3,$4,$5::integer,$6,'active')",
                                     [.string(fridgeID), .string(assetCode), model, serial, .integer(capacity), .string(storeID)])
                for product in try await tx.rows("SELECT id FROM finished_products WHERE is_active ORDER BY id") {
                    try await tx.execute("INSERT INTO fridge_inventory(id,store_id,fridge_id,finished_product_id,current_stock) VALUES($1,$2,$3,$4,0)",
                                         [.string(SwiftCommandIDs.next()), .string(storeID), .string(fridgeID), product["id"]])
                }
                try await tx.audit(action: "create", entityType: "store", entityID: storeID, storeID: storeID, summary: "ເພີ່ມຮ້ານ \(name)",
                                   metadata: .object(["after": .object(["name": .string(name), "commissionRate": .string(rate), "monthlyElectricity": .string(monthlyText),
                                                                        "fridgeStartDate": .string(startDay + "T12:00:00.000Z"), "fridge": .string(assetCode), "capacityCups": .integer(capacity)])]))
                return .object(["id": .string(storeID), "name": .string(name), "fridge": .string(assetCode)])
            }
        }
        return .json(201, result)
    }

    /// ensureStoreCanDeactivate: nothing pending, owed or left in its fridge.
    private func ensureCanDeactivate(_ tx: SwiftCommandTransaction, id: String) async throws -> JSONValue {
        guard let store = try await tx.row("""
        SELECT s.id,s.name,s.commission_rate AS rate,s.monthly_electricity AS monthly,s.is_active AS active,
        EXISTS(SELECT 1 FROM refill_requests r WHERE r.store_id=s.id AND r.status NOT IN ('completed','cancelled')) AS pending,
        COALESCE((SELECT closing_balance FROM settlements WHERE store_id=s.id ORDER BY settlement_date DESC,id DESC LIMIT 1),0) AS balance,
        COALESCE((SELECT sum(i.current_stock) FROM fridges f JOIN fridge_inventory i ON i.fridge_id=f.id WHERE f.current_store_id=s.id),0) AS cups
        FROM stores s WHERE s.id=$1 FOR UPDATE OF s
        """, [.string(id)]) else { throw SwiftServiceFailure(status: 404, message: "ບໍ່ພົບຮ້ານ", retryable: false) }
        if store["pending"].bool { throw SwiftServiceFailure(status: 409, message: "ກະລຸນາສົ່ງໃຫ້ສຳເລັດ ຫຼືຍົກເລີກຄຳຂໍເຕີມສິນຄ້າທີ່ຍັງຄ້າງກ່ອນປິດຮ້ານ", retryable: false) }
        if store["balance"].decimal > 0 { throw SwiftServiceFailure(status: 409, message: "ຮ້ານຍັງມີຍອດຄ້າງ. ກະລຸນາຮັບເງິນກ່ອນປິດຮ້ານ", retryable: false) }
        let cups = store["cups"].decimal
        if cups > 0 {
            throw SwiftServiceFailure(status: 409, message: "ຕູ້ຂອງຮ້ານນີ້ຍັງມີສິນຄ້າ \(SwiftReadDashboard.localeString(cups)) ຖ້ວຍ. ກ່ອນປິດຮ້ານ ກະລຸນາກວດຮ້ານຮອບສຸດທ້າຍ ແລະບັນທຶກສິນຄ້າທີ່ເອົາອອກຈາກຕູ້ໃນຊ່ອງ “ເສຍ / ໝົດອາຍຸ” ຈົນຈຳນວນຄົງເຫຼືອເປັນ 0",
                                      retryable: false, details: ["code": .string("STORE_HAS_STOCK")])
        }
        return store
    }

    func update(_ request: SwiftCommandRequest, id: String) async throws -> EngineResponse {
        let result = try await context.transaction(request, roles: ["admin"], failure: "ບໍ່ສາມາດແກ້ໄຂຮ້ານໄດ້", failureStatus: 500) { tx -> JSONValue in
            let invalid = SwiftServiceFailure(status: 400, message: "ຂໍ້ມູນຮ້ານບໍ່ຖືກຕ້ອງ · ຄ່າໄຟມີບໍ່ເກີນ 2 ຕຳແໜ່ງ ແລະອັດຕາສ່ວນແບ່ງມີບໍ່ເກີນ 4 ຕຳແໜ່ງ", retryable: false)
            guard case .object(let fields) = request.json else { throw invalid }
            var texts: [String: String??] = [:]
            var latitudeRaw: JSONValue?, longitudeRaw: JSONValue?, active: Bool?
            do {
                texts["name"] = try Self.text(fields, "name", max: 160, min: 1, optional: false)
                for (key, max) in [("contactName", 160), ("phone", 80), ("whatsapp", 80), ("facebook", 240), ("address", 500)] { texts[key] = try Self.text(fields, key, max: max) }
                texts["fridgeStartDate"] = try Self.text(fields, "fridgeStartDate", max: .max, trim: false)
                latitudeRaw = try Self.numberOrString(fields, "latitude"); longitudeRaw = try Self.numberOrString(fields, "longitude")
            } catch { throw invalid }
            var monthly: String?, rate: String?
            if let raw = fields["monthlyElectricity"] { guard let value = V.money(raw) else { throw invalid }; monthly = V.moneyString(value) }
            if let raw = fields["commissionRate"] { guard let value = Self.commissionRate(raw) else { throw invalid }; rate = value }
            if let raw = fields["isActive"] { guard case .bool(let value) = raw else { throw invalid }; active = value }
            let latitude = Self.coordinate(latitudeRaw, limit: 90), longitude = Self.coordinate(longitudeRaw, limit: 180)
            if latitude == .some(nil) || longitude == .some(nil) { throw SwiftServiceFailure(status: 400, message: "ຄ່າເສັ້ນຂະໜານ ຫຼືເສັ້ນແວງບໍ່ຖືກຕ້ອງ", retryable: false) }
            if let day = (texts["fridgeStartDate"] ?? nil) ?? nil, !day.isEmpty, SwiftDates.dateOnly(day) == nil { throw SwiftServiceFailure(status: 400, message: "ວັນທີເລີ່ມໃຊ້ຕູ້ແຊ່ບໍ່ຖືກຕ້ອງ", retryable: false) }

            let before: JSONValue
            if active == false { before = try await ensureCanDeactivate(tx, id: id) }
            else {
                guard let row = try await tx.row("SELECT id,name,commission_rate AS rate,monthly_electricity AS monthly,is_active AS active FROM stores WHERE id=$1 FOR UPDATE", [.string(id)]) else {
                    throw SwiftServiceFailure(status: 404, message: "ບໍ່ພົບຮ້ານ", retryable: false)
                }
                before = row
            }
            var sets = ["name=$2"], values: [JSONValue] = [.string(id), .string((texts["name"]!)!!)]
            func set(_ column: String, _ value: JSONValue, cast: String = "") { values.append(value); sets.append("\(column)=$\(values.count)\(cast)") }
            for (key, column) in [("contactName", "contact_name"), ("phone", "phone"), ("facebook", "facebook"), ("address", "address")] {
                if case .some = texts[key] ?? .none { set(column, Self.nonEmpty(texts[key]!)) }
            }
            if case .some = texts["whatsapp"] ?? .none { let whatsapp = Self.nonEmpty(texts["whatsapp"]!); set("whatsapp", whatsapp == .null ? Self.nonEmpty(texts["phone"] ?? .none) : whatsapp) }
            if fields["latitude"] != nil { set("latitude", (latitude ?? nil).map(JSONValue.number) ?? .null, cast: "::numeric") }
            if fields["longitude"] != nil { set("longitude", (longitude ?? nil).map(JSONValue.number) ?? .null, cast: "::numeric") }
            if case .some(let start) = texts["fridgeStartDate"] ?? .none { set("fridge_start_date", start.flatMap { $0.isEmpty ? nil : SwiftDates.dateOnly($0) }.map { .string($0 + "T12:00:00.000") } ?? .null, cast: "::timestamp") }
            if let rate { set("commission_rate", .string(rate), cast: "::numeric") }
            if let monthly { set("monthly_electricity", .string(monthly), cast: "::numeric") }
            if let active { set("is_active", .bool(active), cast: "::boolean") }
            guard let after = try await tx.returning("UPDATE stores SET \(sets.joined(separator: ",")) WHERE id=$1 RETURNING id,name,commission_rate AS rate,monthly_electricity AS monthly,is_active AS active", values).first else {
                throw SwiftServiceFailure(status: 404, message: "ບໍ່ພົບຮ້ານ", retryable: false)
            }
            func auditFields(_ row: JSONValue) -> JSONValue { .object(["name": row["name"], "commissionRate": .string(V.text(row["rate"].decimal)), "monthlyElectricity": .string(V.text(row["monthly"].decimal)), "isActive": row["active"]]) }
            try await tx.audit(action: "update", entityType: "store", entityID: id, storeID: id, summary: "ແກ້ໄຂຮ້ານ \(after.text("name"))", metadata: .object(["before": auditFields(before), "after": auditFields(after)]))
            return .object(["id": after["id"], "name": after["name"], "isActive": after["active"]])
        }
        return .json(200, result)
    }

    func deactivate(_ request: SwiftCommandRequest, id: String) async throws -> EngineResponse {
        _ = try await context.transaction(request, roles: ["admin"], failure: "ບໍ່ສາມາດປິດໃຊ້ຮ້ານໄດ້", failureStatus: 500) { tx -> Bool in
            let store = try await ensureCanDeactivate(tx, id: id)
            try await tx.execute("UPDATE stores SET is_active=false WHERE id=$1", [.string(id)])
            try await tx.audit(action: "deactivate", entityType: "store", entityID: id, storeID: id, summary: "ປິດຮ້ານ \(store.text("name"))")
            return true
        }
        return .json(200, .object(["id": .string(id), "isActive": .bool(false)]))
    }

    func updateFridge(_ request: SwiftCommandRequest, id: String) async throws -> EngineResponse {
        let result = try await context.transaction(request, roles: ["admin"], failure: "ບໍ່ສາມາດບັນທຶກຕູ້ແຊ່ໄດ້", failureStatus: 409, failureRetryable: nil,
                                                   map: { $0.sqlState == "23505" ? SwiftServiceFailure(status: 409, message: "Asset Code ນີ້ຖືກໃຊ້ກັບຕູ້ອື່ນແລ້ວ") : nil }) { tx -> JSONValue in
            guard case .object(let fields) = request.json else { throw SwiftServiceFailure(status: 409, message: "ບໍ່ສາມາດບັນທຶກຕູ້ແຊ່ໄດ້") }
            let body = JSONValue.object(fields)
            let assetCode = fields["assetCode"].map { V.trimmed($0) }, serial = fields["serialNo"].map { V.trimmed($0) }, model = fields["model"].map { V.trimmed($0) }
            if let assetCode, assetCode.isEmpty { throw SwiftServiceFailure(status: 400, message: "ລະຫັດຕູ້ຫ້າມວ່າງ") }
            let status = fields["status"].map { V.jsString($0) }
            if let status, !["active", "maintenance"].contains(status) { throw SwiftServiceFailure(status: 400, message: "ສະຖານະຕູ້ແຊ່ບໍ່ຖືກຕ້ອງ") }
            var capacity: Int?
            if let raw = fields["capacityCups"] {
                guard let number = V.jsNumber(raw), let integral = try? SwiftValue.rounded(number, scale: 0), integral == number, number > 0, number <= 2_147_483_647 else {
                    throw SwiftServiceFailure(status: 400, message: "ຄວາມຈຸຕ້ອງເປັນຈຳນວນເຕັມຫຼາຍກວ່າ 0")
                }
                capacity = NSDecimalNumber(decimal: number).intValue
            }
            guard let fridge = try await tx.row("""
            SELECT f.id,f.asset_code AS "assetCode",f.status::text AS status,f.capacity_cups AS capacity,f.current_store_id AS "storeId",
            COALESCE((SELECT sum(current_stock) FROM fridge_inventory WHERE fridge_id=f.id),0) AS stock,
            COALESCE((SELECT json_agg(finished_product_id) FROM fridge_inventory WHERE fridge_id=f.id),'[]'::json) AS products
            FROM fridges f WHERE f.id=$1 FOR UPDATE OF f
            """, [.string(id)]) else { throw SwiftServiceFailure(status: 404, message: "ບໍ່ພົບຕູ້ແຊ່ນີ້") }
            let stock = fridge["stock"].decimal
            if let capacity, Decimal(capacity) < stock { throw SwiftServiceFailure(status: 409, message: "ຄວາມຈຸໃໝ່ຕ່ຳກວ່າຈຳນວນສິນຄ້າໃນຕູ້") }
            let hasStock = SwiftServiceFailure(status: 409, message: "ຕູ້ຍັງມີ Stock. ກະລຸນາເຄລຍ Stock ໃຫ້ເຫຼືອ 0 ກ່ອນຍ້າຍຮ້ານ ຫຼືເຂົ້າບຳລຸງ")
            var storeID: JSONValue = fridge["storeId"]
            if fields["currentStoreId"] != nil {
                let raw = V.trimmed(body["currentStoreId"])
                let requested: JSONValue = raw.isEmpty ? .null : .string(raw)
                if requested != fridge["storeId"] && stock > 0 { throw hasStock }
                if requested != fridge["storeId"], fridge["storeId"] != .null,
                   let balance = try await tx.row("SELECT closing_balance AS balance FROM settlements WHERE store_id=$1 ORDER BY settlement_date DESC,id DESC LIMIT 1", [fridge["storeId"]])?["balance"].decimal, balance > 0 {
                    throw SwiftServiceFailure(status: 409, message: "ຮ້ານທີ່ຕູ້ນີ້ຕິດຕັ້ງຢູ່ຍັງມີຍອດຄ້າງ \(SwiftReadDashboard.localeString(balance)) LAK. ກະລຸນາຮັບເງິນໃຫ້ຄົບກ່ອນຖອດ ຫຼືຍ້າຍຕູ້",
                                              retryable: false, details: ["code": .string("STORE_HAS_BALANCE")])
                }
                if requested != .null {
                    guard let target = try await tx.row("SELECT s.is_active AS active,f.id AS fridge FROM stores s LEFT JOIN fridges f ON f.current_store_id=s.id WHERE s.id=$1", [requested]), target["active"].bool else {
                        throw SwiftServiceFailure(status: 404, message: "ບໍ່ພົບຮ້ານປາຍທາງ ຫຼືຮ້ານຖືກປິດໃຊ້")
                    }
                    if target["fridge"] != .null && target["fridge"] != .string(id) { throw SwiftServiceFailure(status: 409, message: "ຮ້ານປາຍທາງມີຕູ້ແຊ່ອື່ນຢູ່ແລ້ວ") }
                }
                storeID = requested
            }
            if status == "maintenance" && fridge.text("status") != "maintenance" && stock > 0 { throw hasStock }
            if let serial, !serial.isEmpty, try await tx.row("SELECT 1 AS found FROM fridges WHERE serial_no=$1 AND id<>$2", [.string(serial), .string(id)]) != nil {
                throw SwiftServiceFailure(status: 409, message: "Serial ນີ້ຖືກໃຊ້ກັບຕູ້ອື່ນແລ້ວ")
            }
            if let assetCode, try await tx.row("SELECT 1 AS found FROM fridges WHERE asset_code=$1 AND id<>$2", [.string(assetCode), .string(id)]) != nil {
                throw SwiftServiceFailure(status: 409, message: "Asset Code ນີ້ຖືກໃຊ້ກັບຕູ້ອື່ນແລ້ວ")
            }
            var sets = ["current_store_id=$2"], values: [JSONValue] = [.string(id), storeID]
            func set(_ column: String, _ value: JSONValue, cast: String = "") { values.append(value); sets.append("\(column)=$\(values.count)\(cast)") }
            if let assetCode { set("asset_code", .string(assetCode)) }
            if let model { set("model", model.isEmpty ? .null : .string(model)) }
            if let serial { set("serial_no", serial.isEmpty ? .null : .string(serial)) }
            if let capacity { set("capacity_cups", .integer(capacity), cast: "::integer") }
            if let status { set("status", .string(status), cast: "::\"FridgeStatus\"") }
            guard let updated = try await tx.returning("UPDATE fridges SET \(sets.joined(separator: ",")) WHERE id=$1 RETURNING id,asset_code AS \"assetCode\",status::text AS status,capacity_cups AS capacity,current_store_id AS \"storeId\"", values).first else {
                throw SwiftServiceFailure(status: 404, message: "ບໍ່ພົບຕູ້ແຊ່ນີ້")
            }
            if storeID != .null && storeID != fridge["storeId"] {
                // The fridge arrives empty, so deliveries to the new store count from now on.
                let movedAt = JSONValue.string(SwiftServiceJSON.iso(Date()))
                try await tx.execute("UPDATE fridge_inventory SET store_id=$2,last_audit_date=$3::timestamp WHERE fridge_id=$1", [.string(id), storeID, movedAt])
                // A moved fridge needs a (zero) row for every active product so the next audit can count it.
                let existing = Set(fridge["products"].array.map(\.text))
                for product in try await tx.rows("SELECT id FROM finished_products WHERE is_active ORDER BY id") where !existing.contains(product.id) {
                    try await tx.execute("INSERT INTO fridge_inventory(id,store_id,fridge_id,finished_product_id,current_stock,last_audit_date) VALUES($1,$2,$3,$4,0,$5::timestamp)",
                                         [.string(SwiftCommandIDs.next()), storeID, .string(id), product["id"], movedAt])
                }
            }
            func snapshot(_ row: JSONValue) -> JSONValue { .object(["assetCode": row["assetCode"], "status": row["status"], "capacityCups": row["capacity"], "currentStoreId": row["storeId"]]) }
            try await tx.audit(action: "update", entityType: "fridge", entityID: id, storeID: updated["storeId"] == .null ? nil : updated.text("storeId"), summary: "ແກ້ໄຂຕູ້ \(updated.text("assetCode"))",
                               metadata: .object(["before": snapshot(fridge), "after": snapshot(updated)]))
            return .object(["id": updated["id"], "assetCode": updated["assetCode"], "storeId": updated["storeId"], "status": updated["status"]])
        }
        return .json(200, result)
    }
}
