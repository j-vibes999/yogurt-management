import Foundation
import Security
import CryptoKit

struct BackendConfiguration: Codable, Sendable {
    let databaseURL: String
    let sessionSecret: String
    var legacyReviewed: Bool
    var scopeIdentifier: String {
        let identity = URLComponents(string: databaseURL)!
        let schema = identity.queryItems?.first(where: { $0.name == "schema" })?.value ?? "public"
        return "\(identity.host?.lowercased() ?? ""):\(identity.port ?? 5432)\(identity.path):\(identity.user ?? ""):\(schema)"
    }
    var databaseFingerprint: String {
        let identity = URLComponents(string: databaseURL)!
        let values = [identity.host?.lowercased() ?? "", String(identity.port ?? 5432), identity.user ?? "", identity.path, identity.queryItems?.first(where: { $0.name == "schema" })?.value ?? "public"]
        let encoder = JSONEncoder(); encoder.outputFormatting = [.withoutEscapingSlashes]
        let bytes = (try? encoder.encode(values)) ?? Data()
        return "sha256:" + SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    }
    static func randomSecret() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 48)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw NativeFailure("ສ້າງລະຫັດຄວາມປອດໄພບໍ່ໄດ້") }
        return Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
    static func validate(_ databaseURL: String, verification: Bool = false) throws {
        let allowed = Set(["sslmode", "schema", "pgbouncer", "connection_limit", "pool_timeout", "connect_timeout", "socket_timeout", "statement_cache_size", "application_name"])
        guard databaseURL.count <= 16384, databaseURL.rangeOfCharacter(from: .whitespacesAndNewlines.union(.controlCharacters)) == nil,
              let url = URLComponents(string: databaseURL), ["postgres", "postgresql"].contains(url.scheme ?? ""),
              let host = url.host, let user = url.user, !user.isEmpty,
              url.fragment == nil, url.path.range(of: "^/[A-Za-z0-9_-]+$", options: .regularExpression) != nil,
              verification || ((url.password?.isEmpty == false) && (url.port == nil || [5432, 6543].contains(url.port!)) &&
              host.range(of: "^(db\\.[a-z0-9-]+\\.supabase\\.co|[a-z0-9-]+\\.pooler\\.supabase\\.com)$", options: .regularExpression) != nil) else { throw NativeFailure("DATABASE_URL ຕ້ອງເປັນ Supabase PostgreSQL ທີ່ມີ TLS") }
        let items = url.queryItems ?? []
        guard items.count == Set(items.map(\.name)).count, items.allSatisfy({ allowed.contains($0.name) }),
              let mode = items.first(where: { $0.name == "sslmode" })?.value,
              (verification ? ["disable", "require", "verify-ca", "verify-full"] : ["require", "verify-ca", "verify-full"]).contains(mode) else { throw NativeFailure("DATABASE_URL ຕ້ອງກຳນົດ sslmode ແລະບໍ່ມີຕົວເລືອກຊ້ຳ") }
        if verification { guard ["127.0.0.1", "localhost", "::1", "[::1]"].contains(host), url.path.range(of: "^/yogurt_e2e_[a-z0-9_]+$", options: .regularExpression) != nil else { throw NativeFailure("Verification ໃຊ້ໄດ້ສະເພາະຖານຂໍ້ມູນທົດສອບໃນເຄື່ອງ") } }
    }
    static func fromEnvironment(_ contents: String, previous: BackendConfiguration? = nil, verification: Bool = false) throws -> BackendConfiguration {
        guard contents.utf8.count <= 1024 * 1024 else { throw NativeFailure("ໄຟລ໌ຕັ້ງຄ່າໃຫຍ່ເກີນໄປ") }
        let expression = try NSRegularExpression(pattern: "^\\s*(?:export\\s+)?DATABASE_URL\\s*=\\s*(.*?)\\s*$", options: [.anchorsMatchLines])
        let matches = expression.matches(in: contents, range: NSRange(contents.startIndex..., in: contents))
        guard matches.count == 1, let range = Range(matches[0].range(at: 1), in: contents) else { throw NativeFailure("ໄຟລ໌ຕ້ອງມີ DATABASE_URL ພຽງຄ່າດຽວ") }
        var value = String(contents[range]).trimmingCharacters(in: .whitespacesAndNewlines)
        if let quote = value.first, quote == "\"" || quote == "'" {
            guard let closing = value.dropFirst().firstIndex(of: quote) else { throw NativeFailure("DATABASE_URL ບໍ່ສົມບູນ") }
            let trailing = value[value.index(after: closing)...].trimmingCharacters(in: .whitespaces)
            guard trailing.isEmpty || trailing.hasPrefix("#") else { throw NativeFailure("DATABASE_URL ບໍ່ສົມບູນ") }
            value = String(value[value.index(after: value.startIndex)..<closing])
        } else if let comment = value.range(of: " #") { value = String(value[..<comment.lowerBound]).trimmingCharacters(in: .whitespaces) }
        try validate(value, verification: verification)
        let same = previous?.databaseURL == value
        return BackendConfiguration(databaseURL: value, sessionSecret: same ? previous!.sessionSecret : try randomSecret(), legacyReviewed: same && previous!.legacyReviewed)
    }
}
