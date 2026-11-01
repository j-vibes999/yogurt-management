import Foundation

/// `JSON.stringify(JSON.parse(text))` for request sub-trees whose original key order is part of a
/// stored fingerprint (restock visit notes). JSONValue cannot keep key order, so this keeps a
/// small ordered tree. Duplicate keys keep their first position and last value, as JSON.parse does.
indirect enum SwiftOrderedJSON {
    case object([(String, SwiftOrderedJSON)]), array([SwiftOrderedJSON]), string(String), number(Decimal), bool(Bool), null

    static func parse(_ data: Data) -> SwiftOrderedJSON? {
        var parser = Parser(bytes: Array(data))
        guard let value = parser.value() else { return nil }
        parser.skipSpace()
        return parser.index == parser.bytes.count ? value : nil
    }
    subscript(_ key: String) -> SwiftOrderedJSON? {
        if case .object(let fields) = self { return fields.first { $0.0 == key }?.1 }
        return nil
    }
    func stringify() throws -> String {
        switch self {
        case .null: return "null"
        case .bool(let flag): return flag ? "true" : "false"
        case .string(let text): return SwiftValue.quote(text)
        case .number(let number): return try SwiftValue.canonicalPayload(.number(number))
        case .array(let items): return "[" + (try items.map { try $0.stringify() }).joined(separator: ",") + "]"
        case .object(let fields): return "{" + (try fields.map { SwiftValue.quote($0.0) + ":" + (try $0.1.stringify()) }).joined(separator: ",") + "}"
        }
    }

    private struct Parser {
        let bytes: [UInt8]
        var index = 0
        mutating func skipSpace() { while index < bytes.count, [0x20, 0x09, 0x0a, 0x0d].contains(bytes[index]) { index += 1 } }
        mutating func value(depth: Int = 0) -> SwiftOrderedJSON? {
            guard depth < 64 else { return nil }
            skipSpace()
            guard index < bytes.count else { return nil }
            switch bytes[index] {
            case UInt8(ascii: "{"):
                index += 1; var fields: [(String, SwiftOrderedJSON)] = []
                skipSpace()
                if index < bytes.count, bytes[index] == UInt8(ascii: "}") { index += 1; return .object(fields) }
                while true {
                    skipSpace()
                    guard case .string(let key)? = string(), expect(":"), let item = value(depth: depth + 1) else { return nil }
                    if let existing = fields.firstIndex(where: { $0.0 == key }) { fields[existing].1 = item } else { fields.append((key, item)) }
                    skipSpace()
                    if expect(",") { continue }
                    return expect("}") ? .object(fields) : nil
                }
            case UInt8(ascii: "["):
                index += 1; var items: [SwiftOrderedJSON] = []
                skipSpace()
                if index < bytes.count, bytes[index] == UInt8(ascii: "]") { index += 1; return .array(items) }
                while true {
                    guard let item = value(depth: depth + 1) else { return nil }
                    items.append(item); skipSpace()
                    if expect(",") { continue }
                    return expect("]") ? .array(items) : nil
                }
            case UInt8(ascii: "\""): return string()
            case UInt8(ascii: "t"): return literal("true", .bool(true))
            case UInt8(ascii: "f"): return literal("false", .bool(false))
            case UInt8(ascii: "n"): return literal("null", .null)
            default:
                let start = index
                while index < bytes.count, "+-.eE0123456789".utf8.contains(bytes[index]) { index += 1 }
                let token = String(decoding: bytes[start..<index], as: UTF8.self)
                guard token.range(of: "^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$", options: .regularExpression) != nil,
                      let number = Decimal(string: token, locale: Locale(identifier: "en_US_POSIX")) else { return nil }
                return .number(number)
            }
        }
        mutating func expect(_ character: Character) -> Bool {
            skipSpace()
            guard index < bytes.count, bytes[index] == character.asciiValue! else { return false }
            index += 1; return true
        }
        mutating func literal(_ word: String, _ result: SwiftOrderedJSON) -> SwiftOrderedJSON? {
            let utf8 = Array(word.utf8)
            guard index + utf8.count <= bytes.count, Array(bytes[index..<index + utf8.count]) == utf8 else { return nil }
            index += utf8.count; return result
        }
        /// A JSON string token, decoded with the system decoder for exact escape handling.
        mutating func string() -> SwiftOrderedJSON? {
            guard index < bytes.count, bytes[index] == UInt8(ascii: "\"") else { return nil }
            let start = index; index += 1
            while index < bytes.count {
                if bytes[index] == UInt8(ascii: "\\") { index += 2; continue }
                if bytes[index] == UInt8(ascii: "\"") { index += 1; break }
                index += 1
            }
            guard let text = try? JSONDecoder().decode(String.self, from: Data(bytes[start..<min(index, bytes.count)])) else { return nil }
            return .string(text)
        }
    }
}
