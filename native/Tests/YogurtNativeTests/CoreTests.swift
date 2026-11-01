import XCTest
@testable import YogurtNative

final class CoreTests: XCTestCase {
    func testExactJSONAndMoney() throws {
        let value = try JSONDecoder().decode(JSONValue.self, from: Data("{\"amount\":\"1234567890.25\",\"quantity\":0.123456}".utf8))
        XCTAssertEqual(value["amount"].text, "1234567890.25")
        XCTAssertEqual(value["quantity"].text, "0.123456")
        XCTAssertEqual(try canonicalDecimal(" 100.20 "), "100.20")
        for invalid in ["1e2", "100.001", "-1", "NaN", "", "1,000"] { XCTAssertThrowsError(try canonicalDecimal(invalid)) }
        XCTAssertEqual(try canonicalDecimal("-0.125", scale: 6, allowNegative: true), "-0.125")
    }

    func testOriginAndCookieAreScoped() throws {
        let base = URL(string: "http://127.0.0.1:43188")!
        XCTAssertEqual(try ScopedTransport.url(base: base, path: "/api/session").host, "127.0.0.1")
        for bad in ["https://evil.test/api", "//evil.test/api", "/../private", "file:///etc/passwd"] {
            XCTAssertThrowsError(try ScopedTransport.url(base: base, path: bad))
        }
        let cookie = try ScopedTransport.sessionCookie("yogurt_session=abc.def; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200")
        XCTAssertEqual(cookie.value, "abc.def")
        XCTAssertThrowsError(try ScopedTransport.sessionCookie("other=value; Path=/; HttpOnly; Secure; SameSite=Strict"))
        XCTAssertThrowsError(try ScopedTransport.sessionCookie("yogurt_session=x; Path=/; Domain=evil.test; HttpOnly; Secure; SameSite=Strict"))
    }
    func testOnlyTheLogoutReplyToLoginCountsAsCompletedRedirect() {
        XCTAssertTrue(ScopedTransport.isLogoutCompletion(path: "/api/auth/logout", status: 303, location: "/login"))
        XCTAssertFalse(ScopedTransport.isLogoutCompletion(path: "/api/auth/logout", status: 303, location: "https://evil.test/login"))
        XCTAssertFalse(ScopedTransport.isLogoutCompletion(path: "/api/auth/logout", status: 302, location: "/login"))
        XCTAssertFalse(ScopedTransport.isLogoutCompletion(path: "/api/session", status: 303, location: "/login"))
    }

