import Foundation
import CryptoKit

/// Business decimals never pass through Double. Only legacy JSON hashing reproduces JS Number.
enum SwiftValue {
    enum Failure: String, Error, LocalizedError {
        case invalidDecimal, invalidScale, invalidID, invalidDate, invalidJSON
        var errorDescription: String? { "Invalid value (\(rawValue))" }
    }
    private static let locale = Locale(identifier: "en_US_POSIX")

    static func decimal(_ text: String) throws -> Decimal {
        guard text.count <= 160, text.range(of: "^-?[0-9]+(?:\\.[0-9]+)?$", options: .regularExpression) != nil,
              let value = Decimal(string: text, locale: locale), !value.isNaN,
              normalizedDecimal(text) == normalizedDecimal(NSDecimalNumber(decimal: value).stringValue) else { throw Failure.invalidDecimal }
        return value
    }
    private static func normalizedDecimal(_ text: String) -> String {
        let negative = text.hasPrefix("-")
        let parts = (negative ? String(text.dropFirst()) : text).split(separator: ".", omittingEmptySubsequences: false)
        let whole = String(parts[0].drop(while: { $0 == "0" }))
        var fraction = parts.count > 1 ? String(parts[1]) : ""
        while fraction.last == "0" { fraction.removeLast() }
        let number = (whole.isEmpty ? "0" : whole) + (fraction.isEmpty ? "" : "." + fraction)
        return negative && number != "0" ? "-" + number : number
    }
    static func rounded(_ value: Decimal, scale: Int) throws -> Decimal {
        guard (0...18).contains(scale), !value.isNaN else { throw Failure.invalidScale }
        var source = value; var result = Decimal()
        NSDecimalRound(&result, &source, scale, .plain)
        guard !result.isNaN else { throw Failure.invalidDecimal }
        return result
    }
    static func decimalString(_ value: Decimal, scale: Int) throws -> String {
        let text = NSDecimalNumber(decimal: try rounded(value, scale: scale)).stringValue
        let parts = text.split(separator: ".", omittingEmptySubsequences: false)
        guard scale > 0 else { return text }
        let fraction = parts.count > 1 ? String(parts[1]) : ""
        return String(parts[0]) + "." + fraction + String(repeating: "0", count: max(0, scale - fraction.count))
    }

