import Foundation

enum InventoryStockState: Int {
    case empty, low, available
    init(_ row: JSONValue) {
        if row["stock"].decimal <= 0 { self = .empty }
        else if row["stock"].decimal <= row["minStock"].decimal { self = .low }
        else { self = .available }
    }
}

/// Presentation only: keep the original amounts and server snapshots intact.
func inventoryRows(_ materials: [JSONValue], query: String, category: String, status: String, order: String) -> [JSONValue] {
    let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
    return materials.filter { row in
        (query.isEmpty || ["name", "code", "unit"].contains { row.text($0).localizedCaseInsensitiveContains(query) }) &&
        (category == "all" || row.text("category") == category) &&
        (status == "all" || (status == "low" ? InventoryStockState(row) != .available : InventoryStockState(row) == .available))
    }.sorted { lhs, rhs in
        if order == "attention", InventoryStockState(lhs) != InventoryStockState(rhs) { return InventoryStockState(lhs).rawValue < InventoryStockState(rhs).rawValue }
        let names = lhs.text("name").localizedStandardCompare(rhs.text("name"))
        return names == .orderedSame ? lhs.id < rhs.id : names == .orderedAscending
    }
}
