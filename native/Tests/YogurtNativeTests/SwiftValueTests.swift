import XCTest
@testable import YogurtNative

final class SwiftValueTests: XCTestCase {
    func testDecimalParsingAndRoundingStayExact() throws {
        let value = try SwiftValue.decimal("9007199254740993.125")
        XCTAssertEqual(try SwiftValue.decimalString(value, scale: 2), "9007199254740993.13")
        XCTAssertEqual(try SwiftValue.decimalString(SwiftValue.decimal("-1.005"), scale: 2), "-1.01")
        XCTAssertEqual(try SwiftValue.decimalString(SwiftValue.decimal("0.000001"), scale: 6), "0.000001")
        XCTAssertThrowsError(try SwiftValue.decimal("123456789012345678901234567890123456789012345678901"))
        for text in ["NaN", "Infinity", "1,2", "1e2", " 1", "1."] { XCTAssertThrowsError(try SwiftValue.decimal(text)) }
    }

    // Generated from the unmodified src/lib/idempotency.ts stablePayload implementation in Node.
    func testCanonicalPayloadMatchesJavaScriptEscapesKeyOrderingAndNegativeZero() throws {
        let payload: JSONValue = .object([
            "z": .number(Decimal(-0.0)), "a": .string("ລາວ/\u{2028}\u{2029}\u{8}\n"),
            "nested": .object(["Z": .integer(1), "a": .integer(2), "A": .integer(3), "ä": .integer(4), "10": .integer(10), "2": .integer(2)])
        ])
        XCTAssertEqual(try SwiftValue.canonicalPayload(payload), "{\"a\":\"ລາວ/\u{2028}\u{2029}\\b\\n\",\"nested\":{\"2\":2,\"10\":10,\"a\":2,\"A\":3,\"ä\":4,\"Z\":1},\"z\":0}")
        XCTAssertEqual(try SwiftValue.requestHash(payload), "b0b25d7bec376e3b6ab875bb702c40892be5dc6422d68b3536ad4630f96e0a6d")
    }

    func testCanonicalPayloadUsesJavaScriptNumberFormattingAndUnicodeCollation() throws {
        let numbers: JSONValue = .object(["n": .array(["0.0000001", "0.000001", "100000000000000000000", "1000000000000000000000", "1.2345678901234567"].map { .number(Decimal(string: $0)!) })])
        XCTAssertEqual(try SwiftValue.canonicalPayload(numbers), "{\"n\":[1e-7,0.000001,100000000000000000000,1e+21,1.2345678901234567]}")
        XCTAssertEqual(try SwiftValue.requestHash(numbers), "23a296eadf3f898002fd744a6ec69b854c389cf0a90db0d1ba0b4d4b81d1faf1")
        XCTAssertEqual(try SwiftValue.requestHash(.object(["é": .integer(1), "e": .integer(2), "É": .integer(3), "💚": .integer(4), "😀": .integer(5)])), "9b38abd36a0b835ee5aaf62b158205098b0d7f47fdb729487c824846514f674f")
    }

    func testJSONDecoderRejectsUnrepresentableNumbersInsteadOfSilentlyRounding() throws {
        let decoded = try SwiftValue.decodeJSON(Data("{\"amount\":9007199254740993.123456,\"scientific\":1e-6,\"text\":\"12345678901234567890123456789012345678901234567890\"}".utf8))
        XCTAssertEqual(decoded["amount"], .number(try SwiftValue.decimal("9007199254740993.123456")))
        XCTAssertEqual(decoded["scientific"], .number(try SwiftValue.decimal("0.000001")))
        XCTAssertThrowsError(try SwiftValue.decodeJSON(Data("{\"amount\":12345678901234567890123456789012345678901234567890}".utf8)))
        XCTAssertThrowsError(try SwiftValue.decodeJSON(Data("{\"amount\":1e-200}".utf8)))
    }

    func testStrictIDsAndHalfOpenLaosDays() throws {
        XCTAssertEqual(try SwiftValue.safeID("A_1-z"), "A_1-z")
        for id in ["", "a\n", "../a", "a b", "' OR true", String(repeating: "a", count: 201)] { XCTAssertThrowsError(try SwiftValue.safeID(id)) }
        let range = try SwiftValue.laosDayRange("2024-02-29")
        XCTAssertEqual(range.lowerBound, try SwiftValue.utcDate("2024-02-28T17:00:00Z"))
        XCTAssertEqual(range.upperBound, try SwiftValue.utcDate("2024-02-29T17:00:00Z"))
        XCTAssertThrowsError(try SwiftValue.laosDayRange("2023-02-29"))
        XCTAssertThrowsError(try SwiftValue.laosDayRange("2024-2-29"))
        XCTAssertThrowsError(try SwiftValue.utcDate("2024-02-29"))
        XCTAssertThrowsError(try SwiftValue.utcDate("2024-02-30T00:00:00Z"))
        XCTAssertThrowsError(try SwiftValue.utcDate("2024-02-29T00:00:00Z\n"))
    }
}