    /// localeCompare object sorting, then ECMAScript numeric property-key enumeration.
    static func canonicalPayload(_ value: JSONValue) throws -> String {
        switch value {
        case .null: return "null"
        case .bool(let flag): return flag ? "true" : "false"
        case .string(let text): return quote(text)
        case .number(let number): return try javascriptNumber(number)
        case .array(let items): return "[" + (try items.map(canonicalPayload)).joined(separator: ",") + "]"
        case .object(let object):
            let sorted = object.keys.sorted {
                if let a = arrayIndex($0), let b = arrayIndex($1) { return a < b }
                if arrayIndex($0) != nil { return true }
                if arrayIndex($1) != nil { return false }
                return $0.compare($1, locale: Locale(identifier: "en_US")) == .orderedAscending
            }
            return "{" + (try sorted.map { quote($0) + ":" + (try canonicalPayload(object[$0]!)) }).joined(separator: ",") + "}"
        }
    }
    private static func arrayIndex(_ key: String) -> UInt32? {
        guard let index = UInt32(key), index != UInt32.max, String(index) == key else { return nil }
        return index
    }
    static func quote(_ text: String) -> String {
        var result = "\""
        for scalar in text.unicodeScalars {
            switch scalar.value {
            case 0x22: result += "\\\""
            case 0x5c: result += "\\\\"
            case 8: result += "\\b"
            case 9: result += "\\t"
            case 10: result += "\\n"
            case 12: result += "\\f"
            case 13: result += "\\r"
            case 0..<32: result += String(format: "\\u%04x", scalar.value)
            default: result.unicodeScalars.append(scalar)
            }
        }
        return result + "\""
    }
    private static func javascriptNumber(_ number: Decimal) throws -> String {
        guard !number.isNaN else { throw Failure.invalidJSON }
        guard let value = Double(NSDecimalNumber(decimal: number).stringValue), value.isFinite else { throw Failure.invalidJSON }
        if value == 0 { return "0" }
        let negative = value < 0
        let raw = String(abs(value)).lowercased()
        let exponentParts = raw.split(separator: "e")
        let coefficient = String(exponentParts[0])
        let exponent = exponentParts.count == 2 ? Int(exponentParts[1])! : 0
        let point = coefficient.firstIndex(of: ".") ?? coefficient.endIndex
        var decimalPosition = coefficient.distance(from: coefficient.startIndex, to: point) + exponent
        var digits = coefficient.replacingOccurrences(of: ".", with: "")
        while digits.first == "0" { digits.removeFirst(); decimalPosition -= 1 }
        while digits.last == "0" { digits.removeLast() }
        let sign = negative ? "-" : ""
        if decimalPosition > 0 && decimalPosition <= 21 {
            if decimalPosition >= digits.count { return sign + digits + String(repeating: "0", count: decimalPosition - digits.count) }
            let split = digits.index(digits.startIndex, offsetBy: decimalPosition)
            return sign + digits[..<split] + "." + digits[split...]
        }
        if decimalPosition <= 0 && decimalPosition > -6 { return sign + "0." + String(repeating: "0", count: -decimalPosition) + digits }
        let scientificExponent = decimalPosition - 1
        let tail = digits.dropFirst()
        return sign + String(digits.prefix(1)) + (tail.isEmpty ? "" : "." + tail) + "e" + (scientificExponent >= 0 ? "+" : "") + String(scientificExponent)
    }
    static func requestHash(_ payload: JSONValue) throws -> String {
        SHA256.hash(data: Data(try canonicalPayload(payload).utf8)).map { String(format: "%02x", $0) }.joined()
    }
    /// Foundation Decimal decoding can silently round oversized JSON numbers. Preflight every
    /// numeric token so a database value either stays exact or fails instead of corrupting it.
    static func decodeJSON(_ data: Data) throws -> JSONValue {
        let bytes = Array(data)
        var index = 0; var inString = false; var escaped = false
        while index < bytes.count {
            let byte = bytes[index]
            if inString {
                if escaped { escaped = false }
                else if byte == 92 { escaped = true }
                else if byte == 34 { inString = false }
                index += 1
            } else if byte == 34 { inString = true; index += 1 }
            else if byte == 45 || (48...57).contains(byte) {
                let start = index
                while index < bytes.count && ((48...57).contains(bytes[index]) || [45, 43, 46, 101, 69].contains(bytes[index])) { index += 1 }
                let token = String(decoding: bytes[start..<index], as: UTF8.self)
                let parts = token.lowercased().split(separator: "e", omittingEmptySubsequences: false)
                guard parts.count <= 2 else { throw Failure.invalidJSON }
                var plain = String(parts[0])
                if parts.count == 2 {
                    guard let exponent = Int(parts[1]), (-160...160).contains(exponent) else { throw Failure.invalidDecimal }
                    let negative = plain.hasPrefix("-")
                    if negative { plain.removeFirst() }
                    let coefficient = plain.split(separator: ".", omittingEmptySubsequences: false)
                    let digits = coefficient.joined()
                    let point = coefficient[0].count + exponent
                    if point <= 0 { plain = "0." + String(repeating: "0", count: -point) + digits }
                    else if point >= digits.count { plain = digits + String(repeating: "0", count: point - digits.count) }
                    else { let split = digits.index(digits.startIndex, offsetBy: point); plain = String(digits[..<split]) + "." + digits[split...] }
                    if negative { plain = "-" + plain }
                }
                _ = try decimal(plain)
            } else { index += 1 }
        }
        return try JSONDecoder().decode(JSONValue.self, from: data)
    }

    static func safeID(_ value: String) throws -> String {
        guard value.utf8.count <= 200, value.range(of: "^[A-Za-z0-9_-]+\\z", options: .regularExpression) != nil else { throw Failure.invalidID }
        return value
    }
    static func utcDate(_ text: String) throws -> Date {
        guard text.range(of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,9})?(?:Z|[+-][0-9]{2}:[0-9]{2})$", options: .regularExpression) != nil else { throw Failure.invalidDate }
        _ = try laosDayRange(String(text.prefix(10)))
        guard text.rangeOfCharacter(from: .whitespacesAndNewlines) == nil else { throw Failure.invalidDate }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = text.contains(".") ? [.withInternetDateTime, .withFractionalSeconds] : [.withInternetDateTime]
        guard let date = formatter.date(from: text) else { throw Failure.invalidDate }
        return date
    }
    static func laosDayRange(_ day: String) throws -> Range<Date> {
        guard day.range(of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", options: .regularExpression) != nil else { throw Failure.invalidDate }
        let formatter = DateFormatter(); formatter.locale = locale; formatter.timeZone = TimeZone(secondsFromGMT: 7 * 3600)
        formatter.calendar = Calendar(identifier: .gregorian); formatter.dateFormat = "yyyy-MM-dd"; formatter.isLenient = false
        guard let start = formatter.date(from: day), formatter.string(from: start) == day else { throw Failure.invalidDate }
        return start..<start.addingTimeInterval(86400)
    }
}
