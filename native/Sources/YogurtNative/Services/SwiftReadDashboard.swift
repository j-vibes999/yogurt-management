import Foundation

/// Dashboard, notification alerts and navigation counts (db-data.ts getDashboardData /
/// getNotificationsData and the nav-counts route). Display numbers follow the original JS
/// Number projection; alert text formats numbers the way JS template strings did.
struct SwiftReadDashboard: Sendable {
    let projection: SwiftReadProjection
    private var connection: SwiftSQLConnection { projection.connection }
    private var now: Date { projection.now }

    /// The unredacted dashboard; callers apply role redactions.
    func dashboard() async throws -> JSONValue {
        let stores = try await projection.stores()
        let refills = try await projection.refills()
        let lowMaterials = try await projection.materials().map(SwiftReadProjection.materialDisplay).filter { $0["stock"].decimal <= $0["minStock"].decimal * Decimal(string: "1.5")! }
        let totals = try await connection.rows("""
        SELECT (SELECT COALESCE(SUM(gross_amount),0) FROM settlements WHERE settlement_date >= ($1::timestamptz AT TIME ZONE 'UTC')) AS gross,
               (SELECT COALESCE(SUM(net_payable_amount),0) FROM settlements WHERE settlement_date >= ($1::timestamptz AT TIME ZONE 'UTC')) AS net,
               (SELECT COALESCE(SUM(closing_balance),0) FROM (SELECT DISTINCT ON (store_id) closing_balance FROM settlements ORDER BY store_id,settlement_date DESC,id DESC) latest) AS outstanding
        """, [.string(SwiftServiceJSON.iso(now.addingTimeInterval(-7 * 86400)))])[0]
        return .object([
            "source": .string("database"), "stores": .array(stores), "settlements": .array([]), "refills": .array(refills), "lowMaterials": .array(lowMaterials),
            "weeklyGross": .number(totals["gross"].decimal), "ownerNet": .number(totals["net"].decimal), "outstanding": .number(totals["outstanding"].decimal),
            "cupsInStores": .number(SwiftServiceJSON.sum(stores, "stock")), "dueStores": .integer(stores.filter { $0["due"].bool }.count),
            "totalCapacity": .number(stores.reduce(0) { $0 + $1["fridge"]["capacityCups"].decimal }),
        ])
    }

