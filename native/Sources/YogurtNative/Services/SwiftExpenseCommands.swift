import Foundation

/// expenses, expenses/{id} (edit with the original snapshot, void), expense-categories and daily-closing.
struct SwiftExpenseCommands: Sendable {
    let context: SwiftCommandContext
    typealias V = SwiftCommandValue
    private static let admin: Set<String> = ["admin"]

    /// zod `z.string().trim().max(n)` with optional/nullable handling. `.some(nil)` is an explicit null.
    private struct Invalid: Error {}
    private static func text(_ fields: [String: JSONValue], _ key: String, max: Int, trim: Bool = true, nullable: Bool = true, minimum: Int = 0) throws -> String?? {
        guard let value = fields[key] else { return .none }
        switch value {
        case .null: guard nullable else { throw Invalid() }; return .some(nil)
        case .string(let raw):
            let text = trim ? raw.trimmingCharacters(in: .whitespacesAndNewlines) : raw
            guard text.utf16.count >= minimum, text.utf16.count <= max else { throw Invalid() }
            return .some(text)
        default: throw Invalid()
        }
    }
    private static func json(_ value: String??) -> JSONValue? {
        switch value { case .none: return nil; case .some(.none): return .null; case .some(.some(let text)): return .string(text) }
    }
    private static func failure(_ code: String, _ messages: [String: String], codeField: Bool = false) -> SwiftServiceFailure {
        let status = ["EXPENSE_NOT_FOUND", "STORE_NOT_FOUND"].contains(code) ? 404 : ["STORE_INACTIVE", "EXPENSE_VOIDED", "STALE_EXPENSE", "IDEMPOTENCY_CONFLICT", "STALE_CLOSING"].contains(code) ? 409 : 400
        return SwiftServiceFailure(status: status, message: messages[code]!, retryable: false, details: codeField ? ["code": .string(code)] : [:])
    }
    private static let createMessages = ["STORE_NOT_FOUND": "ບໍ່ພົບຮ້ານ", "STORE_INACTIVE": "ຮ້ານນີ້ປິດໃຊ້ງານແລ້ວ"]
    private static let editMessages = ["EXPENSE_NOT_FOUND": "ບໍ່ພົບລາຍຈ່າຍ", "STORE_NOT_FOUND": "ບໍ່ພົບຮ້ານ", "STORE_INACTIVE": "ຮ້ານນີ້ປິດໃຊ້ງານແລ້ວ", "EXPENSE_VOIDED": "ລາຍຈ່າຍນີ້ຖືກຍົກເລີກແລ້ວ",
                                       "STALE_EXPENSE": "Expense changed after the edit form was opened. Reload before saving."]
    private static func categoryLabel(_ category: String) -> String { category == "other" ? "ອື່ນໆ" : category }

