import SwiftUI

struct NativeSession: Codable, Equatable, Sendable {
    let userId: String
    let fullName: String
    let email: String
    let role: String
    let source: String
}

struct NativeReadResponse: Decodable, Sendable {
    let version: Int
    let resource: String
    let source: String
    let generatedAt: String
    let data: JSONValue
}

enum WorkDomain: String { case overview, stores, refills, inventory, finance, operations
    var color: Color {
        switch self { case .stores, .operations: Theme.blue; case .refills: Theme.green; case .inventory: Theme.purple; case .finance: Theme.mango; default: Theme.evergreen }
    }
}

enum Destination: String, CaseIterable, Identifiable {
    case overview, stores, map, refills, driver, settlements, inventory, production, expenses, reports, operations, fridges, notifications, audit
    var id: String { rawValue }
    var title: String {
        switch self {
        case .overview: "ພາບລວມ"; case .stores: "ຮ້ານຄ້າ"; case .map: "ແຜນທີ່"; case .refills: "ເຕີມສິນຄ້າ"
        case .driver: "ກວດຮ້ານ / ປິດຮອບ"; case .settlements: "ຮັບເງິນ"; case .inventory: "ວັດຖຸດິບ"; case .production: "ການຜະລິດ"
        case .expenses: "ລາຍຈ່າຍ"; case .reports: "ລາຍງານ"; case .operations: "ຈັດການລະບົບ"; case .fridges: "ຕູ້ແຊ່"
        case .notifications: "ແຈ້ງເຕືອນ"; case .audit: "ປະຫວັດການປ່ຽນແປງ"
        }
    }
    var symbol: String {
        switch self {
        case .overview: "square.grid.2x2"; case .stores: "storefront"; case .map: "map"; case .refills: "shippingbox"; case .driver: "checklist"
        case .settlements: "banknote"; case .inventory: "archivebox"; case .production: "cup.and.saucer"
        case .expenses: "receipt"; case .reports: "chart.bar.xaxis"; case .operations: "gearshape"; case .fridges: "refrigerator"
        case .notifications: "bell"; case .audit: "checkmark.shield"
        }
    }
    var domain: WorkDomain {
        switch self {
        case .stores, .map, .fridges: .stores; case .refills, .driver, .production: .refills; case .inventory: .inventory
        case .expenses, .reports, .settlements: .finance; case .operations, .audit: .operations; default: .overview
        }
    }
    func isAllowed(role: String) -> Bool {
        switch self {
        case .inventory, .production: return ["admin", "production"].contains(role)
        case .driver, .settlements: return ["admin", "driver"].contains(role)
        case .expenses, .reports, .operations, .fridges, .audit: return role == "admin"
        default: return ["admin", "driver", "production"].contains(role)
        }
    }
}

@MainActor final class FeatureState: ObservableObject {
    @Published var data: JSONValue = .null
    @Published var loading = false
    @Published var error: String?
    @Published var source = ""
    @Published var generatedAt = ""
    private weak var model: (any NativeReadSource)?
    private var resource = ""
    private var query: [String: String] = [:]
    private var generation = 0
    private var owner: String?
    func load(_ model: any NativeReadSource, _ resource: String, query: [String: String] = [:]) async {
        if self.resource != resource || self.query != query { data = .null; source = ""; generatedAt = "" }
        self.model = model; self.resource = resource; self.query = query
        await refresh()
    }
    private func scope(_ session: NativeSession?) -> String? {
        session.map { "\($0.userId):\($0.role):\($0.source)" }
    }
    func refresh() async {
        guard let model, !resource.isEmpty else { return }
        generation += 1; let request = generation
        let currentOwner = scope(model.session)
        if owner != currentOwner { data = .null; source = ""; generatedAt = ""; owner = currentOwner }
        if data == .null, let cached = model.cachedRead(resource, query: query) {
            data = cached.data; source = "cached"; generatedAt = cached.generatedAt
        }
        loading = true; error = nil
        do {
            let result = try await model.read(resource, query: query)
            guard generation == request else { return }
            guard scope(model.session) == currentOwner else { data = .null; source = ""; generatedAt = ""; loading = false; return }
            data = result.data; source = result.source; generatedAt = result.generatedAt
        } catch is CancellationError { }
        catch {
            guard generation == request else { return }
            guard scope(model.session) == currentOwner else { data = .null; source = ""; generatedAt = ""; loading = false; return }
            self.error = error.localizedDescription
            if data != .null { source = "stale" }
        }
        if generation == request { loading = false }
    }
}
