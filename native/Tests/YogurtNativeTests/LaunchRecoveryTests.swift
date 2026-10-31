import XCTest
@testable import YogurtNative

final class LaunchRecoveryTests: XCTestCase {
    func testVerificationCannotTargetRealDatabaseOrProductionDirectory() throws {
        XCTAssertThrowsError(try NativeLaunchOptions(arguments: ["app", "--yogurt-native-verification-root", FileManager.default.homeDirectoryForCurrentUser.path]))
        XCTAssertThrowsError(try BackendConfiguration.validate("postgresql://user:pass@db.owner.supabase.co/postgres?sslmode=require", verification: true))
        XCTAssertThrowsError(try BackendConfiguration.validate("postgresql://user@127.0.0.1:5454/postgres?sslmode=disable", verification: true))
        XCTAssertThrowsError(try BackendConfiguration.validate("postgresql://user@127.0.0.1:5454/yogurt_e2e_native?sslmode=disable"))
        XCTAssertNoThrow(try BackendConfiguration.validate("postgresql://user@127.0.0.1:5454/yogurt_e2e_native?sslmode=disable", verification: true))
    }
    func testLaunchDoesNotAcceptAmbiguousConfigurationOrRelativePath() {
        XCTAssertThrowsError(try NativeLaunchOptions(arguments: ["app", "--yogurt-import-configuration", "relative.env"]))
        XCTAssertThrowsError(try NativeLaunchOptions(arguments: ["app", "--yogurt-import-configuration", "/tmp/a", "--yogurt-import-configuration", "/tmp/b"]))
    }
    func testLegacyReviewKeepsUnknownCommandsForReconciliation() throws {
        let valid = "{\"format\":\"yogurt-legacy-recovery-v1\",\"origin\":\"http://127.0.0.1:43187\",\"exportedAt\":\"2026-10-29T08:00:00Z\",\"records\":[{\"key\":\"yogurt:pending-operation:old\",\"value\":\"uncertain-body\"}]}"
        let loaded = try LegacyRecoveryReview.read(Data(valid.utf8))
        XCTAssertEqual(loaded.records.count, 1)
        XCTAssertEqual(loaded.records.first?.value, "uncertain-body")
        XCTAssertThrowsError(try LegacyRecoveryReview.read(Data(valid.replacingOccurrences(of: "43187", with: "43188").utf8)))
        XCTAssertThrowsError(try LegacyRecoveryReview.read(Data(valid.replacingOccurrences(of: "yogurt:pending-operation:old", with: "arbitrary:secret").utf8)))
    }
}
