import XCTest
@testable import YogurtNative

final class InventoryPresentationTests: XCTestCase {
    private func material(_ id: String, name: String, stock: String, minimum: String, category: String = "ingredient") -> JSONValue {
        .fromStrings(["id": id, "code": "RM-" + id, "name": name, "stock": stock, "minStock": minimum, "unit": "kg", "category": category])
    }
    func testStockStatesUseExactThresholdAndDistinguishEmptyFromLow() {
        XCTAssertEqual(InventoryStockState(material("zero", name: "A", stock: "0", minimum: "0")), .empty)
        XCTAssertEqual(InventoryStockState(material("equal", name: "B", stock: "0.125", minimum: "0.125")), .low)
        XCTAssertEqual(InventoryStockState(material("above", name: "C", stock: "0.125001", minimum: "0.125")), .available)
    }
    func testSearchCategoryAndStockFiltersCombineWithoutChangingAmounts() {
        let rows = [material("milk", name: "Milk powder", stock: "0.123456", minimum: "5"), material("cup", name: "Milk cups", stock: "10", minimum: "20", category: "packaging"), material("full", name: "Milk", stock: "30", minimum: "5")]
        let result = inventoryRows(rows, query: "  MILK  ", category: "ingredient", status: "low", order: "name")
        XCTAssertEqual(result.map(\.id), ["milk"])
        XCTAssertEqual(result[0].text("stock"), "0.123456")
        XCTAssertEqual(inventoryRows(rows, query: "RM-cup", category: "all", status: "all", order: "name").map(\.id), ["cup"])
        XCTAssertTrue(inventoryRows(rows, query: "missing", category: "all", status: "all", order: "name").isEmpty)
    }
    func testAttentionOrderShowsEmptyThenLowThenAvailableWithStableTies() {
        let rows = [material("a", name: "A", stock: "100", minimum: "5"), material("b", name: "B", stock: "1", minimum: "5"), material("c", name: "C", stock: "0", minimum: "5")]
        XCTAssertEqual(inventoryRows(rows, query: "", category: "all", status: "all", order: "attention").map(\.id), ["c", "b", "a"])
        XCTAssertEqual(inventoryRows(rows, query: "", category: "all", status: "available", order: "name").map(\.id), ["a"])
    }
}
