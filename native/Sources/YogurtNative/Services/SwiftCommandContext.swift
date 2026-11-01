import Foundation
import os

/// A write request routed from the engine. Header names are lowercased.
struct SwiftCommandRequest: Sendable {
    let method: String
    let path: String
    let headers: [String: String]
    let body: Data
    let token: String?
    var operationKey: String? { headers["idempotency-key"] }
    var contentType: String { headers["content-type"] ?? "" }
    /// `await request.json().catch(() => null)`.
    var json: JSONValue { (try? SwiftValue.decodeJSON(body)) ?? .null }
    /// Body that must be a JSON object, as most routes require.
    func object(_ message: String = "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ") throws -> JSONValue {
        guard case .object = json else { throw SwiftCommandFailure.invalid(message) }
        return json
    }
}

/// Domain failures in the original routes' shape: `{ error, retryable: false }` unless stated.
enum SwiftCommandFailure {
    static func invalid(_ message: String, _ details: [String: JSONValue] = [:]) -> SwiftServiceFailure { .init(status: 400, message: message, retryable: false, details: details) }
    static func notFound(_ message: String) -> SwiftServiceFailure { .init(status: 404, message: message, retryable: false) }
    static func conflict(_ message: String, _ details: [String: JSONValue] = [:]) -> SwiftServiceFailure { .init(status: 409, message: message, retryable: false, details: details) }
    static let invalidKey = SwiftServiceFailure(status: 400, message: "ລະຫັດລາຍການບໍ່ຖືກຕ້ອງ", retryable: false)
    static let keyConflict = SwiftServiceFailure(status: 409, message: "ລະຫັດລາຍການນີ້ຖືກໃຊ້ກັບຂໍ້ມູນອື່ນແລ້ວ", retryable: false)
    static let outOfRange = SwiftServiceFailure(status: 400, message: "ຈຳນວນ ຫຼືມູນຄ່າວັດຖຸດິບເກີນຂອບເຂດທີ່ຮອງຮັບ", retryable: false)
}

/// One serializable command transaction: the session, user and current role are re-read inside it.
struct SwiftCommandTransaction: Sendable {
    let connection: SwiftSQLConnection
    let user: SwiftUserIdentity
    let request: SwiftCommandRequest

    func rows(_ sql: String, _ values: [JSONValue] = []) async throws -> [JSONValue] { try await connection.rows(sql, values) }
    func row(_ sql: String, _ values: [JSONValue] = []) async throws -> JSONValue? { try await connection.rows(sql, values).first }
    func execute(_ sql: String, _ values: [JSONValue] = []) async throws { try await connection.execute(sql, values) }
    func returning(_ sql: String, _ values: [JSONValue] = []) async throws -> [JSONValue] { try await connection.returning(sql, values) }

    /// idempotency.ts runIdempotentOperation: same user+scope+lowercased key, the original
    /// canonical SHA-256 request hash, the saved result on replay and 409 on a changed payload.
    func idempotent(scope: String, payload: JSONValue, invalidKey: String = "ລະຫັດລາຍການບໍ່ຖືກຕ້ອງ", missingKey: String? = nil, conflict: String = "ລະຫັດລາຍການນີ້ຖືກໃຊ້ກັບຂໍ້ມູນອື່ນແລ້ວ", _ work: () async throws -> JSONValue) async throws -> JSONValue {
        guard let raw = request.operationKey else { throw SwiftServiceFailure(status: 400, message: missingKey ?? invalidKey, retryable: false) }
        guard raw.range(of: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", options: .regularExpression) != nil else {
            throw SwiftServiceFailure(status: 400, message: invalidKey, retryable: false)
        }
        let key = raw.lowercased()
        let hash = try SwiftValue.requestHash(payload)
        if let existing = try await row("SELECT request_hash AS \"requestHash\",result FROM operation_receipts WHERE user_id=$1 AND scope=$2 AND key=$3", [.string(user.userID), .string(scope), .string(key)]) {
            guard existing.text("requestHash") == hash else { throw SwiftServiceFailure(status: 409, message: conflict, retryable: false) }
            return existing["result"]
        }
        let result = try await work()
        try await execute("INSERT INTO operation_receipts(id,user_id,scope,key,request_hash,result) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
                          [.string(SwiftCommandIDs.next()), .string(user.userID), .string(scope), .string(key), .string(hash), result])
        return result
    }

