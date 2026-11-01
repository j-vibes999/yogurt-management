import Foundation

struct SessionCookie: Codable, Sendable {
    let value: String
    let expiresAt: Date
}

enum ScopedTransport {
    static func url(base: URL, path: String) throws -> URL {
        let route = path.split(separator: "?", maxSplits: 1).first.map(String.init) ?? ""
        guard route.hasPrefix("/api/"), !route.lowercased().contains("%2e"), !route.contains(".."),
              !path.contains("\r"), !path.contains("\n"),
              let url = URL(string: path, relativeTo: base)?.absoluteURL,
              url.scheme == "http", url.host == "127.0.0.1", url.port == base.port,
              url.user == nil, url.password == nil, url.fragment == nil else { throw NativeFailure("ທີ່ຢູ່ API ບໍ່ຖືກຕ້ອງ") }
        return url
    }
    static func sessionCookie(_ header: String) throws -> SessionCookie {
        let pieces = header.components(separatedBy: ";").map { $0.trimmingCharacters(in: .whitespaces) }
        guard let first = pieces.first, first.hasPrefix("yogurt_session="),
              pieces.contains(where: { $0.lowercased() == "httponly" }),
              pieces.contains(where: { $0.lowercased() == "secure" }),
              pieces.contains(where: { $0.lowercased() == "samesite=strict" }),
              pieces.contains(where: { $0.lowercased() == "path=/" }),
              !pieces.contains(where: { $0.lowercased().hasPrefix("domain=") }) else { throw NativeFailure("Session cookie ບໍ່ປອດໄພ") }
        let value = String(first.dropFirst("yogurt_session=".count))
        guard value.range(of: "^[A-Za-z0-9_.-]+$", options: .regularExpression) != nil, value.count < 8192 else { throw NativeFailure("Session cookie ບໍ່ຖືກຕ້ອງ") }
        let maxAge = pieces.first { $0.lowercased().hasPrefix("max-age=") }.flatMap { TimeInterval($0.dropFirst(8)) } ?? 43200
        guard maxAge > 0, maxAge <= 43200 else { throw NativeFailure("Session cookie ໝົດອາຍຸ") }
        return SessionCookie(value: value, expiresAt: Date().addingTimeInterval(maxAge))
    }
    /// The logout route answers the web form with 303 → /login after revoking the session.
    /// That reply is the success itself; it is never followed.
    static func isLogoutCompletion(path: String, status: Int, location: String?) -> Bool {
        path == "/api/auth/logout" && status == 303 && location == "/login"
    }
}

struct NativeReply: Sendable {
    let status: Int
    let data: JSONValue
    let bytes: Data
    let contentType: String
    var successful: Bool { (200..<300).contains(status) }
    var retryable: Bool? { if case .bool(let value) = data["retryable"] { return value }; return nil }
    var error: String { data["error"].text.isEmpty ? "ຄຳຂໍບໍ່ສຳເລັດ (\(status))" : data["error"].text }
}

/// The app's single transport. Requests keep their `/api/...` shape and session cookie, but are
/// answered in-process by the Swift engine: no loopback HTTP, capability token or child process.
actor APIClient {
    /// Paths are still validated as if relative to the old local origin; nothing connects to it.
    private static let validationBase = URL(string: "http://127.0.0.1:43188")!
    private let keychain: KeychainStore
    private var engine: SwiftEngine?
    private var cookie: SessionCookie?
    init(keychain: KeychainStore) { self.keychain = keychain }
    func configure(engine: SwiftEngine) async throws {
        self.engine = engine
        if let saved = try await keychain.read("session-cookie"), let stored = try? JSONDecoder().decode(SessionCookie.self, from: saved), stored.expiresAt > Date() { cookie = stored }
    }
    func detach() { engine = nil }
    func clearSession() async throws { cookie = nil; try await keychain.remove("session-cookie") }
    func send(path: String, method: String = "GET", body: Data? = nil, operationKey: String? = nil, userID: String? = nil, contentType: String = "application/json") async throws -> NativeReply {
        guard let engine else { throw NativeFailure("Backend ຍັງບໍ່ພ້ອມ") }
        _ = try ScopedTransport.url(base: Self.validationBase, path: path)
        var headers = ["Accept": "application/json"]
        if body != nil { headers["Content-Type"] = contentType }
        if let operationKey { headers["Idempotency-Key"] = operationKey }
        if let userID { headers["X-Operation-User"] = userID }
        if let cookie, cookie.expiresAt > Date() { headers["Cookie"] = "yogurt_session=\(cookie.value)" }
        let response = await engine.handle(EngineRequest(method: method, path: path, headers: headers, body: body ?? Data()))
        try Task.checkCancellation()
        let header = { (name: String) in response.headers.first { $0.key.lowercased() == name }?.value }
        let loggedOut = ScopedTransport.isLogoutCompletion(path: path, status: response.status, location: header("location"))
        guard !(300..<400).contains(response.status) || loggedOut else { throw NativeFailure("Backend redirect ຖືກປະຕິເສດ; ບໍ່ໄດ້ສົ່ງ session ໄປທີ່ອື່ນ") }
        guard response.body.count <= 25 * 1024 * 1024 else { throw NativeFailure("ຂໍ້ມູນຕອບກັບໃຫຍ່ເກີນໄປ") }
        if path == "/api/auth/login", (200..<300).contains(response.status) {
            guard let setCookie = header("set-cookie") else { throw NativeFailure("Backend ບໍ່ໄດ້ສົ່ງ session") }
            let next = try ScopedTransport.sessionCookie(setCookie)
            try await keychain.write(JSONEncoder().encode(next), account: "session-cookie"); cookie = next
        }
        if path == "/api/auth/logout", (200..<300).contains(response.status) || loggedOut { try await clearSession() }
        return NativeReply(status: loggedOut ? 200 : response.status, data: (try? JSONDecoder().decode(JSONValue.self, from: response.body)) ?? .null, bytes: response.body,
                           contentType: header("content-type") ?? "")
    }
}
