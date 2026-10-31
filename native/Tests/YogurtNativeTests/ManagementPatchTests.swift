import XCTest
@testable import YogurtNative

final class ManagementPatchTests: XCTestCase {
    func testMaterialNameEditPreservesCostChangedByConcurrentReceipt() {
        let opened = JSONValue.object(["name": .string("Milk"), "minStock": .string("10.000"), "avgCostPerUnit": .string("120.3400")])
        let values: [String: JSONValue] = ["name": .string("Fresh milk"), "minStock": .string("10"), "avgCostPerUnit": .string("120.34")]
        let patch = mgEditPatch(original: opened, values: values, numeric: ["minStock", "avgCostPerUnit"])
        XCTAssertEqual(patch, ["name": .string("Fresh milk")])

        var afterReceipt = opened.object
        afterReceipt["avgCostPerUnit"] = .string("127.6250")
        let afterMetadataEdit = afterReceipt.merging(patch) { _, changed in changed }
        XCTAssertEqual(afterMetadataEdit["avgCostPerUnit"], .string("127.6250"))
        XCTAssertEqual(afterMetadataEdit["name"], .string("Fresh milk"))
    }

    func testProductMetadataEditPreservesNewerPriceAndShelfLife() {
        let opened = JSONValue.object(["code": .string("YG-01"), "name": .string("Yogurt"), "retailPrice": .string("15000.00"), "shelfLifeDays": .number(21), "isActive": .bool(true)])
        let values: [String: JSONValue] = ["code": .string("YG-01"), "name": .string("Plain yogurt"), "retailPrice": .string("15000"), "shelfLifeDays": .string("021"), "isActive": .bool(true)]
        let patch = mgEditPatch(original: opened, values: values, numeric: ["retailPrice", "shelfLifeDays"])
        XCTAssertEqual(patch, ["name": .string("Plain yogurt")])

        var newer = opened.object
        newer["retailPrice"] = .string("16000.25")
        newer["shelfLifeDays"] = .number(14)
        newer["isActive"] = .bool(false)
        let afterMetadataEdit = newer.merging(patch) { _, changed in changed }
        XCTAssertEqual(afterMetadataEdit["retailPrice"], .string("16000.25"))
        XCTAssertEqual(afterMetadataEdit["shelfLifeDays"], .number(14))
        XCTAssertEqual(afterMetadataEdit["isActive"], .bool(false))
    }

    func testIntentionalExactDecimalAndStatusChangesAreRetained() {
        let opened = JSONValue.object(["avgCostPerUnit": .string("99999999.1234"), "retailPrice": .string("9999999999.98"), "isActive": .bool(true)])
        let values: [String: JSONValue] = ["avgCostPerUnit": .string("99999999.1235"), "retailPrice": .string("9999999999.99"), "isActive": .bool(false)]
        XCTAssertEqual(mgEditPatch(original: opened, values: values, numeric: ["avgCostPerUnit", "retailPrice"]), values)
    }

    func testEquivalentDecimalFormattingAndWhitespaceAreNoOp() {
        let opened = JSONValue.object(["stock": .string("12.34"), "avgCostPerUnit": .string("0.0001"), "name": .string("Milk")])
        let values: [String: JSONValue] = ["stock": .string("0012.3400"), "avgCostPerUnit": .string("0.000100"), "name": .string("  Milk  ")]
        XCTAssertTrue(mgEditPatch(original: opened, values: values, numeric: ["stock", "avgCostPerUnit"]).isEmpty)
    }

    func testEmptyOptionalDescriptionClearsToNull() {
        let opened = JSONValue.object(["sizeDescription": .string("74 g")])
        let patch = mgEditPatch(original: opened, values: ["sizeDescription": .string("  ")], numeric: [], nullable: ["sizeDescription"])
        XCTAssertEqual(patch, ["sizeDescription": .null])
        XCTAssertTrue(mgEditPatch(original: .object(["sizeDescription": .null]), values: ["sizeDescription": .string("")], numeric: [], nullable: ["sizeDescription"]).isEmpty)
    }
}
