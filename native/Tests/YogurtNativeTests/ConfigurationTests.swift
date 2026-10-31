import XCTest
@testable import YogurtNative

final class ConfigurationTests: XCTestCase {
    private let base = "postgresql://postgres.owner:private-password@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=require"
    func testRecoveryScopeSeparatesSchemasAndPorts() {
        func configuration(_ suffix: String) -> BackendConfiguration { BackendConfiguration(databaseURL: base + suffix, sessionSecret: String(repeating: "s", count: 64), legacyReviewed: false) }
        XCTAssertNotEqual(configuration("&schema=public").scopeIdentifier, configuration("&schema=other").scopeIdentifier)
        let pooled = BackendConfiguration(databaseURL: base.replacingOccurrences(of: ":5432/", with: ":6543/"), sessionSecret: "secret", legacyReviewed: false)
        XCTAssertNotEqual(configuration("").scopeIdentifier, pooled.scopeIdentifier)
        XCTAssertEqual(configuration("").scopeIdentifier, configuration("&schema=public").scopeIdentifier)
        XCTAssertFalse(configuration("").scopeIdentifier.contains("private-password"))
    }
    func testOnlySupabaseTLSConfigurationAccepted() throws {
        XCTAssertNoThrow(try BackendConfiguration.validate(base))
        for invalid in [base + "&sslmode=require", base + "&host=evil.test", base.replacingOccurrences(of: "sslmode=require", with: "sslmode=disable"), base.replacingOccurrences(of: "aws-0-region.pooler.supabase.com", with: "evil.test"), base.replacingOccurrences(of: "postgresql", with: "https")] {
            XCTAssertThrowsError(try BackendConfiguration.validate(invalid))
        }
    }
    func testBackupFingerprintMatchesExistingBackendEvidence() {
        let configuration = BackendConfiguration(databaseURL: base, sessionSecret: "unused", legacyReviewed: false)
        XCTAssertEqual(configuration.databaseFingerprint, "sha256:8dda29a7b67c45f5bbd15d97f18830522315fb129daa81ca5bb92890c6df2a30")
    }
    func testImportNeverEvaluatesShellAndDoesNotRestoreOtherProjectReview() throws {
        let old = BackendConfiguration(databaseURL: base, sessionSecret: String(repeating: "s", count: 64), legacyReviewed: true)
        let same = try BackendConfiguration.fromEnvironment("OTHER=$(echo ignored)\nDATABASE_URL='\(base)' # local\n", previous: old)
        XCTAssertEqual(same.sessionSecret, old.sessionSecret)
        XCTAssertTrue(same.legacyReviewed)
        XCTAssertThrowsError(try BackendConfiguration.fromEnvironment("DATABASE_URL='\(base)'\nDATABASE_URL='\(base)'"))
        let changed = try BackendConfiguration.fromEnvironment("DATABASE_URL='\(base)&schema=other'", previous: old)
        XCTAssertFalse(changed.legacyReviewed)
        XCTAssertNotEqual(changed.sessionSecret, old.sessionSecret)
    }
}
