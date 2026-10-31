import Foundation

enum JSONValue: Codable, Equatable, Sendable, Identifiable {
    case object([String: JSONValue]), array([JSONValue]), string(String), number(Decimal), bool(Bool), null
    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let item = try? value.decode(Bool.self) { self = .bool(item) }
        else if let item = try? value.decode(String.self) { self = .string(item) }
        else if let item = try? value.decode(Decimal.self) { self = .number(item) }
        else if let item = try? value.decode([String: JSONValue].self) { self = .object(item) }
        else { self = .array(try value.decode([JSONValue].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .object(let item): try value.encode(item)
        case .array(let item): try value.encode(item)
        case .string(let item): try value.encode(item)
        case .number(let item): try value.encode(item)
        case .bool(let item): try value.encode(item)
        case .null: try value.encodeNil()
        }
    }
    subscript(_ key: String) -> JSONValue { object[key] ?? .null }
    var object: [String: JSONValue] { if case .object(let value) = self { return value }; return [:] }
    var array: [JSONValue] { if case .array(let value) = self { return value }; return [] }
    var text: String {
        switch self {
        case .string(let value): return value
        case .number(let value): return NSDecimalNumber(decimal: value).stringValue
        case .bool(let value): return value ? "true" : "false"
        default: return ""
        }
    }
    func text(_ key: String) -> String { self[key].text }
    var bool: Bool { if case .bool(let value) = self { return value }; return text == "true" }
    var decimal: Decimal { if case .number(let value) = self { return value }; return Decimal(string: text, locale: Locale(identifier: "en_US_POSIX")) ?? 0 }
    var double: Double { NSDecimalNumber(decimal: decimal).doubleValue }
    var id: String { text("id") }
    static func integer(_ value: Int) -> JSONValue { .number(Decimal(value)) }
    static func fromStrings(_ values: [String: String]) -> JSONValue { .object(values.mapValues(JSONValue.string)) }
    func encoded() throws -> Data { let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]; return try encoder.encode(self) }
}

struct NativeFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
    init(_ message: String) { self.message = message }
}

func canonicalDecimal(_ text: String, scale: Int = 2, allowNegative: Bool = false) throws -> String {
    let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
    let sign = allowNegative ? "-?" : ""
    let pattern = "^\(sign)[0-9]+(?:\\.[0-9]{1,\(max(1, scale))})?$"
    guard value.range(of: pattern, options: .regularExpression) != nil,
          value.count <= 28, let decimal = Decimal(string: value, locale: Locale(identifier: "en_US_POSIX")),
          !decimal.isNaN else { throw NativeFailure("ຈຳນວນບໍ່ຖືກຕ້ອງ; ໃຊ້ທົດສະນິຍົມບໍ່ເກີນ \(scale) ຕຳແໜ່ງ") }
    return value
}

func businessDateString(_ date: Date) -> String {
    let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(identifier: "Asia/Vientiane"); formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: date)
}

enum NativeCSV {
    static func encode(headers: [String], rows: [[String]]) -> String {
        func cell(_ value: String) -> String {
            let first = value.trimmingCharacters(in: .whitespacesAndNewlines).first
            let safe = first.map { "=+-@".contains($0) } == true ? "'" + value : value
            return "\"" + safe.replacingOccurrences(of: "\"", with: "\"\"") + "\""
        }
        return "\u{FEFF}" + ([headers] + rows).map { $0.map(cell).joined(separator: ",") }.joined(separator: "\r\n")
    }
}