    /// Alerts in the original order, before role filtering.
    func alerts(_ dashboard: JSONValue) async throws -> [JSONValue] {
        let extras = try await connection.rows("""
        SELECT
          (SELECT count(*) FROM production_batches WHERE status='completed' AND quantity_remaining>0 AND exp_date >= $1::timestamp AND exp_date <= $2::timestamp) AS "expiringCount",
          COALESCE((SELECT json_agg(x) FROM (SELECT batch_number AS "batchNumber",exp_date AS "expDate" FROM production_batches WHERE status='completed' AND quantity_remaining>0 AND exp_date >= $1::timestamp AND exp_date <= $2::timestamp ORDER BY exp_date,id LIMIT 4) x),'[]'::json) AS expiring,
          (SELECT count(*) FROM production_batches WHERE status='completed' AND quantity_remaining>0 AND exp_date < $1::timestamp) AS "expiredCount",
          COALESCE((SELECT json_agg(x) FROM (SELECT batch_number AS "batchNumber",quantity_remaining AS "quantityRemaining" FROM production_batches WHERE status='completed' AND quantity_remaining>0 AND exp_date < $1::timestamp ORDER BY exp_date,id LIMIT 4) x),'[]'::json) AS expired,
          COALESCE((SELECT json_agg(x) FROM (SELECT l.store_id AS "storeId",s.name AS "storeName",l.quantity_remaining AS quantity FROM fridge_stock_lots l JOIN fridges f ON f.id=l.fridge_id JOIN stores s ON s.id=l.store_id WHERE l.quantity_remaining>0 AND l.exp_date < $1::timestamp AND f.current_store_id IS NOT NULL AND f.current_store_id=l.store_id AND s.is_active LIMIT 500) x),'[]'::json) AS "expiredLots",
          (SELECT count(*) FROM fridges WHERE status='maintenance') AS "maintenanceCount",
          COALESCE((SELECT json_agg(x) FROM (SELECT f.asset_code AS "assetCode",s.name AS "storeName" FROM fridges f LEFT JOIN stores s ON s.id=f.current_store_id WHERE f.status='maintenance' ORDER BY f.asset_code LIMIT 4) x),'[]'::json) AS maintenance
        """, [.string(SwiftServiceJSON.iso(now)), .string(SwiftServiceJSON.iso(now.addingTimeInterval(7 * 86400)))])[0]
        var alerts: [JSONValue] = []
        func alert(_ id: String, _ type: String, _ title: String, _ detail: String, _ href: String) {
            alerts.append(.object(["id": .string(id), "type": .string(type), "title": .string(title), "detail": .string(detail), "href": .string(href)]))
        }
        let due = dashboard["stores"].array.filter { $0["due"].bool }
        for store in due.prefix(4) {
            let asset = store["fridge"] == .null ? "ບໍ່ມີຕູ້" : store["fridge"].text("assetCode")
            alert("due-store-\(store.id)", "urgent", "\(store.text("name")) ຮອດຮອບກວດ", "\(asset) · ຄົງເຫຼືອ \(try Self.js(store["stock"])) ຖ້ວຍ", "/driver/restock/\(store.id)")
        }
        if due.count > 4 { alert("due-stores-more", "urgent", "ອີກ \(due.count - 4) ຮ້ານຮອດຮອບກວດ", "ເປີດຄິວກວດຮ້ານທັງໝົດ", "/driver") }
        let waiting = dashboard["refills"].array.filter { ["waiting", "preparing"].contains($0.text("status")) }
        if !waiting.isEmpty { alert("refills", "urgent", "\(waiting.count) ຄຳຂໍເຕີມສິນຄ້າຕ້ອງຈັດການ", waiting.prefix(4).map { $0.text("storeName") }.joined(separator: " · "), "/refills") }
        for material in dashboard["lowMaterials"].array.prefix(5) {
            let unit = material.text("unit")
            alert("material-\(material.id)", "warning", "\(material.text("name")) ໃກ້ຈຸດສັ່ງຊື້", "ຄົງເຫຼືອ \(try Self.js(material["stock"])) \(unit) · ຈຸດແຈ້ງເຕືອນ \(try Self.js(material["minStock"])) \(unit)", "/inventory")
        }
        let outstanding = dashboard["outstanding"].decimal
        if outstanding > 0 { alert("receivables", "warning", "ຍອດຄ້າງຮັບ \(Self.localeString(outstanding)) LAK", "ຄິດຈາກຍອດຄົງຄ້າງຫຼ້າສຸດຂອງແຕ່ລະຮ້ານ", "/settlements") }
        var byStore: [String: (name: String, quantity: Decimal)] = [:]; var order: [String] = []
        for lot in extras["expiredLots"].array {
            let id = lot.text("storeId")
            if byStore[id] == nil { byStore[id] = (lot.text("storeName"), 0); order.append(id) }
            byStore[id]!.quantity += lot["quantity"].decimal
        }
        typealias Expired = (id: String, name: String, quantity: Decimal)
        let collected: [Expired] = order.map { id in (id, byStore[id]!.name, byStore[id]!.quantity) }
        let fridgeExpired = collected.sorted { (a: Expired, b: Expired) -> Bool in
            if a.quantity != b.quantity { return a.quantity > b.quantity }
            return a.name.compare(b.name, locale: Locale(identifier: "en_US")) == .orderedAscending
        }
        if !fridgeExpired.isEmpty {
            let detail = try fridgeExpired.prefix(4).map { "\($0.name) · \(try Self.js(.number($0.quantity))) ຖ້ວຍ" }.joined(separator: " · ")
            alert("expired-in-fridges", "urgent", "ອາດມີສິນຄ້າໝົດອາຍຸຄ້າງໃນຕູ້ \(fridgeExpired.count) ຮ້ານ", "\(detail) · ກວດ ແລະເກັບຄືນໃນຮອບກວດ", fridgeExpired.count == 1 ? "/driver/restock/\(fridgeExpired[0].id)" : "/driver")
        }
        if extras["expiredCount"].decimal > 0 {
            let detail = try extras["expired"].array.map { "\($0.text("batchNumber")) · ເຫຼືອ \(try Self.js($0["quantityRemaining"])) ຖ້ວຍ" }.joined(separator: " · ")
            alert("expired-batches", "warning", "\(extras.text("expiredCount")) ລັອດຜະລິດໝົດອາຍຸແລ້ວ ແຕ່ຍັງມີຄົງເຫຼືອໃນສາງ", "\(detail) · ບັນທຶກຕັດຖິ້ມເພື່ອໃຫ້ຍອດສາງ ແລະຕົ້ນທຶນຖືກຕ້ອງ", "/production")
        }
        if extras["expiringCount"].decimal > 0 {
            let detail = try extras["expiring"].array.map { "\($0.text("batchNumber")) · \(Int(ceil(try SwiftServiceJSON.date($0["expDate"]).timeIntervalSince(now) / 86400))) ມື້" }.joined(separator: " · ")
            alert("expiring", "warning", "\(extras.text("expiringCount")) ລັອດຜະລິດໃກ້ໝົດອາຍຸ", detail, "/production")
        }
        if extras["maintenanceCount"].decimal > 0 {
            let detail = extras["maintenance"].array.map { "\($0.text("assetCode")) · \($0["storeName"] == .null ? "—" : $0.text("storeName"))" }.joined(separator: " · ")
            alert("maintenance", "info", "\(extras.text("maintenanceCount")) ຕູ້ຢູ່ສະຖານະບຳລຸງຮັກສາ", detail, "/fridges")
        }
        if alerts.isEmpty { alert("all-clear", "info", "ບໍ່ມີລາຍການດ່ວນ", "ສິນຄ້າຄົງເຫຼືອ, ການເຕີມສິນຄ້າ, ຍອດຄ້າງ ແລະຕູ້ແຊ່ບໍ່ມີສັນຍານເຕືອນໃນຂະນະນີ້", "/") }
        return alerts
    }

