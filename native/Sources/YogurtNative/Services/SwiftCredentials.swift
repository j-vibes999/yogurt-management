import Foundation
import CryptoKit
import CryptoSwift
import Security

enum SwiftCredentials {
    private static let sessionPattern = "^[A-Za-z0-9_-]{43}$"

    static func verifyPassword(_ password: String, encoded: String) -> Bool {
        // Fixed Node defaults; never accept attacker-selected work factors or huge buffers.
        guard encoded.utf8.count <= 4096, password.utf8.count <= 1_048_576 else { return false }
        let parts = encoded.split(separator: "$", omittingEmptySubsequences: false)
        guard parts.count >= 3, parts[0] == "scrypt", !parts[1].isEmpty, !parts[2].isEmpty,
              let salt = decode(String(parts[1])), salt.count <= 1024,
              let expected = decode(String(parts[2])), expected.count == 64,
              let actual = try? Scrypt(password: Array(password.utf8), salt: Array(salt), dkLen: 64, N: 16384, r: 8, p: 1).calculate() else { return false }
        return constantTimeEqual(actual, Array(expected))
    }
    static func hashPassword(_ password: String) throws -> String {
        guard password.unicodeScalars.count >= 15, password.utf8.count <= 1_048_576 else { throw NativeFailure("Password must contain at least 15 characters") }
        let salt = try random(16)
        let hash = try Scrypt(password: Array(password.utf8), salt: salt, dkLen: 64, N: 16384, r: 8, p: 1).calculate()
        return "scrypt$" + encode(Data(salt)) + "$" + encode(Data(hash))
    }
    static func createCredentialTag(userId: String, passwordHash: String, secret: String) -> String {
        let body = "[" + ["yogurt-session-credentials-v1", userId, passwordHash].map(SwiftValue.quote).joined(separator: ",") + "]"
        return encode(mac(Data(body.utf8), secret: secret))
    }
    static func verifySessionCredentials(payload: JSONValue, passwordHash: String, secret: String) -> Bool {
        guard case .string(let userID) = payload["userId"], case .string(let tag) = payload["credentialTag"], let actual = decode(tag) else { return false }
        let expected = createCredentialTag(userId: userID, passwordHash: passwordHash, secret: secret)
        guard let expectedBytes = decode(expected) else { return false }
        return constantTimeEqual(Array(actual), Array(expectedBytes))
    }
    static func createSessionId() throws -> String { encode(Data(try random(32))) }
    static func signSession(_ payload: JSONValue, secret: String) throws -> String {
        // The verifier authenticates original bytes and accepts any valid Node property order.
        let keys = ["userId", "sid", "email", "fullName", "role", "credentialTag", "exp"]
        guard case .object(let object) = payload else { throw SwiftValue.Failure.invalidJSON }
        let present = keys.filter { object[$0] != nil }
        let extras = object.keys.filter { !keys.contains($0) }.sorted()
        let json = "{" + (try (present + extras).map { SwiftValue.quote($0) + ":" + (try SwiftValue.canonicalPayload(object[$0]!)) }).joined(separator: ",") + "}"
        let body = encode(Data(json.utf8))
        return body + "." + encode(mac(Data(body.utf8), secret: secret))
    }
    static func verifySession(_ token: String?, secret: String, now: Date = Date()) -> JSONValue? {
        guard let token, token.utf8.count <= 32768 else { return nil }
        let parts = token.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[0].isEmpty, !parts[1].isEmpty,
              let signature = decode(String(parts[1])), signature.count == 32,
              constantTimeEqual(Array(signature), Array(mac(Data(parts[0].utf8), secret: secret))),
              let bytes = decode(String(parts[0])), let payload = try? JSONDecoder().decode(JSONValue.self, from: bytes),
              case .object = payload,
              case .string(let userID) = payload["userId"], !userID.isEmpty,
              case .string(let sid) = payload["sid"], sid.range(of: sessionPattern, options: .regularExpression) != nil,
              case .string = payload["email"], case .string = payload["fullName"],
              case .string(let role) = payload["role"], ["admin", "production", "driver"].contains(role),
              case .string(let tag) = payload["credentialTag"], tag.range(of: sessionPattern, options: .regularExpression) != nil,
              case .number(let expiration) = payload["exp"], expiration <= 9_007_199_254_740_991, expiration >= -9_007_199_254_740_991,
              let integral = try? SwiftValue.rounded(expiration, scale: 0), integral == expiration,
              expiration > Decimal(floor(now.timeIntervalSince1970)) else { return nil }
        return payload
    }
    private static func mac(_ bytes: Data, secret: String) -> Data {
        Data(CryptoKit.HMAC<CryptoKit.SHA256>.authenticationCode(for: bytes, using: SymmetricKey(data: Data(secret.utf8))))
    }
    private static func random(_ count: Int) throws -> [UInt8] {
        var bytes = [UInt8](repeating: 0, count: count)
        guard SecRandomCopyBytes(kSecRandomDefault, count, &bytes) == errSecSuccess else { throw NativeFailure("Secure random generation failed") }
        return bytes
    }
    private static func constantTimeEqual(_ a: [UInt8], _ b: [UInt8]) -> Bool {
        guard a.count == b.count else { return false }
        var difference: UInt8 = 0
        for index in a.indices { difference |= a[index] ^ b[index] }
        return difference == 0
    }
    private static func encode(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
    private static func decode(_ text: String) -> Data? {
        guard text.utf8.count <= 32768, text.range(of: "^[A-Za-z0-9_+/=-]*$", options: .regularExpression) != nil else { return nil }
        let normalized = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        return Data(base64Encoded: normalized + String(repeating: "=", count: (4 - normalized.count % 4) % 4))
    }
}
