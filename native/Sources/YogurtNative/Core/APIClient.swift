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

private final class NoRedirectDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
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

actor APIClient {
    private let base: URL
    private let keychain: KeychainStore
    private var capability = ""
    private var cookie: SessionCookie?
    private let delegate = NoRedirectDelegate()
    private let transport: URLSession
    init(port: Int = 43188, keychain: KeychainStore) {
        self.base = URL(string: "http://127.0.0.1:\(port)")!; self.keychain = keychain
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false; configuration.httpCookieStorage = nil; configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData; configuration.timeoutIntervalForRequest = 35; configuration.timeoutIntervalForResource = 65
        transport = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
    }
    func configure(capability: String) async throws {
        guard capability.count >= 32 else { throw NativeFailure("Backend capability ບໍ່ຖືກຕ້ອງ") }
        self.capability = capability
        if let saved = try await keychain.read("session-cookie"), let stored = try? JSONDecoder().decode(SessionCookie.self, from: saved), stored.expiresAt > Date() { cookie = stored }
    }
    func clearSession() async throws { cookie = nil; try await keychain.remove("session-cookie") }
    func send(path: String, method: String = "GET", body: Data? = nil, operationKey: String? = nil, userID: String? = nil, contentType: String = "application/json") async throws -> NativeReply {
        guard !capability.isEmpty else { throw NativeFailure("Backend ຍັງບໍ່ພ້ອມ") }
        let url = try ScopedTransport.url(base: base, path: path)
        var request = URLRequest(url: url); request.httpMethod = method; request.httpBody = body
        request.setValue(capability, forHTTPHeaderField: "x-yogurt-desktop-token")
        request.setValue(base.absoluteString, forHTTPHeaderField: "Origin")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { request.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        if let operationKey { request.setValue(operationKey, forHTTPHeaderField: "Idempotency-Key") }
        if let userID { request.setValue(userID, forHTTPHeaderField: "X-Operation-User") }
        if let cookie, cookie.expiresAt > Date() { request.setValue("yogurt_session=\(cookie.value)", forHTTPHeaderField: "Cookie") }
        let data: Data; let response: URLResponse
        do { (data, response) = try await transport.data(for: request) }
        catch is CancellationError { throw CancellationError() }
        catch { throw NativeFailure("ຕິດຕໍ່ backend ບໍ່ໄດ້. ລາຍການທີ່ສົ່ງແລ້ວອາດບັນທຶກສຳເລັດ; ກວດກາລາຍການຄ້າງກ່ອນສົ່ງໃໝ່") }
        guard let http = response as? HTTPURLResponse, response.url == url else { throw NativeFailure("Backend redirect ຖືກປະຕິເສດ; ບໍ່ໄດ້ສົ່ງ session ໄປທີ່ອື່ນ") }
        let loggedOut = ScopedTransport.isLogoutCompletion(path: path, status: http.statusCode, location: http.value(forHTTPHeaderField: "Location"))
        guard !(300..<400).contains(http.statusCode) || loggedOut else { throw NativeFailure("Backend redirect ຖືກປະຕິເສດ; ບໍ່ໄດ້ສົ່ງ session ໄປທີ່ອື່ນ") }
        guard data.count <= 25 * 1024 * 1024 else { throw NativeFailure("ຂໍ້ມູນຕອບກັບໃຫຍ່ເກີນໄປ") }
        if path == "/api/auth/login", (200..<300).contains(http.statusCode) {
            guard let header = http.value(forHTTPHeaderField: "Set-Cookie") else { throw NativeFailure("Backend ບໍ່ໄດ້ສົ່ງ session") }
            let next = try ScopedTransport.sessionCookie(header)
            try await keychain.write(JSONEncoder().encode(next), account: "session-cookie"); cookie = next
        }
        if path == "/api/auth/logout", (200..<300).contains(http.statusCode) || loggedOut { try await clearSession() }
        return NativeReply(status: loggedOut ? 200 : http.statusCode, data: (try? JSONDecoder().decode(JSONValue.self, from: data)) ?? .null, bytes: data,
                           contentType: http.value(forHTTPHeaderField: "Content-Type") ?? "")
    }
}