    func testDurableCommandsKeepIdentityAcrossRestartAndAccountSwitch() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = OperationStore(directory: directory)
        let body = Data("{\"amount\":\"100.25\"}".utf8)
        let first = try await store.prepare(userID: "owner-a", method: "POST", path: "/api/expenses", body: body)
        let reopened = OperationStore(directory: directory)
        let same = try await reopened.prepare(userID: "owner-a", method: "POST", path: "/api/expenses", body: body)
        XCTAssertEqual(first.id, same.id)
        XCTAssertEqual(first.body, same.body)
        let other = try await reopened.pending(userID: "owner-b")
        XCTAssertTrue(other.isEmpty)
        do {
            _ = try await reopened.prepare(userID: "owner-a", method: "POST", path: "/api/expenses", body: Data("{}".utf8))
            XCTFail("A new command replaced an unresolved command")
        } catch {}
        try await reopened.recordOutcome(first, state: .reconciled, result: .null)
        try await reopened.resolve(first)
        let empty = try await reopened.pending(userID: "owner-a")
        XCTAssertTrue(empty.isEmpty)
    }

    func testPendingOutcomeRules() {
        XCTAssertTrue(OperationStore.isDefinite(status: 201, retryable: nil))
        for status in [400, 404, 409] { XCTAssertTrue(OperationStore.isDefinite(status: status, retryable: nil)) }
        XCTAssertTrue(OperationStore.isDefinite(status: 409, retryable: false))
        XCTAssertFalse(OperationStore.isDefinite(status: 409, retryable: true))
        XCTAssertFalse(OperationStore.isDefinite(status: 500, retryable: false))
        XCTAssertFalse(OperationStore.isDefinite(status: 401, retryable: false))
        for status in [400, 404, 409] {
            XCTAssertFalse(OperationStore.isDefinite(status: status, retryable: nil, durable: false))
            XCTAssertFalse(OperationStore.isDefinite(status: status, retryable: true, durable: false))
            XCTAssertTrue(OperationStore.isDefinite(status: status, retryable: false, durable: false))
        }
        XCTAssertTrue(OperationStore.isDefinite(status: 200, retryable: nil, durable: false))
        XCTAssertFalse(OperationStore.isDefinite(status: 503, retryable: false, durable: false))
    }

    func testPendingAuditBlocksPaymentAcrossRoutesAndRestart() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let auditBody = Data("{\"storeId\":\"store-a\",\"paidAmount\":\"100.25\"}".utf8)
        let first = try await OperationStore(directory: directory).prepare(userID: "owner-a", method: "POST", path: "/api/restock-visits", body: auditBody)
        let reopened = OperationStore(directory: directory)
        do {
            _ = try await reopened.prepare(userID: "owner-a", method: "POST", path: "/api/settlements/pay", body: Data("{}".utf8))
            XCTFail("Payment bypassed an unresolved audit from the same account")
        } catch {}
        let retained = try await reopened.pending(userID: "owner-a")
        XCTAssertEqual(retained, [first])
        let retry = try await reopened.prepare(userID: "owner-a", method: "POST", path: "/api/restock-visits", body: auditBody)
        XCTAssertEqual(retry, first)
        // Another account cannot see or replay this account's command, but may do its own work.
        let other = try await reopened.prepare(userID: "owner-b", method: "POST", path: "/api/settlements/pay", body: Data("{}".utf8))
        XCTAssertNotEqual(other.userID, first.userID)
        try await reopened.recordOutcome(first, state: .reconciled, result: .null)
        try await reopened.resolve(first)
        let payment = try await reopened.prepare(userID: "owner-a", method: "POST", path: "/api/settlements/pay", body: Data("{}".utf8))
        XCTAssertNotEqual(payment.id, first.id)
        let pendingPayment = try await reopened.pending(userID: "owner-a")
        XCTAssertEqual(pendingPayment, [payment])
    }

    func testPendingBarrierSerializesConcurrentDifferentRoutes() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = OperationStore(directory: directory)
        let successes = await withTaskGroup(of: Bool.self, returning: Int.self) { group in
            for path in ["/api/restock-visits", "/api/settlements/pay"] {
                group.addTask {
                    do { _ = try await store.prepare(userID: "owner-a", method: "POST", path: path, body: Data("{}".utf8)); return true }
                    catch { return false }
                }
            }
            var count = 0
            for await success in group where success { count += 1 }
            return count
        }
        XCTAssertEqual(successes, 1, "Only one account command may become unresolved")
        let pending = try await store.pending(userID: "owner-a")
        XCTAssertEqual(pending.count, 1)
    }

    func testNonDurablePendingRequiresReconciliationBeforeAnotherSend() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let body = Data("{\"status\":\"completed\"}".utf8)
        let first = try await OperationStore(directory: directory).prepare(userID: "owner-a", method: "PATCH", path: "/api/refills/request-a", body: body, durable: false)
        let reopened = OperationStore(directory: directory)
        do {
            _ = try await reopened.prepare(userID: "owner-a", method: "PATCH", path: first.path, body: body, durable: false)
            XCTFail("A non-durable operation was replayed")
        } catch {}
        let retained = try await reopened.pending(userID: "owner-a")
        XCTAssertEqual(retained, [first])
        try await reopened.recordOutcome(first, state: .reconciled, result: .null)
        try await reopened.resolve(first)
        let next = try await reopened.prepare(userID: "owner-a", method: "PATCH", path: first.path, body: body, durable: false)
        XCTAssertNotEqual(next.id, first.id)
    }

    func testDraftsRemainPrivateAndScopedToTheirOwner() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = OperationStore(directory: directory)
        let snapshot = JSONValue.object(["storeId": .string("store-a"), "previousBalance": .string("1000000000.25")])
        try await store.saveDraft(userID: "owner-a", name: "audit.store-a", value: snapshot)
        let reopened = OperationStore(directory: directory)
        let otherDraft = try await reopened.loadDraft(userID: "owner-b", name: "audit.store-a")
        XCTAssertNil(otherDraft)
        try await reopened.removeDraft(userID: "owner-b", name: "audit.store-a")
        let retained = try await reopened.loadDraft(userID: "owner-a", name: "audit.store-a")
        XCTAssertEqual(retained, snapshot)
        let files = try FileManager.default.contentsOfDirectory(at: directory.appendingPathComponent("drafts"), includingPropertiesForKeys: nil)
        XCTAssertEqual(files.count, 1)
        let attributes = try FileManager.default.attributesOfItem(atPath: files[0].path)
        XCTAssertEqual((attributes[.posixPermissions] as? NSNumber)?.intValue, 0o600)
        let parent = try FileManager.default.attributesOfItem(atPath: directory.appendingPathComponent("drafts").path)
        XCTAssertEqual((parent[.posixPermissions] as? NSNumber)?.intValue, 0o700)
    }

    func testCSVEscapingAndBusinessDate() {
        let csv = NativeCSV.encode(headers: ["name", "amount"], rows: [["=HYPERLINK(\"x\")", "1,200"], ["ຮ້ານ", "100.25"]])
        XCTAssertTrue(csv.contains("'=HYPERLINK"))
        XCTAssertTrue(csv.contains("ຮ້ານ"))
        XCTAssertEqual(businessDateString(Date(timeIntervalSince1970: 0)), "1970-01-01")
    }
}