    func create(_ request: SwiftCommandRequest) async throws -> EngineResponse {
        let result = try await context.transaction(request, roles: Self.admin, failure: "ບໍ່ສາມາດບັນທຶກລາຍຈ່າຍໄດ້", failureStatus: 500) { tx in
            let invalid = SwiftServiceFailure(status: 400, message: "ຂໍ້ມູນລາຍຈ່າຍບໍ່ຖືກຕ້ອງ · ຈຳນວນເງິນຕ້ອງມີບໍ່ເກີນ 2 ຕຳແໜ່ງ", retryable: false)
            guard case .object(let fields) = request.json else { throw invalid }
            let category: String, storeID: String??, incurredAt: String??, note: String??, receipt: String??
            do {
                let parsedCategory = try Self.text(fields, "category", max: 80, nullable: false, minimum: 1)
                category = parsedCategory.map { $0 ?? "other" } ?? "other"
                storeID = try Self.text(fields, "storeId", max: 100); incurredAt = try Self.text(fields, "incurredAt", max: .max, trim: false)
                note = try Self.text(fields, "note", max: 1000); receipt = try Self.text(fields, "receiptUrl", max: 500)
            } catch { throw invalid }
            guard let raw = fields["amount"], let amount = V.money(raw), amount > 0 else { throw invalid }
            let day = (incurredAt ?? nil) ?? ""
            if !day.isEmpty && SwiftDates.dateOnly(day) == nil { throw SwiftServiceFailure(status: 400, message: "ວັນທີລາຍຈ່າຍບໍ່ຖືກຕ້ອງ", retryable: false) }
            var payload: [String: JSONValue] = ["category": .string(category), "amount": .string(V.moneyString(amount))]
            for (key, value) in [("storeId", storeID), ("incurredAt", incurredAt), ("note", note), ("receiptUrl", receipt)] { if let json = Self.json(value) { payload[key] = json } }
            return try await tx.idempotent(scope: "expense.create", payload: .object(payload), invalidKey: "Invalid expense request key", missingKey: "Expense request key is required",
                                           conflict: "This request key was used for a different expense") {
                let store = (storeID ?? nil).flatMap { $0.isEmpty ? nil : $0 }
                if let store {
                    guard let row = try await tx.row("SELECT is_active AS active FROM stores WHERE id=$1", [.string(store)]) else { throw Self.failure("STORE_NOT_FOUND", Self.createMessages) }
                    guard row["active"].bool else { throw Self.failure("STORE_INACTIVE", Self.createMessages) }
                }
                let date = day.isEmpty ? businessDateString(Date()) : SwiftDates.dateOnly(day)!
                let noteValue = (note ?? nil).flatMap { $0.isEmpty ? nil : $0 }, receiptValue = (receipt ?? nil).flatMap { $0.isEmpty ? nil : $0 }
                let id = SwiftCommandIDs.next(), amountText = V.moneyString(amount)
                try await tx.execute("INSERT INTO expenses(id,store_id,category,amount,incurred_at,note,receipt_url) VALUES($1,$2,$3,$4::numeric,$5::timestamp,$6,$7)",
                                     [.string(id), store.map(JSONValue.string) ?? .null, .string(category), .string(amountText), .string(date + "T12:00:00.000"),
                                      noteValue.map(JSONValue.string) ?? .null, receiptValue.map(JSONValue.string) ?? .null])
                try await tx.audit(action: "create", entityType: "expense", entityID: id, storeID: store, summary: "ບັນທຶກລາຍຈ່າຍ \(Self.categoryLabel(category)) · \(SwiftReadDashboard.localeString(amount)) LAK",
                                   metadata: .object(["after": .object(["category": .string(category), "amount": .string(amountText), "incurredAt": .string(date + "T12:00:00.000Z"),
                                                                        "storeId": store.map(JSONValue.string) ?? .null, "note": noteValue.map(JSONValue.string) ?? .null, "receiptUrl": receiptValue.map(JSONValue.string) ?? .null])]))
                return .object(["id": .string(id)])
            }
        }
        return .json(201, result)
    }

