import XCTest
@testable import YogurtNative

@MainActor final class WorkspaceCacheTests: XCTestCase {
    private let admin = NativeSession(userId: "owner", fullName: "Owner", email: "owner@test.invalid", role: "admin", source: "database")
    private func response(_ resource: String = "stores", _ name: String = "old") -> NativeReadResponse {
        NativeReadResponse(version: 1, resource: resource, source: "database", generatedAt: "2026-11-01T00:00:00Z", data: .object(["name": .string(name)]))
    }
    func testCacheSeparatesFiltersAccountsAndRolesAndRejectsFormSnapshots() {
        var cache = WorkspaceReadCache()
        let generation = cache.generation
        cache.store(response(), session: admin, query: ["filter": "all", "page": "1"], generation: generation)
        XCTAssertEqual(cache.value(resource: "stores", session: admin, query: ["page": "1", "filter": "all"])?.data.text("name"), "old")
        XCTAssertNil(cache.value(resource: "stores", session: admin, query: ["page": "2", "filter": "all"]))
        for session in [NativeSession(userId: "other", fullName: "", email: "", role: "admin", source: "database"), NativeSession(userId: "owner", fullName: "", email: "", role: "driver", source: "database")] {
            XCTAssertNil(cache.value(resource: "stores", session: session, query: ["filter": "all", "page": "1"]))
        }
        for resource in ["restock", "store", "expense", "catalog", "closing"] {
            cache.store(response(resource), session: admin, query: [:], generation: generation)
            XCTAssertNil(cache.value(resource: resource, session: admin, query: [:]))
        }
    }
    func testInvalidationRejectsReadsThatStartedBeforeAWrite() {
        var cache = WorkspaceReadCache()
        let before = cache.generation
        cache.store(response(), session: admin, query: [:], generation: before)
        cache.invalidate()
        XCTAssertNil(cache.value(resource: "stores", session: admin, query: [:]))
        cache.store(response(), session: admin, query: [:], generation: before)
        XCTAssertNil(cache.value(resource: "stores", session: admin, query: [:]))
        cache.store(response("stores", "new"), session: admin, query: [:], generation: cache.generation)
        XCTAssertEqual(cache.value(resource: "stores", session: admin, query: [:])?.data.text("name"), "new")
    }
    func testRecreatedPageShowsCachedContentWhileFreshReadIsPending() async {
        let reader = SuspendedReader(session: admin, cached: response())
        let state = FeatureState()
        let task = Task { await state.load(reader, "stores") }
        while reader.continuation == nil { await Task.yield() }
        XCTAssertEqual(state.data.text("name"), "old")
        XCTAssertEqual(state.source, "cached")
        XCTAssertTrue(state.loading)
        reader.continuation?.resume(returning: response("stores", "fresh"))
        await task.value
        XCTAssertEqual(state.data.text("name"), "fresh")
        XCTAssertEqual(state.source, "database")
        XCTAssertFalse(state.loading)
    }
    func testChangingFiltersClearsPreviousResultsAndFailureKeepsOnlyMatchingCache() async {
        let reader = SuspendedReader(session: admin, cached: response())
        let state = FeatureState()
        let first = Task { await state.load(reader, "stores") }
        while reader.continuation == nil { await Task.yield() }
        reader.continuation?.resume(throwing: NativeFailure("offline"))
        await first.value
        XCTAssertEqual(state.source, "stale")
        reader.cached = nil; reader.continuation = nil
        let second = Task { await state.load(reader, "stores", query: ["page": "2"]) }
        while reader.continuation == nil { await Task.yield() }
        XCTAssertEqual(state.data, .null)
        reader.continuation?.resume(throwing: NativeFailure("offline"))
        await second.value
        XCTAssertEqual(state.data, .null)
    }
    func testAccountChangeDuringReadDoesNotPublishOldAccountData() async {
        let reader = SuspendedReader(session: admin, cached: response())
        let state = FeatureState()
        let task = Task { await state.load(reader, "stores") }
        while reader.continuation == nil { await Task.yield() }
        reader.session = nil
        reader.continuation?.resume(throwing: NativeFailure("signed out"))
        await task.value
        XCTAssertEqual(state.data, .null)
        XCTAssertFalse(state.loading)
    }
}

@MainActor private final class SuspendedReader: NativeReadSource {
    var session: NativeSession?
    var cached: NativeReadResponse?
    var continuation: CheckedContinuation<NativeReadResponse, Error>?
    init(session: NativeSession, cached: NativeReadResponse) { self.session = session; self.cached = cached }
    func cachedRead(_ resource: String, query: [String: String]) -> NativeReadResponse? { cached }
    func read(_ resource: String, query: [String: String]) async throws -> NativeReadResponse {
        try await withCheckedThrowingContinuation { continuation = $0 }
    }
}
