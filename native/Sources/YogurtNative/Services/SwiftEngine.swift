import Foundation

/// One `/api/...` request as the app's APIClient sends it. Header names are lowercased.
struct EngineRequest: Sendable {
    let method: String
    let path: String
    let headers: [String: String]
    let body: Data
    init(method: String, path: String, headers: [String: String] = [:], body: Data = Data()) {
        self.method = method.uppercased(); self.path = path; self.body = body
        self.headers = Dictionary(headers.map { ($0.key.lowercased(), $0.value) }, uniquingKeysWith: { _, last in last })
    }
    func header(_ name: String) -> String? { headers[name.lowercased()] }
    /// The signed session cookie value, if any.
    var sessionToken: String? {
        guard let cookie = header("cookie") else { return nil }
        for part in cookie.split(separator: ";") {
            let pair = part.trimmingCharacters(in: .whitespaces).split(separator: "=", maxSplits: 1)
            if pair.count == 2, pair[0] == "yogurt_session" { return String(pair[1]) }
        }
        return nil
    }
}

struct EngineResponse: Sendable {
    let status: Int
    let headers: [String: String]
    let body: Data
    static func json(_ status: Int, _ value: JSONValue, headers: [String: String] = [:]) -> EngineResponse {
        let data = (try? value.encoded()) ?? Data("{}".utf8)
        return .init(status: status, headers: headers.merging(["Content-Type": "application/json"], uniquingKeysWith: { current, _ in current }), body: data)
    }
    static func reply(_ reply: SwiftServiceReply) -> EngineResponse {
        reply.data == .null && reply.status == 303 ? .init(status: reply.status, headers: reply.headers, body: Data()) : json(reply.status, reply.data, headers: reply.headers)
    }
    static func failure(_ failure: SwiftServiceFailure) -> EngineResponse {
        var fields = failure.details
        fields["error"] = .string(failure.message)
        if let retryable = failure.retryable { fields["retryable"] = .bool(retryable) }
        return json(failure.status, .object(fields))
    }
}

/// Answers the app's existing `/api/...` routes in-process with the Swift services, applying the
/// same admission order as the old Next middleware. There is no HTTP listener.
final class SwiftEngine: Sendable {
    let configuration: BackendConfiguration
    let dataRoot: URL
    let database: SwiftDatabase
    let authentication: SwiftAuthentication
    let reads: SwiftReadService
    let commands: SwiftCommandRouter

    init(configuration: BackendConfiguration, dataRoot: URL, verification: Bool) throws {
        self.configuration = configuration; self.dataRoot = dataRoot
        database = try SwiftDatabase(configuration: configuration, verification: verification)
        authentication = SwiftAuthentication(database: database, configuration: configuration)
        reads = SwiftReadService(database: database, authentication: authentication, configuration: configuration, dataRoot: dataRoot)
        commands = SwiftCommandRouter(database: database, authentication: authentication, dataRoot: dataRoot)
    }
    func start() async throws { try await database.start() }
    func stop() async { await database.stop() }

    func handle(_ request: EngineRequest) async -> EngineResponse {
        do { return try await route(request) }
        catch let failure as SwiftServiceFailure { return .failure(failure) }
        catch is CancellationError { return .json(503, .object(["error": .string("ຄຳຂໍຖືກຍົກເລີກ"), "retryable": .bool(true)])) }
        catch let error as SwiftDatabaseError where error.isUnavailable {
            return .json(503, .object(["error": .string("ຖານຂໍ້ມູນໃຊ້ງານບໍ່ໄດ້ຊົ່ວຄາວ; ກະລຸນາລອງໃໝ່ໃນພາຍຫຼັງ"), "retryable": .bool(true)]))
        }
        catch { return .json(500, .object(["error": .string("ລະບົບຂັດຂ້ອງ. ກະລຸນາລອງໃໝ່")])) }
    }

    private static let publicPaths: Set<String> = ["/api/auth/login", "/api/auth/logout", "/api/session", "/api/health"]

