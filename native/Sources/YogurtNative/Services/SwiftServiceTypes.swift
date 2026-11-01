import Foundation

struct SwiftServiceFailure: Error, Sendable {
    let status: Int
    let message: String
    let retryable: Bool?
    let details: [String: JSONValue]
    init(status: Int, message: String, retryable: Bool? = nil, details: [String: JSONValue] = [:]) {
        self.status = status; self.message = message; self.retryable = retryable; self.details = details
    }
}
struct SwiftServiceReply: Sendable {
    let status: Int
    let data: JSONValue
    let headers: [String: String]
    init(status: Int = 200, data: JSONValue, headers: [String: String] = [:]) {
        self.status = status; self.data = data; self.headers = headers
    }
}
struct SwiftUserIdentity: Sendable {
    let userID: String
    let sessionID: String
    let email: String
    let fullName: String
    let role: String
    var nativeSession: NativeSession { NativeSession(userId: userID, fullName: fullName, email: email, role: role, source: "database") }
}

enum SwiftServiceJSON {
    static func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
    static func date(_ value: JSONValue) throws -> Date {
        var text = value.text.replacingOccurrences(of: " ", with: "T")
        if text.range(of: "(?:Z|[+-][0-9]{2}:[0-9]{2})$", options: .regularExpression) == nil { text += "Z" }
        return try SwiftValue.utcDate(text)
    }
    static func iso(_ value: JSONValue) throws -> JSONValue { value == .null ? .null : .string(iso(try date(value))) }
    static func decimal(_ value: JSONValue) throws -> JSONValue {
        if value == .null { return .null }
        return .string(NSDecimalNumber(decimal: try SwiftValue.decimal(value.text)).stringValue)
    }
    static func displayDate(_ value: JSONValue, mode: String = "date") throws -> JSONValue {
        if value == .null { return .string("—") }
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "lo_LA"); formatter.timeZone = TimeZone(identifier: "Asia/Vientiane")
        formatter.dateFormat = mode == "time" ? "dd MMM yyyy HH:mm" : mode == "period" ? "dd MMM yyyy" : "dd/MM/yyyy"
        return .string(formatter.string(from: try date(value)))
    }
    static func replacing(_ value: JSONValue, _ fields: [String: JSONValue]) -> JSONValue { .object(value.object.merging(fields, uniquingKeysWith: { _, new in new })) }
    static func safeMetadata(_ value: JSONValue, depth: Int = 0) -> JSONValue {
        if depth > 12 { return .null }
        switch value {
        case .array(let items): return .array(items.map { safeMetadata($0, depth: depth + 1) })
        case .object(let object): return .object(object.filter { $0.key.range(of: "password|secret|token|cookie|authorization|credential|database.?url", options: [.regularExpression,.caseInsensitive]) == nil }.mapValues { safeMetadata($0, depth: depth + 1) })
        default: return value
        }
    }
    static func sum(_ rows: [JSONValue], _ key: String) -> Decimal { rows.reduce(0) { $0 + $1[key].decimal } }
}

struct SwiftNativeQuery: Sendable {
    let values: [String: String]
    subscript(_ key: String) -> String? { values[key] }
    func integer(_ key: String) -> Int? { values[key].flatMap(Int.init) }
    init(resource: String, items: [URLQueryItem]) throws {
        let keys: [String: Set<String>] = ["store":["id"],"restock":["id"],"expense":["id"],"refills":["id"],"settlements":["query","filter","page"],"expenses":["query","filter","page","id"],"audit":["query","filter","page"],"production":["historyPage"],"reports":["period"],"closing":["date"]]
        let filters: [String: Set<String>] = ["settlements":["pending","partial","paid","all"],"expenses":["all","month","electricity","transport","maintenance"],"audit":["all","update","adjust","expense","user"]]
        func invalid() -> SwiftServiceFailure { .init(status:400,message:"ຕົວກອງຂໍ້ມູນບໍ່ຖືກຕ້ອງ") }
        var result: [String:String] = [:]
        for item in items {
            guard keys[resource,default:[]].contains(item.name), result[item.name] == nil else { throw invalid() }
            result[item.name] = item.value ?? ""
        }
        if ["store","restock","expense"].contains(resource), result["id"] == nil { throw invalid() }
        if let id = result["id"], id.range(of:"^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$",options:.regularExpression) == nil { throw invalid() }
        if let text = result["query"] {
            let q = text.trimmingCharacters(in:.whitespacesAndNewlines)
            guard q.utf16.count <= (resource == "audit" ? 120 : 200), q.range(of:"[\\x00-\\x1f\\x7f]",options:.regularExpression) == nil else { throw invalid() }
            result["query"] = q
        }
        if let filter = result["filter"], !filters[resource,default:[]].contains(filter) { throw invalid() }
        for key in ["page","historyPage"] { if let v = result[key] { guard v.range(of:"^[1-9][0-9]{0,6}$",options:.regularExpression) != nil, let n = Int(v), n <= 1_000_000 else { throw invalid() } } }
        if let period = result["period"], !["today","week","month"].contains(period) { throw invalid() }
        if resource == "closing" { guard let day = result["date"], (try? SwiftValue.laosDayRange(day)) != nil else { throw invalid() } }
        values = result
    }
}
