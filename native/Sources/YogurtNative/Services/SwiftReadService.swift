import Foundation

/// The native read API (`/api/native/v1/{resource}` and nav counts). Every load authorizes the
/// current database session and role inside the same read transaction as its projections.
struct SwiftReadService: Sendable {
    static let roles: [String: Set<String>] = {
        let all: Set<String> = ["admin", "production", "driver"], production: Set<String> = ["admin", "production"]
        let delivery: Set<String> = ["admin", "driver"], admin: Set<String> = ["admin"]
        return ["overview": all, "stores": all, "store": all, "map": all, "refills": all, "restock": delivery, "inventory": production,
                "production": production, "settlements": delivery, "expenses": admin, "expense": admin, "reports": admin,
                "notifications": all, "operations": admin, "fridges": admin, "audit": admin, "catalog": all, "closing": admin]
    }()
    static let headers = ["Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff"]

    let database: SwiftDatabase
    let authentication: SwiftAuthentication
    let configuration: BackendConfiguration
    let dataRoot: URL

    func load(resource: String, queryItems: [URLQueryItem], token: String?) async throws -> SwiftServiceReply {
        let now = Date()
        let result: (source: String, data: JSONValue)
        do {
            result = try await database.transaction { connection in
                let user = try await authentication.authorize(token: token, connection: connection)
                guard let allowed = Self.roles[resource] else { throw SwiftServiceFailure(status: 404, message: "ບໍ່ພົບໜ້າຂໍ້ມູນ") }
                guard allowed.contains(user.role) else { throw SwiftServiceFailure(status: 403, message: "ບໍ່ມີສິດເບິ່ງຂໍ້ມູນນີ້") }
                let query = try SwiftNativeQuery(resource: resource, items: queryItems)
                let projection = SwiftReadProjection(connection: connection, now: now, role: user.role)
                return try await load(resource, query: query, projection: projection)
            }
        } catch let failure as SwiftServiceFailure {
            throw failure
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            // Never surface connection or SQL detail; the client offers a retry.
            throw SwiftServiceFailure(status: 503, message: "ໂຫຼດຂໍ້ມູນບໍ່ສຳເລັດ. ກະລຸນາລອງໃໝ່", retryable: true)
        }
        return .init(data: .object(["version": .integer(1), "resource": .string(resource), "source": .string(result.source),
                                    "generatedAt": .string(SwiftServiceJSON.iso(Date())), "data": result.data]), headers: Self.headers)
    }

    func navigationCounts(token: String?) async throws -> SwiftServiceReply {
        do {
            let counts = try await database.transaction { connection in
                _ = try await authentication.authorize(token: token, connection: connection)
                return try await SwiftReadDashboard(projection: SwiftReadProjection(connection: connection, now: Date(), role: "")).navigationCounts()
            }
            return .init(data: counts)
        } catch let failure as SwiftServiceFailure where failure.status == 401 {
            throw SwiftServiceFailure(status: 401, message: "ບໍ່ມີສິດເຂົ້າໃຊ້")
        }
    }

    /// Mirrors native-data.ts loadNativeData; `source` is the envelope source.
    private func load(_ resource: String, query: SwiftNativeQuery, projection: SwiftReadProjection) async throws -> (source: String, data: JSONValue) {
        let role = projection.role
        func database(_ fields: [String: JSONValue]) -> (String, JSONValue) {
            ("database", .object(fields.merging(["source": .string("database")], uniquingKeysWith: { _, new in new })))
        }
        switch resource {
        case "overview":
            let dashboardReader = SwiftReadDashboard(projection: projection)
            let dashboard = try await dashboardReader.dashboard()
            let alerts = try await dashboardReader.alerts(dashboard)
            var redacted = dashboard.object
            if role != "admin" { redacted["ownerNet"] = .integer(0) }
            if role == "driver" { redacted["lowMaterials"] = .array([]) }
            if role == "production" { redacted["outstanding"] = .integer(0) }
            return ("database", .object(["dashboard": .object(redacted), "notifications": SwiftReadDashboard.notifications(alerts, role: role)]))
        case "notifications":
            let dashboardReader = SwiftReadDashboard(projection: projection)
            let alerts = try await dashboardReader.alerts(try await dashboardReader.dashboard())
            return ("database", SwiftReadDashboard.notifications(alerts, role: role))
        case "stores": return database(["stores": .array(try await projection.stores())])
        case "store": return ("database", try await projection.storeDetail(id: query["id"]!))
        case "map": return ("database", try await projection.map())
        case "refills": return database(["refills": .array(try await projection.refills(id: query["id"]))])
        case "restock": return ("database", try await projection.restock(id: query["id"]!))
        case "inventory":
            let rawMaterials = try await projection.materials()
            return database(["rawMaterials": .array(rawMaterials), "materials": .array(rawMaterials.map(SwiftReadProjection.materialDisplay))])
        case "production": return ("database", try await projection.production(query))
        case "settlements": return ("database", try await projection.settlements(query))
        case "expenses": return ("database", try await projection.expenses(query))
        case "expense": return ("database", try await projection.expense(id: query["id"]!))
        case "reports":
            let period = query["period"] ?? "month"
            return ("database", try await SwiftReadReports.load(projection.connection, period: period, now: projection.now))
        case "operations":
            return database(["products": .array(try await projection.products(all: true)), "materials": .array(try await projection.materials(all: true)),
                             "recipes": .array(try await projection.recipes()), "backup": SwiftBackupReadiness.load(dataRoot: dataRoot, configuration: configuration)])
        case "fridges":
            return database(["fridges": .array(try await projection.fridges()), "stores": .array(try await projection.storeOptions())])
        case "audit": return ("database", try await projection.audit(query))
        case "catalog":
            let stores = role == "production" ? [] : try await projection.storeOptions(fridge: true)
            let products = try await projection.products().map { JSONValue.object(["id": $0["id"], "code": $0["code"], "name": $0["name"], "retailPrice": $0["retailPrice"], "shelfLifeDays": $0["shelfLifeDays"]]) }
            let categories = role == "admin" ? try await projection.connection.rows("SELECT id,name FROM expense_categories ORDER BY created_at ASC,name ASC") : []
            return database(["stores": .array(stores), "products": .array(products), "materials": .array(role == "driver" ? [] : try await projection.materials()),
                             "recipes": .array(role == "driver" ? [] : try await projection.recipes()), "categories": .array(categories)])
        case "closing": return ("database", try await projection.closing(query["date"]!))
        default: throw SwiftServiceFailure(status: 404, message: "ບໍ່ພົບໜ້າຂໍ້ມູນ")
        }
    }
}