    private func route(_ request: EngineRequest) async throws -> EngineResponse {
        guard let components = URLComponents(string: "http://engine" + request.path), components.path.hasPrefix("/") else {
            return .json(404, .object(["error": .string("ບໍ່ພົບ")]))
        }
        var path = components.path
        // Legacy receipt links resolve to the protected API before any other check.
        if path.hasPrefix("/uploads/receipts/") { path = "/api/receipts/" + path.dropFirst("/uploads/receipts/".count) }
        let method = request.method, token = request.sessionToken, items = components.queryItems ?? []

        if !Self.publicPaths.contains(path) {
            guard let signed = SwiftCredentials.verifySession(token, secret: configuration.sessionSecret) else {
                return .json(401, .object(["error": .string("ກະລຸນາເຂົ້າລະບົບກ່ອນ")]))
            }
            if !["GET", "HEAD", "OPTIONS"].contains(method), let expected = request.header("x-operation-user"), expected != signed.text("userId") {
                return .json(409, .object(["error": .string("ບັນຊີຜູ້ໃຊ້ປ່ຽນແປງ; ກະລຸນາໂຫຼດໜ້າຄືນ"), "retryable": .bool(true)]))
            }
        }
        switch (method, path) {
        case ("GET", "/api/session"): return .reply(try await authentication.session(token: token))
        case ("POST", "/api/auth/login"):
            let body = (try? JSONDecoder().decode(JSONValue.self, from: request.body)) ?? .null
            return .reply(try await authentication.login(body: body, ip: "local", userAgent: request.header("user-agent")))
        case ("POST", "/api/auth/logout"): return .reply(try await authentication.logout(token: token))
        case ("GET", "/api/health"): return .json(200, .object(["ok": .bool(true)]))
        case ("GET", "/api/nav-counts"): return .reply(try await reads.navigationCounts(token: token))
        case ("GET", "/api/map/search"):
            _ = try await authentication.authorize(token: token)
            return try await SwiftPlaceSearch.search(items.first(where: { $0.name == "q" })?.value ?? "")
        default: break
        }
        if method == "GET", path.hasPrefix("/api/native/v1/") {
            return .reply(try await reads.load(resource: String(path.dropFirst("/api/native/v1/".count)), queryItems: items, token: token))
        }
        let command = SwiftCommandRequest(method: method, path: path, headers: request.headers, body: request.body, token: token)
        if let response = try await commands.handle(command) { return response }
        return .json(404, .object(["error": .string("ບໍ່ພົບ")]))
    }
}

/// map/search: OpenStreetMap Nominatim, bounded and without forwarding any app credentials.
enum SwiftPlaceSearch {
    static func search(_ raw: String) async throws -> EngineResponse {
        let query = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if query.isEmpty { return .json(200, .object(["results": .array([])])) }
        if query.utf16.count > 180 { return .json(400, .object(["error": .string("ຄຳຄົ້ນຫາຍາວເກີນໄປ")])) }
        var endpoint = URLComponents(string: "https://nominatim.openstreetmap.org/search")!
        endpoint.queryItems = [.init(name: "format", value: "jsonv2"), .init(name: "q", value: query), .init(name: "countrycodes", value: "la"),
                               .init(name: "limit", value: "5"), .init(name: "addressdetails", value: "0")]
        var request = URLRequest(url: endpoint.url!, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 8)
        request.setValue("YogurtSuperWeb/1.0 local-business-map", forHTTPHeaderField: "User-Agent")
        request.setValue("lo,en;q=0.8", forHTTPHeaderField: "Accept-Language")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) == true, data.count <= 2_000_000 else { throw URLError(.badServerResponse) }
            let rows = try JSONDecoder().decode(JSONValue.self, from: data).array
            let results = rows.filter { Double($0.text("lat"))?.isFinite == true && Double($0.text("lon"))?.isFinite == true }
                .map { JSONValue.object(["place_id": $0["place_id"], "display_name": $0["display_name"], "lat": $0["lat"], "lon": $0["lon"]]) }
            return .json(200, .object(["results": .array(results)]))
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            return .json(502, .object(["error": .string("ບໍລິການຄົ້ນຫາແຜນທີ່ບໍ່ພ້ອມໃຊ້ຊົ່ວຄາວ")]))
        }
    }
}