    func update(_ request: SwiftCommandRequest, id: String) async throws -> EngineResponse {
        let result = try await context.transaction(request, roles: Self.admin, failure: "ບໍ່ສາມາດບັນທຶກລາຍຈ່າຍໄດ້", failureStatus: 500) { tx in
            let invalid = SwiftServiceFailure(status: 400, message: "ຂໍ້ມູນລາຍຈ່າຍບໍ່ຖືກຕ້ອງ · ຈຳນວນເງິນຕ້ອງມີບໍ່ເກີນ 2 ຕຳແໜ່ງ", retryable: false)
            guard case .object(let fields) = request.json else { throw invalid }
            var payload: [String: JSONValue] = [:]
            let category: String??, incurredAt: String??, storeField: String??, note: String??, receipt: String??
            do {
                category = try Self.text(fields, "category", max: 80, nullable: false, minimum: 1)
                incurredAt = try Self.text(fields, "incurredAt", max: .max, trim: false, nullable: false)
                storeField = try Self.text(fields, "storeId", max: 100); note = try Self.text(fields, "note", max: 1000); receipt = try Self.text(fields, "receiptUrl", max: 500)
            } catch { throw invalid }
            if let day = incurredAt ?? nil, SwiftDates.dateOnly(day) == nil { throw invalid }
            var amount: Decimal?
            if let raw = fields["amount"] { guard let value = V.money(raw), value > 0 else { throw invalid }; amount = value; payload["amount"] = .string(V.moneyString(value)) }
            var snapshot: JSONValue?
            if let raw = fields["expectedExpenseSnapshot"] {
                guard case .object(let s) = raw, case .string = s["category"], case .string = s["incurredAt"] else { throw invalid }
                switch s["amount"] { case .string?, .number?: break; default: throw invalid }
                for key in ["storeId", "note", "receiptUrl"] { switch s[key] { case .string?, .null?: break; default: throw invalid } }
                snapshot = .object(["category": s["category"]!, "amount": s["amount"]!, "incurredAt": s["incurredAt"]!, "storeId": s["storeId"]!, "note": s["note"]!, "receiptUrl": s["receiptUrl"]!])
                payload["expectedExpenseSnapshot"] = snapshot
            }
            for (key, value) in [("category", category), ("incurredAt", incurredAt), ("storeId", storeField), ("note", note), ("receiptUrl", receipt)] { if let json = Self.json(value) { payload[key] = json } }
            return try await tx.idempotent(scope: "expense.update:\(id)", payload: .object(payload), invalidKey: "Invalid expense request key", missingKey: "Expense request key is required",
                                           conflict: "This request key was used for a different expense operation") {
                guard let before = try await tx.row("SELECT id,category,amount,incurred_at AS \"incurredAt\",store_id AS \"storeId\",note,receipt_url AS \"receiptUrl\",voided_at AS \"voidedAt\" FROM expenses WHERE id=$1 FOR UPDATE", [.string(id)]) else {
                    throw Self.failure("EXPENSE_NOT_FOUND", Self.editMessages)
                }
                guard before["voidedAt"] == .null else { throw Self.failure("EXPENSE_VOIDED", Self.editMessages) }
                let beforeDay = businessDateString(try SwiftServiceJSON.date(before["incurredAt"]))
                if let snapshot, snapshot["category"] != before["category"] || V.money(snapshot["amount"]) != V.money(.string(V.text(before["amount"].decimal)))
                    || snapshot["incurredAt"] != .string(beforeDay) || snapshot["storeId"] != before["storeId"] || snapshot["note"] != before["note"] || snapshot["receiptUrl"] != before["receiptUrl"] {
                    throw Self.failure("STALE_EXPENSE", Self.editMessages)
                }
                let store: String?? = storeField.map { $0.flatMap { $0.isEmpty ? nil : $0 } }
                if case .some(.some(let target)) = store, .string(target) != before["storeId"] {
                    guard let row = try await tx.row("SELECT is_active AS active FROM stores WHERE id=$1", [.string(target)]) else { throw Self.failure("STORE_NOT_FOUND", Self.editMessages) }
                    guard row["active"].bool else { throw Self.failure("STORE_INACTIVE", Self.editMessages) }
                }
                let afterCategory = (category ?? nil) ?? before.text("category")
                let afterAmount = amount ?? before["amount"].decimal
                let unchangedDate = SwiftServiceJSON.iso(try SwiftServiceJSON.date(before["incurredAt"])).replacingOccurrences(of: "Z", with: "")
                let afterDate = (incurredAt ?? nil).map { SwiftDates.dateOnly($0)! + "T12:00:00.000" } ?? unchangedDate
                func optional(_ value: String??, _ current: JSONValue) -> JSONValue { switch value { case .none: return current; case .some(let text): return text.flatMap { $0.isEmpty ? nil : JSONValue.string($0) } ?? .null } }
                let afterNote = optional(note, before["note"]), afterReceipt = optional(receipt, before["receiptUrl"])
                let afterStore: JSONValue = store.map { $0.map(JSONValue.string) ?? .null } ?? before["storeId"]
                try await tx.execute("UPDATE expenses SET category=$2,amount=$3::numeric,incurred_at=$4::timestamp,note=$5,store_id=$6,receipt_url=$7 WHERE id=$1",
                                     [.string(id), .string(afterCategory), .number(afterAmount), .string(afterDate), afterNote, afterStore, afterReceipt])
                func fields(_ category: String, _ amount: Decimal, _ date: String, _ store: JSONValue, _ note: JSONValue, _ receipt: JSONValue) throws -> JSONValue {
                    .object(["category": .string(category), "amount": .string(V.text(amount)), "incurredAt": .string(SwiftServiceJSON.iso(try SwiftServiceJSON.date(.string(date)))),
                             "storeId": store, "note": note, "receiptUrl": receipt])
                }
                try await tx.audit(action: "update", entityType: "expense", entityID: id, storeID: afterStore == .null ? nil : afterStore.text, summary: "ແກ້ໄຂລາຍຈ່າຍ \(Self.categoryLabel(afterCategory))",
                                   metadata: .object(["before": try fields(before.text("category"), before["amount"].decimal, before.text("incurredAt"), before["storeId"], before["note"], before["receiptUrl"]),
                                                      "after": try fields(afterCategory, afterAmount, afterDate, afterStore, afterNote, afterReceipt)]))
                return .object(["id": .string(id)])
            }
        }
        return .json(200, result)
    }

