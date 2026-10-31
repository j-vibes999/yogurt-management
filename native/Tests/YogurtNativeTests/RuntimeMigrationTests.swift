import XCTest
import CryptoKit
import Darwin
@testable import YogurtNative

final class RuntimeMigrationTests: XCTestCase {
    private func fixture() throws -> URL {
        let pointer = try XCTUnwrap(Darwin.realpath(FileManager.default.temporaryDirectory.path, nil)); defer { free(pointer) }
        let root = URL(fileURLWithPath: String(cString: pointer)).appendingPathComponent("native-migration-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700]); return root
    }
    private func write(_ data: Data, _ file: URL) throws {
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try data.write(to: file); try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }
    func testCopiesOriginalReceiptAndMatchingBackupWithoutChangingOriginals() async throws {
        let root = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("old"); let target = root.appendingPathComponent("native")
        let receipt = source.appendingPathComponent("private-receipts/receipt-proof.jpeg"); let bytes = Data("old-private-receipt".utf8)
        try write(bytes, receipt)
        let dump = Data("verified-synthetic-snapshot".utf8); let hash = SHA256.hash(data: dump).map { String(format: "%02x", $0) }.joined()
        try write(dump, source.appendingPathComponent("backups/approved.dump"))
        let metadata = JSONValue.object(["ok": .bool(true), "sourceFingerprint": .string("sha256:approved"), "file": .string("approved.dump"), "sha256": .string(hash), "scope": .string("public")])
        try write(try metadata.encoded(), source.appendingPathComponent("backups/latest.json"))
        let importer = RuntimeDataMigration()
        let report = try await importer.importLegacy(source: source, target: target, fingerprint: "sha256:approved")
        XCTAssertEqual(report.receipts, 1); XCTAssertEqual(report.backupFiles, 2)
        XCTAssertEqual(try Data(contentsOf: receipt), bytes)
        XCTAssertEqual(try Data(contentsOf: target.appendingPathComponent("private-receipts/receipt-proof.jpeg")), bytes)
        XCTAssertEqual(try Data(contentsOf: target.appendingPathComponent("backups/approved.dump")), dump)
        let repeated = try await importer.importLegacy(source: source, target: target, fingerprint: "sha256:approved")
        XCTAssertEqual(repeated.receipts, 0); XCTAssertEqual(repeated.backupFiles, 0)
    }
    func testNeverOverwritesDifferentReceiptOrPublishesWrongTargetEvidence() async throws {
        let root = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("old"); let target = root.appendingPathComponent("native")
        try write(Data("old".utf8), source.appendingPathComponent("private-receipts/receipt-proof.pdf"))
        try write(Data("new".utf8), target.appendingPathComponent("private-receipts/receipt-proof.pdf"))
        do { _ = try await RuntimeDataMigration().importLegacy(source: source, target: target, fingerprint: "sha256:approved"); XCTFail("overwrote receipt") } catch {}
        XCTAssertEqual(try String(contentsOf: target.appendingPathComponent("private-receipts/receipt-proof.pdf"), encoding: .utf8), "new")
        try FileManager.default.removeItem(at: source.appendingPathComponent("private-receipts"))
        try write(Data("{\"sourceFingerprint\":\"sha256:another-project\"}".utf8), source.appendingPathComponent("backups/latest.json"))
        let report = try await RuntimeDataMigration().importLegacy(source: source, target: target, fingerprint: "sha256:approved")
        XCTAssertEqual(report.skippedBackupMetadata, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: target.appendingPathComponent("backups/latest.json").path))
    }
    func testLegacyReceiptCanonicalizationRejectsExternalAndTraversalURLs() throws {
        XCTAssertEqual(try ReceiptRoute.canonical("/uploads/receipts/receipt-proof.jpeg"), "/api/receipts/receipt-proof.jpeg")
        for path in ["https://evil.test/api/receipts/receipt-a.pdf", "/api/receipts/../receipt-a.pdf", "/api/receipts/%2e%2e/a.pdf", "/api/receipts/arbitrary.pdf", "/api/receipts/receipt-a.pdf?leak=1"] { XCTAssertThrowsError(try ReceiptRoute.canonical(path)) }
    }
}
