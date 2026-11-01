import Foundation

/// Display-only, process-local snapshots. Form/financial reads always go to the server.
struct WorkspaceReadCache {
    private struct Key: Hashable {
        let user: String
        let role: String
        let resource: String
        let query: String
    }
    private var entries: [Key: NativeReadResponse] = [:]
    private var order: [Key] = []
    private(set) var generation = 0
    private let resources: Set<String> = ["overview", "stores", "map", "refills", "inventory", "production", "settlements", "expenses", "reports", "operations", "fridges", "notifications", "audit"]
    private func key(resource: String, session: NativeSession, query: [String: String]) -> Key {
        var parts = URLComponents()
        parts.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        return Key(user: session.userId, role: session.role, resource: resource, query: parts.percentEncodedQuery ?? "")
    }
    func value(resource: String, session: NativeSession, query: [String: String]) -> NativeReadResponse? {
        guard session.source == "database", resources.contains(resource) else { return nil }
        return entries[key(resource: resource, session: session, query: query)]
    }
    mutating func store(_ response: NativeReadResponse, session: NativeSession, query: [String: String], generation: Int) {
        guard self.generation == generation, session.source == "database", response.source == "database",
              resources.contains(response.resource), (try? response.data.encoded().count) ?? Int.max <= 2 * 1024 * 1024 else { return }
        let key = key(resource: response.resource, session: session, query: query)
        order.removeAll { $0 == key }; order.append(key); entries[key] = response
        if order.count > 16 { entries.removeValue(forKey: order.removeFirst()) }
    }
    mutating func invalidate() { generation += 1; entries.removeAll(); order.removeAll() }
}

@MainActor protocol NativeReadSource: AnyObject {
    var session: NativeSession? { get }
    func cachedRead(_ resource: String, query: [String: String]) -> NativeReadResponse?
    func read(_ resource: String, query: [String: String]) async throws -> NativeReadResponse
}