    /// access-policy.ts canRoleOpen: hide alerts whose page the role cannot open.
    static func canOpen(_ role: String, _ href: String) -> Bool {
        let path = String(href.split(whereSeparator: { $0 == "?" || $0 == "#" }).first ?? "")
        var allowed: [String]?
        if path.hasPrefix("/uploads/receipts/") { allowed = ["admin"] }
        else if path.hasPrefix("/production") || path.hasPrefix("/inventory") { allowed = ["admin", "production"] }
        else if path.hasPrefix("/driver") || path.hasPrefix("/settlements") { allowed = ["admin", "driver"] }
        else if ["/expenses", "/reports", "/audit-log", "/operations"].contains(where: path.hasPrefix) { allowed = ["admin"] }
        else if path.hasPrefix("/stores/new") || path.range(of: "^/stores/[^/]+/edit$", options: .regularExpression) != nil || path.hasPrefix("/fridges") { allowed = ["admin"] }
        else if path.hasPrefix("/refills/new") { allowed = ["admin", "driver"] }
        return allowed.map { $0.contains(role) } ?? true
    }
    static func notifications(_ alerts: [JSONValue], role: String) -> JSONValue {
        .object(["source": .string("database"), "alerts": .array(alerts.filter { canOpen(role, $0.text("href")) })])
    }

    func navigationCounts() async throws -> JSONValue {
        let row = try await connection.rows("""
        SELECT (SELECT count(*) FROM refill_requests WHERE status IN ('waiting','preparing','delivering')) AS refill,
               (SELECT count(*) FROM raw_materials WHERE is_active=true AND current_stock <= min_stock_alert) AS inventory,
               (SELECT count(*) FROM (SELECT DISTINCT ON (store_id) store_id,closing_balance FROM settlements ORDER BY store_id,settlement_date DESC,id DESC) x WHERE closing_balance>0) AS settlements,
               (SELECT count(*) FROM stores s LEFT JOIN LATERAL (SELECT visit_date FROM restock_visits r WHERE r.store_id=s.id AND r.status='completed' ORDER BY visit_date DESC LIMIT 1) v ON true
                WHERE s.is_active=true AND (v.visit_date IS NULL OR v.visit_date < (NOW() AT TIME ZONE 'UTC')-INTERVAL '7 days')) AS driver
        """)[0]
        return .object(["refill": row["refill"], "inventory": row["inventory"], "settlements": row["settlements"], "driver": row["driver"]])
    }

    /// `${number}` in a JS template string.
    static func js(_ value: JSONValue) throws -> String { try SwiftValue.canonicalPayload(.number(value.decimal)) }
    /// Number.prototype.toLocaleString() in en-US: grouped, at most three fraction digits, ties away from zero.
    static func localeString(_ value: Decimal) -> String {
        var source = value, rounded = Decimal()
        NSDecimalRound(&rounded, &source, 3, .plain)
        let text = NSDecimalNumber(decimal: rounded).stringValue
        let negative = text.hasPrefix("-")
        let parts = (negative ? String(text.dropFirst()) : text).split(separator: ".", maxSplits: 1)
        var whole = String(parts[0]), grouped = ""
        while whole.count > 3 { grouped = "," + whole.suffix(3) + grouped; whole.removeLast(3) }
        return (negative ? "-" : "") + whole + grouped + (parts.count > 1 ? "." + parts[1] : "")
    }
}
