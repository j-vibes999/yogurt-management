import XCTest
@testable import YogurtNative

final class SwiftCredentialsTests: XCTestCase {
    private let secret = "foundation-secret-0123456789abcdef"
    private let passwordHash = "scrypt$MDEyMzQ1Njc4OWFiY2RlZg$JKX9sg33COVjGDXgg5hHjkgkWXtZ8BJV8ls_x-OVe1sQOjPnfEOuSPOXczMQD2gpTFr4M7lnjGVenqNsJKrmpg"
    private let tag = "CwurDFbSKnQMAtEfgAepeTwbSh4Mg8vp1UOfnDREfrI"
    private let token = "eyJ1c2VySWQiOiJ1c2VyLTEiLCJzaWQiOiJhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhIiwiZW1haWwiOiJhQGV4YW1wbGUudGVzdCIsImZ1bGxOYW1lIjoi4LqE4Lq74LqZIC8gXCJBXCIiLCJyb2xlIjoiYWRtaW4iLCJjcmVkZW50aWFsVGFnIjoiQ3d1ckRGYlNLblFNQXRFZmdBZXBlVHdiU2g0TWc4dnAxVU9mbkRSRWZySSIsImV4cCI6MjAwMDAwMDAwMH0.TRtMGKN8lkBBzv0g9Yc7TVBLu7s1fAfhGsvANkkA_M8"
    private var payload: JSONValue { .object(["userId": .string("user-1"), "sid": .string(String(repeating: "a", count: 43)), "email": .string("a@example.test"), "fullName": .string("ຄົນ / \"A\""), "role": .string("admin"), "credentialTag": .string(tag), "exp": .integer(2_000_000_000)]) }

    func testNodeScryptVectorAndMalformedHashRejection() throws {
        XCTAssertTrue(SwiftCredentials.verifyPassword("ລະຫັດ 🔐 long password", encoded: passwordHash))
        XCTAssertFalse(SwiftCredentials.verifyPassword("wrong", encoded: passwordHash))
        for malformed in ["", "scrypt$invalid$short", "scrypt$" + String(repeating: "a", count: 1_000_000) + "$bad", "other$x$y"] {
            XCTAssertFalse(SwiftCredentials.verifyPassword("x", encoded: malformed))
        }
    }

    func testNodeCredentialTagAndSessionVector() throws {
        XCTAssertEqual(SwiftCredentials.createCredentialTag(userId: "user-1", passwordHash: passwordHash, secret: secret), tag)
        XCTAssertTrue(SwiftCredentials.verifySessionCredentials(payload: payload, passwordHash: passwordHash, secret: secret))
        XCTAssertFalse(SwiftCredentials.verifySessionCredentials(payload: payload, passwordHash: passwordHash + "changed", secret: secret))
        XCTAssertEqual(try SwiftCredentials.signSession(payload, secret: secret), token)
        XCTAssertEqual(SwiftCredentials.verifySession(token, secret: secret, now: Date(timeIntervalSince1970: 1_900_000_000)), payload)
        XCTAssertNil(SwiftCredentials.verifySession(token, secret: secret, now: Date(timeIntervalSince1970: 2_000_000_000)))
        XCTAssertNil(SwiftCredentials.verifySession(token + ".extra", secret: secret))
        XCTAssertNil(SwiftCredentials.verifySession(token, secret: secret + "wrong"))
    }

    func testSignedMalformedSessionCannotAuthorize() throws {
        for (key, value): (String, JSONValue) in [("sid", .string("short")), ("userId", .string("")), ("role", .string("owner")), ("credentialTag", .string("bad")), ("exp", .number(Decimal(string: "2000000000.5")!)), ("email", .null)] {
            var object = payload.object; object[key] = value
            let signed = try SwiftCredentials.signSession(.object(object), secret: secret)
            XCTAssertNil(SwiftCredentials.verifySession(signed, secret: secret, now: Date(timeIntervalSince1970: 1_900_000_000)), key)
        }
    }

    func testEveryLoginExpiryIsAWholeSecondThatVerifies() throws {
        // Decimal(Double) once produced 1793568528.9999998 for a quarter of logins.
        var object = payload.object
        for offset in 0..<500 {
            let expiry = Date(timeIntervalSince1970: 1_793_568_000 + Double(offset) + 0.4321)
            object["exp"] = .number(SwiftCredentials.epochSeconds(expiry))
            let signed = try SwiftCredentials.signSession(.object(object), secret: secret)
            XCTAssertNotNil(SwiftCredentials.verifySession(signed, secret: secret, now: Date(timeIntervalSince1970: 1_793_000_000)), "offset \(offset)")
        }
    }

    func testSecureRandomPasswordHashesAndSessionIDs() throws {
        XCTAssertThrowsError(try SwiftCredentials.hashPassword("short"))
        let first = try SwiftCredentials.hashPassword("fifteen-or-more-🔐")
        let second = try SwiftCredentials.hashPassword("fifteen-or-more-🔐")
        XCTAssertNotEqual(first, second)
        XCTAssertTrue(SwiftCredentials.verifyPassword("fifteen-or-more-🔐", encoded: first))
        let ids = try (0..<20).map { _ in try SwiftCredentials.createSessionId() }
        XCTAssertEqual(Set(ids).count, 20)
        XCTAssertTrue(ids.allSatisfy { $0.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil })
    }
}
