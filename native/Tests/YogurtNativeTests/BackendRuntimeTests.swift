import Foundation
import XCTest
@testable import YogurtNative

@MainActor final class BackendRuntimeTests: XCTestCase {
    func testCanonicalDirectoryUsesPathsWithoutSymlinkComponentsForBootstrap() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("yogurt-runtime-path-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        // Foundation normalizes /private/var back to /var on macOS; the Node
        // bootstrap deliberately rejects /var because it is a symlink.
        let foundationPath = directory.resolvingSymlinksInPath().standardizedFileURL
        let canonical = try BackendRuntime.canonicalDirectoryPath(foundationPath)
        XCTAssertEqual(URL(fileURLWithPath: canonical).lastPathComponent, directory.lastPathComponent)
        var current = "/"
        for component in canonical.split(separator: "/") {
            current = (current as NSString).appendingPathComponent(String(component))
            let attributes = try FileManager.default.attributesOfItem(atPath: current)
            XCTAssertNotEqual(attributes[.type] as? FileAttributeType, .typeSymbolicLink, "Bootstrap rejects symlink components")
        }
    }

    func testBackendFailureMessagesExposeOnlyCanonicalSupportCodes() {
        for code in ["CONFIGURATION", "START_FAILED", "CONTROL_PROTOCOL", "HEARTBEAT_TIMEOUT", "SPAWN_FAILED", "CHILD_EXIT", "PORT_BUSY"] {
            XCTAssertTrue(BackendRuntime.failureMessage(code: code).hasSuffix("(\(code))"))
        }
        let message = BackendRuntime.failureMessage(code: "postgresql://private:secret@example.invalid/db")
        XCTAssertTrue(message.hasSuffix("(START_FAILED)"))
        XCTAssertFalse(message.contains("private"))
        XCTAssertFalse(message.contains("secret"))
        XCTAssertFalse(message.contains("example.invalid"))
    }
}