    func void(_ request: SwiftCommandRequest, id: String) async throws -> EngineResponse {
        let result = try await context.transaction(request, roles: Self.admin, failure: "ບໍ່ສາມາດບັນທຶກລາຍຈ່າຍໄດ້", failureStatus: 500) { tx in
            let body = request.body.isEmpty ? JSONValue.object([:]) : ((try? SwiftValue.decodeJSON(request.body)) ?? .object([:]))
            guard case .object(let fields) = body, let parsed = try? Self.text(fields, "reason", max: 1000, nullable: false) else {
                throw SwiftServiceFailure(status: 400, message: "ຂໍ້ມູນຍົກເລີກບໍ່ຖືກຕ້ອງ", retryable: false)
            }
            let reason = (parsed ?? nil).flatMap { $0.isEmpty ? nil : $0 } ?? "Voided by user"
            return try await tx.idempotent(scope: "expense.void:\(id)", payload: .object(["reason": .string(reason)]), invalidKey: "Invalid expense request key",
                                           missingKey: "Expense request key is required", conflict: "This request key was used for a different expense operation") {
                guard let before = try await tx.row("SELECT amount,incurred_at AS \"incurredAt\",voided_at AS \"voidedAt\",store_id AS \"storeId\" FROM expenses WHERE id=$1 FOR UPDATE", [.string(id)]) else {
                    throw Self.failure("EXPENSE_NOT_FOUND", Self.editMessages)
                }
                if before["voidedAt"] != .null { return .object(["id": .string(id), "voided": .bool(true)]) }
                let now = SwiftServiceJSON.iso(Date())
                try await tx.execute("UPDATE expenses SET voided_at=$2::timestamp,void_reason=$3 WHERE id=$1", [.string(id), .string(now), .string(reason)])
                try await tx.audit(action: "void", entityType: "expense", entityID: id, storeID: before["storeId"] == .null ? nil : before.text("storeId"), summary: "Void ລາຍຈ່າຍ · \(reason)",
                                   metadata: .object(["before": .object(["amount": .string(V.text(before["amount"].decimal)), "incurredAt": try SwiftServiceJSON.iso(before["incurredAt"]), "voidedAt": .null]),
                                                      "after": .object(["voidedAt": .string(now), "voidReason": .string(reason)])]))
                return .object(["id": .string(id), "voided": .bool(true)])
            }
        }
        return .json(200, result)
    }

    func category(_ request: SwiftCommandRequest) async throws -> EngineResponse {
        let name = try await context.transaction(request, roles: Self.admin, failure: "ບໍ່ສາມາດບັນທຶກປະເພດໄດ້", failureStatus: 500) { tx -> String in
            guard case .object(let fields) = request.json, let parsed = try? Self.text(fields, "name", max: 80, nullable: false, minimum: 1), let name = parsed ?? nil else {
                throw SwiftServiceFailure(status: 400, message: "ຊື່ປະເພດບໍ່ຖືກຕ້ອງ")
            }
            try await tx.execute("INSERT INTO expense_categories(id,name) VALUES($1,$2) ON CONFLICT (name) DO NOTHING", [.string(SwiftCommandIDs.next()), .string(name)])
            return name
        }
        return .json(201, .object(["category": .string(name)]))
    }