    /// audit.ts writeAuditLog inside this transaction.
    func audit(action: String, entityType: String, entityID: String?, storeID: String? = nil, summary: String, metadata: JSONValue? = nil) async throws {
        try await execute("INSERT INTO audit_logs(id,user_id,action,entity_type,entity_id,store_id,summary,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)", [
            .string(SwiftCommandIDs.next()), .string(user.userID), .string(action), .string(entityType), entityID.map(JSONValue.string) ?? .null,
            storeID.map(JSONValue.string) ?? .null, .string(summary), metadata ?? .null,
        ])
    }
}

struct SwiftCommandContext: Sendable {
    let database: SwiftDatabase
    let authentication: SwiftAuthentication
    let dataRoot: URL

    /// Runs `work` in one serializable transaction after re-authorizing the session and role there.
    /// Unexpected failures become the route's retryable 503; nothing partial is committed.
    func transaction<T: Sendable>(_ request: SwiftCommandRequest, roles: Set<String>, failure: String, failureStatus: Int = 503, failureRetryable: Bool? = true,
                                  map: (@Sendable (SwiftDatabaseError) -> SwiftServiceFailure?)? = nil,
                                  _ work: @escaping @Sendable (SwiftCommandTransaction) async throws -> T) async throws -> T {
        do {
            return try await database.transaction { connection in
                let user: SwiftUserIdentity
                do { user = try await authentication.authorize(token: request.token, connection: connection) }
                catch let failure as SwiftServiceFailure where failure.status == 401 { throw SwiftServiceFailure(status: 401, message: "ກະລຸນາເຂົ້າລະບົບກ່ອນ", retryable: false) }
                guard roles.contains(user.role) else { throw SwiftServiceFailure(status: 403, message: "ບັນຊີນີ້ບໍ່ມີສິດເຮັດລາຍການນີ້") }
                return try await work(SwiftCommandTransaction(connection: connection, user: user, request: request))
            }
        } catch let failure as SwiftServiceFailure {
            throw failure
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as SwiftDatabaseError {
            if let mapped = map?(error) { throw mapped }
            if error.isUnavailable { throw SwiftServiceFailure(status: 503, message: "ຖານຂໍ້ມູນໃຊ້ງານບໍ່ໄດ້ຊົ່ວຄາວ; ກະລຸນາລອງໃໝ່ໃນພາຍຫຼັງ", retryable: true) }
            throw SwiftServiceFailure(status: failureStatus, message: failure, retryable: failureRetryable)
        } catch {
            throw SwiftServiceFailure(status: failureStatus, message: failure, retryable: failureRetryable)
        }
    }
}

/// Prisma `cuid()`-shaped identifiers: lowercase, 25 characters. Like cuid, a time prefix and a
/// process counter make IDs created in one transaction sort in creation order, which decides
/// stock-lot order when lots tie on every other column.
enum SwiftCommandIDs {
    private static let state = OSAllocatedUnfairLock(initialState: (millisecond: UInt64(0), counter: UInt64(0)))
    private static let alphabet = Array("0123456789abcdefghijklmnopqrstuvwxyz")
    static func next() -> String {
        let (time, counter) = state.withLock { value -> (UInt64, UInt64) in
            let now = max(UInt64(Date().timeIntervalSince1970 * 1000), value.millisecond)
            value.counter = now == value.millisecond ? value.counter + 1 : 0
            value.millisecond = now
            return (now, value.counter)
        }
        var bytes = [UInt8](repeating: 0, count: 12)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return "c" + base36(time, width: 8) + base36(counter, width: 4) + String(bytes.map { alphabet[Int($0) % 36] })
    }
    private static func base36(_ value: UInt64, width: Int) -> String {
        var remaining = value, text = ""
        for _ in 0..<width { text = String(alphabet[Int(remaining % 36)]) + text; remaining /= 36 }
        return text
    }
}

/// decimal.js / money.ts input rules on JSON values. Business math never passes through Double.
enum SwiftCommandValue {
    static let stockScale = 6, recipeScale = 4, unitCostScale = 4, moneyScale = 2

