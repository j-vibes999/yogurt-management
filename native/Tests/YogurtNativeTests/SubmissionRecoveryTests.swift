import XCTest
@testable import YogurtNative

final class SubmissionRecoveryTests: XCTestCase {
    func testPendingCannotBeRemovedBeforeItsOutcomeIsDurable() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = OperationStore(directory: root)
        let command = try await store.prepare(userID: "owner", method: "POST", path: "/api/expenses", body: Data("{\"amount\":\"100.25\"}".utf8))
        do {
            try await store.resolve(command)
            XCTFail("Removing the pending command without recording its outcome opens a duplicate-write window")
        } catch {}
        let recovered = try await OperationStore(directory: root).pending(userID: "owner")
        XCTAssertEqual(recovered, [command], "A restart must retain the exact UUID and body until an outcome is saved")
    }

    func testGlobalRetryRestoresCompletedDraftAfterRestartAndRequiresExplicitNewIntent() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = OperationStore(directory: root)
        let fields = JSONValue.object(["fields": .object(["amount": .string("1234567890.25")]), "original": .null])
        let body = Data("{\"category\":\"synthetic\",\"amount\":\"1234567890.25\"}".utf8)
        let result = JSONValue.object(["id": .string("persisted-expense")])
        try await store.saveDraft(userID: "owner", name: "expense.new", value: fields)
        let sent = try await store.prepare(userID: "owner", method: "POST", path: "/api/expenses", body: body, draftKey: "expense.new")
        // The sheet has closed and the server committed. Only global recovery receives the replay result.
        let recovery = OperationStore(directory: root)
        let pending = try await recovery.pending(userID: "owner")
        XCTAssertEqual(pending, [sent])
        try await recovery.recordOutcome(sent, state: .succeeded, result: result)
        try await recovery.resolve(sent)
        let restarted = OperationStore(directory: root)
        // Stale autosave/automatic cleanup cannot erase the completion or replace submitted values.
        try await restarted.saveDraft(userID: "owner", name: "expense.new", value: .object(["fields": .object(["amount": .string("1.00")])]))
        try await restarted.removeDraft(userID: "owner", name: "expense.new")
        let restored = try await restarted.loadDraft(userID: "owner", name: "expense.new")
        XCTAssertEqual(restored?["fields"]["amount"], .string("1234567890.25"))
        XCTAssertEqual(restored?["persistedResult"], result)
        XCTAssertEqual(restored?["persistedId"], .string("persisted-expense"))
        let resubmitted = try await restarted.prepare(userID: "owner", method: "POST", path: "/api/expenses", body: body, draftKey: "expense.new")
        XCTAssertEqual(resubmitted, sent, "Reopening the old submitted fields cannot generate another UUID")
        let outcome = try await restarted.outcome(resubmitted)
        XCTAssertEqual(outcome?.result, result)
        let resolvedPending = try await restarted.pending(userID: "owner")
        XCTAssertTrue(resolvedPending.isEmpty)
        try await restarted.removeDraft(userID: "owner", name: "expense.new", startNewIntent: true)
        try await restarted.saveDraft(userID: "owner", name: "expense.new", value: fields)
        let intentional = try await restarted.prepare(userID: "owner", method: "POST", path: "/api/expenses", body: body, draftKey: "expense.new")
        XCTAssertNotEqual(intentional.id, sent.id, "An explicitly requested identical expense remains legitimate")
    }

    func testCrashAfterOutcomeBeforePendingRemovalRetainsExactSubmission() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = OperationStore(directory: root)
        let value = JSONValue.object(["productId": .string("product"), "cups": .string("20")])
        let body = Data("{\"productId\":\"product\",\"cups\":20}".utf8)
        let result = JSONValue.object(["id": .string("batch"), "quantityProduced": .number(20)])
        try await store.saveDraft(userID: "producer", name: "production.planner", value: value)
        let command = try await store.prepare(userID: "producer", method: "POST", path: "/api/production-batches", body: body, draftKey: "production.planner")
        try await store.recordOutcome(command, state: .succeeded, result: result)
        // Simulate process loss here: pending deletion and the original sheet's continuation never ran.
        let restarted = OperationStore(directory: root)
        let draft = try await restarted.loadDraft(userID: "producer", name: "production.planner")
        XCTAssertEqual(draft?["persistedResult"], result)
        let replay = try await restarted.prepare(userID: "producer", method: "POST", path: command.path, body: body, draftKey: "production.planner")
        XCTAssertEqual(replay.id, command.id)
        XCTAssertEqual(replay.body, body)
        XCTAssertEqual(replay.method, "POST")
        XCTAssertEqual(replay.userID, "producer")
        let recovered = try await restarted.outcome(replay)
        XCTAssertEqual(recovered?.result, result)
        try await restarted.resolve(replay)
        let pending = try await restarted.pending(userID: "producer")
        XCTAssertTrue(pending.isEmpty)
    }

    func testAmbiguousDraftCannotBeDiscardedOrChangedAndScopesStayIndependent() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = OperationStore(directory: root.appendingPathComponent("project-a"))
        let value = JSONValue.object(["name": .string("recipe")])
        let body = Data("{\"name\":\"recipe\"}".utf8)
        try await store.saveDraft(userID: "owner", name: "recipe.new", value: value)
        let command = try await store.prepare(userID: "owner", method: "POST", path: "/api/recipes", body: body, draftKey: "recipe.new")
        do { try await store.removeDraft(userID: "owner", name: "recipe.new", startNewIntent: true); XCTFail("An ambiguous submission was discarded") } catch {}
        do { _ = try await store.prepare(userID: "owner", method: "POST", path: "/api/recipes", body: Data("{}".utf8), draftKey: "recipe.new"); XCTFail("A changed body replaced the original submission") } catch {}
        let pending = try await store.pending(userID: "owner")
        XCTAssertEqual(pending, [command])
        let otherAccount = try await store.loadDraft(userID: "other", name: "recipe.new")
        XCTAssertNil(otherAccount)
        let otherProject = OperationStore(directory: root.appendingPathComponent("project-b"))
        let isolatedDraft = try await otherProject.loadDraft(userID: "owner", name: "recipe.new")
        XCTAssertNil(isolatedDraft)
        let independent = try await otherProject.prepare(userID: "owner", method: "POST", path: "/api/recipes", body: body)
        XCTAssertNotEqual(independent.id, command.id)
    }

    func testOutcomeWriteFailureKeepsPendingAndSubmittedDraft() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = OperationStore(directory: root)
        let fields = JSONValue.object(["cups": .string("20")])
        try await store.saveDraft(userID: "owner", name: "production.planner", value: fields)
        let command = try await store.prepare(userID: "owner", method: "POST", path: "/api/production-batches", body: Data("{\"cups\":20}".utf8), draftKey: "production.planner")
        try Data("filesystem obstruction".utf8).write(to: root.appendingPathComponent("outcomes"))
        do { try await store.recordOutcome(command, state: .succeeded, result: .object(["id": .string("batch")])); XCTFail("An unwritable outcome directory accepted completion") } catch {}
        do { try await store.resolve(command); XCTFail("The pending command was removed after outcome persistence failed") } catch {}
        let pending = try await store.pending(userID: "owner")
        XCTAssertEqual(pending, [command])
        let draft = try await store.loadDraft(userID: "owner", name: "production.planner")
        XCTAssertEqual(draft, fields)
    }

    func testDraftBindingRecoversCrashBeforePendingFileIsWritten() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = OperationStore(directory: root)
        let body = Data("{\"amount\":\"100.25\"}".utf8)
        try await store.saveDraft(userID: "owner", name: "expense.new", value: .object(["fields": .object(["amount": .string("100.25")])]))
        let command = try await store.prepare(userID: "owner", method: "POST", path: "/api/expenses", body: body, draftKey: "expense.new")
        // Emulate the durable prefix of prepare: the bound draft survived, the pending write did not.
        for file in try FileManager.default.contentsOfDirectory(at: root.appendingPathComponent("commands"), includingPropertiesForKeys: nil) { try FileManager.default.removeItem(at: file) }
        let reopened = OperationStore(directory: root)
        let discovered = try await reopened.pending(userID: "owner")
        XCTAssertEqual(discovered, [command], "Global recovery must discover the bound submission before a sheet can offer retry")
        let recovered = try await reopened.prepare(userID: "owner", method: "POST", path: "/api/expenses", body: body, draftKey: "expense.new")
        XCTAssertEqual(recovered, command)
        let pending = try await reopened.pending(userID: "owner")
        XCTAssertEqual(pending, [command])
    }

    func testManualReconciliationLocksDraftWithoutFabricatingSuccess() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = OperationStore(directory: root)
        let body = Data("{\"amount\":\"100.25\"}".utf8)
        try await store.saveDraft(userID: "owner", name: "expense.new", value: .object(["fields": .object(["amount": .string("100.25")])]))
        let command = try await store.prepare(userID: "owner", method: "POST", path: "/api/expenses", body: body, draftKey: "expense.new")
        try await store.recordOutcome(command, state: .reconciled, result: .null)
        try await store.resolve(command)
        let reopened = OperationStore(directory: root)
        let draft = try await reopened.loadDraft(userID: "owner", name: "expense.new")
        XCTAssertEqual(draft?["nativeOutcome"], .string("reconciled"))
        XCTAssertEqual(draft?["persistedResult"], .null, "A manual acknowledgment is not proof of a successful server response")
        let retained = try await reopened.prepare(userID: "owner", method: "POST", path: command.path, body: body, draftKey: "expense.new")
        XCTAssertEqual(retained, command)
        let outcomes = try FileManager.default.contentsOfDirectory(at: root.appendingPathComponent("outcomes"), includingPropertiesForKeys: nil)
        XCTAssertEqual(outcomes.count, 1)
        let attributes = try FileManager.default.attributesOfItem(atPath: outcomes[0].path)
        XCTAssertEqual((attributes[.posixPermissions] as? NSNumber)?.intValue, 0o600)
        let parent = try FileManager.default.attributesOfItem(atPath: outcomes[0].deletingLastPathComponent().path)
        XCTAssertEqual((parent[.posixPermissions] as? NSNumber)?.intValue, 0o700)
    }

    func testDefiniteRejectionAllowsCorrectedDraftWithNewIdentity() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = OperationStore(directory: root)
        try await store.saveDraft(userID: "owner", name: "expense.new", value: .object(["amount": .string("100.25")]))
        let rejected = try await store.prepare(userID: "owner", method: "POST", path: "/api/expenses", body: Data("{\"amount\":\"100.25\"}".utf8), draftKey: "expense.new")
        try await store.recordOutcome(rejected, state: .rejected, result: .object(["error": .string("invalid category"), "retryable": .bool(false)]))
        try await store.resolve(rejected)
        let correction = JSONValue.object(["amount": .string("100.26")])
        try await store.saveDraft(userID: "owner", name: "expense.new", value: correction)
        let next = try await store.prepare(userID: "owner", method: "POST", path: "/api/expenses", body: correction.encoded(), draftKey: "expense.new")
        XCTAssertNotEqual(next.id, rejected.id)
        let restored = try await store.loadDraft(userID: "owner", name: "expense.new")
        XCTAssertEqual(restored, correction)
    }

    func testOrphanNonDurableDraftBecomesVisibleForManualReconciliation() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = OperationStore(directory: root)
        let body = Data("{\"status\":\"maintenance\"}".utf8)
        try await store.saveDraft(userID: "owner", name: "fridge.one", value: .object(["uncertain": .bool(true)]))
        let command = try await store.prepare(userID: "owner", method: "PATCH", path: "/api/fridges/one", body: body, durable: false, draftKey: "fridge.one")
        try FileManager.default.removeItem(at: root.appendingPathComponent("commands"))
        let reopened = OperationStore(directory: root)
        let discovered = try await reopened.pending(userID: "owner")
        XCTAssertEqual(discovered, [command])
        do { _ = try await reopened.prepare(userID: "owner", method: "PATCH", path: command.path, body: body, durable: false, draftKey: "fridge.one"); XCTFail("Discovery must not authorize an automatic non-durable replay") } catch {}
        do { try await reopened.removeDraft(userID: "owner", name: "fridge.one", startNewIntent: true); XCTFail("Unknown outcome was discarded") } catch {}
        try await reopened.recordOutcome(command, state: .reconciled, result: .null)
        try await reopened.resolve(command)
        try await reopened.removeDraft(userID: "owner", name: "fridge.one", startNewIntent: true)
        let removed = try await reopened.loadDraft(userID: "owner", name: "fridge.one")
        XCTAssertNil(removed)
    }
}