    func closeDay(_ request: SwiftCommandRequest) async throws -> EngineResponse {
        let result = try await context.transaction(request, roles: Self.admin, failure: "ບໍ່ສາມາດບັນທຶກການປິດຍອດປະຈຳວັນໄດ້", failureStatus: 500) { tx in
            let invalid = SwiftServiceFailure(status: 400, message: "ຂໍ້ມູນປິດຍອດບໍ່ຖືກຕ້ອງ", retryable: false)
            guard case .object(let fields) = request.json, case .string(let closingDate)? = fields["closingDate"], let day = SwiftDates.dateOnly(closingDate) else { throw invalid }
            let parsedNote: String??
            do { parsedNote = try Self.text(fields, "note", max: 1000, nullable: false) } catch { throw invalid }
            var expected: JSONValue?
            if let raw = fields["expectedSnapshot"] {
                if raw == .null { expected = .null }
                else {
                    guard case .object(let s) = raw, case .string(let id)? = s["id"], !id.isEmpty else { throw invalid }
                    for key in ["cashAmount", "bankAmount", "expenseAmount"] { guard case .string? = s[key], V.money(s[key]!) != nil else { throw invalid } }
                    switch s["note"] { case .null?: break; case .string(let text)?: guard text.utf16.count <= 1000 else { throw invalid }; default: throw invalid }
                    expected = .object(["id": .string(id), "cashAmount": s["cashAmount"]!, "bankAmount": s["bankAmount"]!, "expenseAmount": s["expenseAmount"]!, "note": s["note"]!])
                }
            }
            func amount(_ key: String) -> Decimal? { fields[key] == nil ? 0 : V.money(fields[key]!) }
            guard let cash = amount("cashAmount"), let bank = amount("bankAmount"), let spent = amount("expenseAmount") else {
                throw SwiftServiceFailure(status: 400, message: "ຈຳນວນເງິນຕ້ອງບໍ່ຕິດລົບ ແລະມີບໍ່ເກີນ 2 ຕຳແໜ່ງ", retryable: false)
            }
            let note: JSONValue = (parsedNote ?? nil).flatMap { $0.isEmpty ? nil : JSONValue.string($0) } ?? .null
            let amounts: [String: JSONValue] = ["cashAmount": .string(V.moneyString(cash)), "bankAmount": .string(V.moneyString(bank)), "expenseAmount": .string(V.moneyString(spent))]
            var payload = amounts.merging(["closingDate": .string(closingDate), "note": note], uniquingKeysWith: { _, new in new })
            if let expected { payload["expectedSnapshot"] = expected }
            return try await tx.idempotent(scope: "daily_closing.save", payload: .object(payload), invalidKey: "Invalid daily closing request key", missingKey: "Daily closing request key is required",
                                           conflict: "This request key was used for a different daily closing") {
                let stored = day + "T12:00:00.000"
                let before = try await tx.row("SELECT id,closing_date AS \"closingDate\",cash_amount AS cash,bank_amount AS bank,expense_amount AS spent,note FROM daily_closings WHERE closing_date=$1::timestamp FOR UPDATE", [.string(stored)])
                func snapshot(_ row: JSONValue) -> JSONValue {
                    .object(["id": row["id"], "cashAmount": .string(V.moneyString(row["cash"].decimal)), "bankAmount": .string(V.moneyString(row["bank"].decimal)),
                             "expenseAmount": .string(V.moneyString(row["spent"].decimal)), "note": row["note"]])
                }
                let matches: Bool
                if let before {
                    let current = snapshot(before)
                    if let expected, expected != .null, current["id"] == expected["id"], current["note"] == expected["note"] {
                        matches = ["cashAmount", "bankAmount", "expenseAmount"].allSatisfy { V.money(current[$0]) == V.money(expected[$0]) }
                    } else { matches = false }
                } else { matches = expected == nil || expected == .null }
                guard matches else { throw SwiftServiceFailure(status: 409, message: "ຍອດຂອງວັນນີ້ປ່ຽນແລ້ວ. ກະລຸນາໂຫຼດຍອດລ່າສຸດ ແລະກວດກ່ອນບັນທຶກໃໝ່", retryable: false, details: ["code": .string("STALE_CLOSING")]) }
                let id = before?.text("id") ?? SwiftCommandIDs.next()
                if before == nil {
                    try await tx.execute("INSERT INTO daily_closings(id,closing_date,cash_amount,bank_amount,expense_amount,note,created_by) VALUES($1,$2::timestamp,$3::numeric,$4::numeric,$5::numeric,$6,$7)",
                                         [.string(id), .string(stored), amounts["cashAmount"]!, amounts["bankAmount"]!, amounts["expenseAmount"]!, note, .string(tx.user.userID)])
                } else {
                    try await tx.execute("UPDATE daily_closings SET cash_amount=$2::numeric,bank_amount=$3::numeric,expense_amount=$4::numeric,note=$5,created_by=$6 WHERE id=$1",
                                         [.string(id), amounts["cashAmount"]!, amounts["bankAmount"]!, amounts["expenseAmount"]!, note, .string(tx.user.userID)])
                }
                func fields(_ cash: Decimal, _ bank: Decimal, _ spent: Decimal, _ note: JSONValue) -> JSONValue {
                    .object(["closingDate": .string(day + "T12:00:00.000Z"), "cashAmount": .string(V.text(cash)), "bankAmount": .string(V.text(bank)), "expenseAmount": .string(V.text(spent)), "note": note])
                }
                try await tx.audit(action: "close_day", entityType: "daily_closing", entityID: id, summary: "ປິດຍອດປະຈຳວັນ \(closingDate) · \(SwiftReadDashboard.localeString(cash + bank)) LAK",
                                   metadata: .object(["before": before.map { fields($0["cash"].decimal, $0["bank"].decimal, $0["spent"].decimal, $0["note"]) } ?? .null, "after": fields(cash, bank, spent, note)]))
                return .object(["id": .string(id), "snapshot": .object(["id": .string(id)].merging(amounts, uniquingKeysWith: { _, new in new }).merging(["note": note], uniquingKeysWith: { _, new in new }))])
            }
        }
        return .json(201, result)
    }
}