    /// The JSON number or string as an exact Decimal (decimal.js syntax, no hex).
    static func decimal(_ value: JSONValue) -> Decimal? {
        switch value {
        case .number(let number): return number.isNaN ? nil : number
        case .string(let text):
            guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  text.range(of: "^[+-]?(?:[0-9]+\\.?[0-9]*|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?$", options: .regularExpression) != nil,
                  let parsed = Decimal(string: text, locale: Locale(identifier: "en_US_POSIX")), !parsed.isNaN else { return nil }
            return parsed
        default: return nil
        }
    }
    /// stock-validation.ts decimalAtScale.
    static func atScale(_ value: JSONValue, _ scale: Int, allowNegative: Bool = false, positive: Bool = false, nonzero: Bool = false, round: Bool = false) -> Decimal? {
        guard let parsed = decimal(value) else { return nil }
        return atScale(parsed, scale, allowNegative: allowNegative, positive: positive, nonzero: nonzero, round: round)
    }
    static func atScale(_ value: Decimal, _ scale: Int, allowNegative: Bool = false, positive: Bool = false, nonzero: Bool = false, round: Bool = false) -> Decimal? {
        guard !value.isNaN, allowNegative || value >= 0, let rounded = try? SwiftValue.rounded(value, scale: scale) else { return nil }
        if !round && rounded != value { return nil }
        guard abs(rounded) < pow(10, 14 - scale) else { return nil }
        if (positive && !(rounded > 0)) || (nonzero && rounded == 0) { return nil }
        return rounded
    }
    /// Decimal.toString(): plain notation without insignificant zeros.
    static func text(_ value: Decimal) -> String { NSDecimalNumber(decimal: value).stringValue }
    /// money.ts parseMoneyCents as an exact Decimal amount (two places at most).
    static func money(_ value: JSONValue) -> Decimal? {
        let text: String
        switch value {
        case .string(let raw): text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        case .number(let number): text = NSDecimalNumber(decimal: number).stringValue
        default: return nil
        }
        guard text.range(of: "^[0-9]+(?:\\.[0-9]{1,2})?$", options: .regularExpression) != nil,
              let amount = Decimal(string: text, locale: Locale(identifier: "en_US_POSIX")), amount <= Decimal(string: "999999999999.99")! else { return nil }
        return amount
    }
    /// money.ts moneyDecimalString: exactly two places.
    static func moneyString(_ value: Decimal) -> String { (try? SwiftValue.decimalString(value, scale: 2)) ?? "0.00" }
    /// money.ts parseWholeCount.
    static func wholeCount(_ value: JSONValue) -> Int? {
        switch value {
        case .string(let text): guard text.range(of: "^[0-9]+$", options: .regularExpression) != nil, let count = Int(text), count <= 2_147_483_647 else { return nil }; return count
        case .number(let number):
            guard let integral = try? SwiftValue.rounded(number, scale: 0), integral == number, number >= 0, number <= 2_147_483_647 else { return nil }
            return NSDecimalNumber(decimal: number).intValue
        default: return nil
        }
    }
    /// stock-validation.ts parseBaseCups (Number(value) safe integer in 1...2147483647).
    static func positiveInteger(_ value: JSONValue) -> Int? {
        guard let parsed = decimal(value.trimmedStringOrSelf), let integral = try? SwiftValue.rounded(parsed, scale: 0), integral == parsed,
              parsed > 0, parsed <= 2_147_483_647 else { return nil }
        return NSDecimalNumber(decimal: parsed).intValue
    }
    /// `String(value ?? "").trim()` for optional text fields.
    static func trimmed(_ value: JSONValue) -> String {
        switch value {
        case .null: return ""
        case .string(let text): return text.trimmingCharacters(in: .whitespacesAndNewlines)
        case .number(let number): return (try? SwiftValue.canonicalPayload(.number(number))) ?? ""
        case .bool(let flag): return flag ? "true" : "false"
        case .array, .object: return "[object Object]"
        }
    }
    /// `String(value ?? "").trim() || null`.
    static func optionalText(_ value: JSONValue) -> JSONValue { let text = trimmed(value); return text.isEmpty ? .null : .string(text) }
}

private extension JSONValue {
    /// Number("  12 ") trims whitespace before parsing.
    var trimmedStringOrSelf: JSONValue { if case .string(let text) = self { return .string(text.trimmingCharacters(in: .whitespacesAndNewlines)) }; return self }
}
