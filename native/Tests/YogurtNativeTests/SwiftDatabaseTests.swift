import XCTest
import Foundation
import Darwin
import CryptoKit
@testable import YogurtNative

final class SwiftDatabaseTests: XCTestCase {
    func testConfigurationRejectsUnsafeTargetsAndRequiresFullTLSVerification() throws {
        let local = "postgresql://tester@127.0.0.1:5432/yogurt_e2e_foundation?sslmode=disable"
        XCTAssertThrowsError(try SwiftDatabase(configuration: configuration(local), verification: false))
        XCTAssertThrowsError(try SwiftDatabase(configuration: configuration("postgresql://tester@127.0.0.1/postgres?sslmode=disable"), verification: true))
        XCTAssertThrowsError(try SwiftDatabase(configuration: configuration("postgresql://tester:secret@db.example.supabase.co/postgres?sslmode=require"), verification: true))
        for mode in ["require", "verify-ca", "verify-full"] {
            let options = try SwiftDatabaseOptions(configuration: configuration("postgresql://tester:secret@db.example.supabase.co/postgres?sslmode=\(mode)"), verification: false)
            XCTAssertTrue(options.requiresTLS)
            XCTAssertTrue(options.verifiesCertificateAndHostname)
            XCTAssertEqual(options.tlsServerName, "db.example.supabase.co")
            XCTAssertEqual(options.tlsConfiguration.trustRoots, .certificates([try SupabaseTrust.root()]))
        }
        let sessionURL = "postgresql://tester:secret@aws-0-example.pooler.supabase.com:5432/postgres?sslmode=require"
        XCTAssertFalse(try SwiftDatabaseOptions(configuration: configuration(sessionURL), verification: false).transactionPooling)
        let pooled = try SwiftDatabaseOptions(configuration: configuration(sessionURL.replacingOccurrences(of: ":5432/", with: ":6543/")), verification: false)
        XCTAssertTrue(pooled.transactionPooling)
        XCTAssertEqual(pooled.clientConfiguration.port, 6543)
        XCTAssertEqual(pooled.clientConfiguration.host, "aws-0-example.pooler.supabase.com")
        XCTAssertTrue(try SwiftDatabaseOptions(configuration: configuration(local + "&pgbouncer=true"), verification: true).transactionPooling)
        XCTAssertFalse(try SwiftDatabaseOptions(configuration: configuration(local + "&pgbouncer=false"), verification: true).transactionPooling)
        for query in ["schema=bad%2Cpublic", "connection_limit=999", "connect_timeout=0", "pool_timeout=not-a-number", "socket_timeout=-1", "pgbouncer=maybe"] {
            XCTAssertThrowsError(try SwiftDatabase(configuration: configuration(local + "&" + query), verification: true))
        }
    }

    func testExplicitLifecycleRejectsQueriesBeforeStartAndAfterStop() async throws {
        let database = try SwiftDatabase(configuration: configuration("postgresql://tester@127.0.0.1:1/yogurt_e2e_foundation?sslmode=disable"), verification: true)
        do { _ = try await database.rows("SELECT 1", []); XCTFail("Query before start succeeded") }
        catch { XCTAssertEqual((error as? SwiftDatabaseError)?.code, "not_started") }
        await database.stop()
        do { try await database.start(); XCTFail("Restart after stop succeeded") }
        catch { XCTAssertEqual((error as? SwiftDatabaseError)?.code, "stopped") }
    }

    func testBoundQueriesPreserveDecimalsDatesAndPreventInjection() async throws {
        let fixture = try LocalPostgresFixture()
        defer { fixture.stop() }
        let database = try SwiftDatabase(configuration: configuration(fixture.url + "&schema=foundation&connection_limit=2"), verification: true)
        try await database.start()
        do {
            try await database.execute("CREATE SCHEMA foundation", [])
            try await database.execute("CREATE TABLE samples (id text PRIMARY KEY, amount numeric(30,6), happened timestamp without time zone, payload jsonb)", [])
            let injection = "x'); DROP TABLE samples; --"
            try await database.execute("INSERT INTO samples VALUES ($1::text, $2::numeric, $3::timestamp, $4::jsonb)", [.string(injection), .number(try SwiftValue.decimal("9007199254740993.123456")), .string("2024-02-29 12:34:56.123456"), .object(["value": .number(try SwiftValue.decimal("9007199254740993.12"))])])
            let rows = try await database.rows("SELECT id, amount, happened, payload FROM samples WHERE id = $1::text", [.string(injection)])
            XCTAssertEqual(rows.count, 1)
            XCTAssertEqual(rows[0]["amount"], .number(try SwiftValue.decimal("9007199254740993.123456")))
            XCTAssertEqual(rows[0].text("happened"), "2024-02-29T12:34:56.123456")
            XCTAssertEqual(rows[0]["payload"]["value"], .number(try SwiftValue.decimal("9007199254740993.12")))
            XCTAssertEqual(rows[0].text("id"), injection)
            let nested = try await database.rows("WITH input AS (SELECT $1::numeric AS exact_value) SELECT * FROM input", [.string("123.000001")])
            XCTAssertEqual(nested.first?["exact_value"], .number(try SwiftValue.decimal("123.000001")))
            do {
                _ = try await database.rows("SELECT $1::jsonb", [.object(["private-key": .number(.nan)])])
                XCTFail("Invalid JSON binding succeeded")
            } catch {
                XCTAssertEqual((error as? SwiftDatabaseError)?.code, "invalid_binding")
                XCTAssertFalse(String(describing: error).contains("private-key"))
            }
            await database.stop()
        } catch { await database.stop(); throw error }
    }

    func testTransactionsRollbackSanitizeErrorsAndInvalidateEscapedConnection() async throws {
        let fixture = try LocalPostgresFixture(); defer { fixture.stop() }
        let database = try SwiftDatabase(configuration: configuration(fixture.url), verification: true)
        try await database.start()
        do {
            try await database.execute("CREATE TABLE records (id text PRIMARY KEY)", [])
            do {
                try await database.transaction { connection in
                    try await connection.execute("INSERT INTO records VALUES ($1::text)", [.string("private-value")])
                    try await connection.execute("INSERT INTO records VALUES ($1::text)", [.string("private-value")])
                }
                XCTFail("Unique violation succeeded")
            } catch {
                XCTAssertEqual((error as? SwiftDatabaseError)?.sqlState, "23505")
                XCTAssertFalse(String(describing: error).contains("private-value"))
                XCTAssertFalse(error.localizedDescription.contains("records"))
            }
            let remaining = try await database.rows("SELECT count(*) AS count FROM records", [])
            XCTAssertEqual(remaining.first?["count"], .integer(0))
            let escaped = try await database.transaction { $0 }
            do { _ = try await escaped.rows("SELECT 1", []); XCTFail("Escaped connection remained valid") }
            catch { XCTAssertEqual((error as? SwiftDatabaseError)?.code, "connection_released") }
            await database.stop()
        } catch { await database.stop(); throw error }
    }

    func testSerializableRetriesOnlyConfirmedRollbackAndCancellationRecoversPool() async throws {
        let fixture = try LocalPostgresFixture(); defer { fixture.stop() }
        let database = try SwiftDatabase(configuration: configuration(fixture.url + "&connection_limit=1&socket_timeout=2&pool_timeout=1"), verification: true)
        try await database.start()
        do {
            let attempts = AttemptCounter()
            let result = try await database.transaction { connection in
                let count = await attempts.next()
                if count < 3 { try await connection.execute("DO $$ BEGIN RAISE EXCEPTION 'synthetic' USING ERRCODE='40001'; END $$", []) }
                return count
            }
            XCTAssertEqual(result, 3)
            let failingAttempts = AttemptCounter()
            do {
                try await database.transaction { connection in
                    _ = await failingAttempts.next()
                    try await connection.execute("DO $$ BEGIN RAISE EXCEPTION 'synthetic' USING ERRCODE='40001'; END $$", [])
                }
                XCTFail("Unbounded retry eventually succeeded")
            } catch { XCTAssertEqual((error as? SwiftDatabaseError)?.sqlState, "40001") }
            let count = await failingAttempts.count
            XCTAssertEqual(count, 13)
            let sleeper = Task { try await database.rows("SELECT pg_sleep(20)", []) }
            try await Task.sleep(for: .milliseconds(100)); sleeper.cancel()
            do { _ = try await sleeper.value; XCTFail("Cancelled query succeeded") } catch { }
            let recovered = try await database.rows("SELECT 42 AS answer", [])
            XCTAssertEqual(recovered.first?["answer"], .integer(42))
            await database.stop()
        } catch { await database.stop(); throw error }
    }

    func testCommitConnectionLossIsUncertainAndNeverRetried() async throws {
        let fixture = try LocalPostgresFixture(); defer { fixture.stop() }
        let database = try SwiftDatabase(configuration: configuration(fixture.url), verification: true)
        try await database.start()
        do {
            try await database.execute("CREATE TABLE uncertain (id text PRIMARY KEY)", [])
            try await database.execute("CREATE FUNCTION kill_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_terminate_backend(pg_backend_pid()); RETURN NEW; END $$", [])
            try await database.execute("CREATE CONSTRAINT TRIGGER kill_at_commit AFTER INSERT ON uncertain DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION kill_commit()", [])
            let attempts = AttemptCounter()
            do {
                try await database.transaction { connection in
                    _ = await attempts.next()
                    try await connection.execute("INSERT INTO uncertain VALUES ('synthetic')", [])
                }
                XCTFail("Terminated commit succeeded")
            } catch { XCTAssertEqual((error as? SwiftDatabaseError)?.code, "commit_uncertain") }
            let count = await attempts.count
            XCTAssertEqual(count, 1)
            await database.stop()
        } catch { await database.stop(); throw error }
    }

    func testOnlyOperationReceiptUniqueConstraintIsRetried() async throws {
        let fixture = try LocalPostgresFixture(); defer { fixture.stop() }
        let database = try SwiftDatabase(configuration: configuration(fixture.url), verification: true)
        try await database.start()
        do {
            let attempts = AttemptCounter()
            let count = try await database.transaction { connection in
                let count = await attempts.next()
                if count == 1 {
                    try await connection.execute("DO $$ BEGIN RAISE EXCEPTION 'synthetic' USING ERRCODE='23505', CONSTRAINT='operation_receipts_user_id_scope_key_key'; END $$", [])
                }
                return count
            }
            XCTAssertEqual(count, 2)
            let otherAttempts = AttemptCounter()
            do {
                try await database.transaction { connection in
                    _ = await otherAttempts.next()
                    try await connection.execute("DO $$ BEGIN RAISE EXCEPTION 'synthetic' USING ERRCODE='23505', CONSTRAINT='some_other_unique'; END $$", [])
                }
                XCTFail("Unique error succeeded")
            } catch { XCTAssertEqual((error as? SwiftDatabaseError)?.sqlState, "23505") }
            let countOther = await otherAttempts.count
            XCTAssertEqual(countOther, 1)
            await database.stop()
        } catch { await database.stop(); throw error }
    }

    func testCaughtStatementErrorCannotTurnAbortedTransactionIntoSuccess() async throws {
        let fixture = try LocalPostgresFixture(); defer { fixture.stop() }
        let database = try SwiftDatabase(configuration: configuration(fixture.url), verification: true)
        try await database.start()
        do {
            _ = try await database.transaction { connection in
                try? await connection.execute("SELECT 1/0", [])
                return "incorrect success"
            }
            XCTFail("Aborted transaction reported success")
        } catch { XCTAssertEqual((error as? SwiftDatabaseError)?.sqlState, "22012") }
        await database.stop()
    }

    func testBoundedPoolWaitAndStatementTimeoutRecover() async throws {
        let fixture = try LocalPostgresFixture(); defer { fixture.stop() }
        let database = try SwiftDatabase(configuration: configuration(fixture.url + "&connection_limit=1&socket_timeout=2&pool_timeout=1"), verification: true)
        try await database.start()
        do {
            let state = AttemptCounter()
            let holder = Task {
                try await database.transaction { connection in
                    _ = await state.next()
                    let isolation = try await connection.rows("SELECT current_setting('transaction_isolation') AS isolation", [])
                    XCTAssertEqual(isolation.first?.text("isolation"), "serializable")
                    try await Task.sleep(for: .milliseconds(1600))
                }
            }
            while await state.count == 0 { try await Task.sleep(for: .milliseconds(10)) }
            do { _ = try await database.rows("SELECT 1", []); XCTFail("Pool wait exceeded deadline") }
            catch { XCTAssertEqual((error as? SwiftDatabaseError)?.code, "pool_timeout") }
            try await holder.value
            do { _ = try await database.rows("SELECT pg_sleep(20)", []); XCTFail("Statement exceeded deadline") }
            catch {
                let failure = error as? SwiftDatabaseError
                XCTAssertTrue(failure?.code == "query_timeout" || failure?.sqlState == "57014" || failure?.code == "connection_error")
            }
            let recovered = try await database.rows("SELECT 7 AS answer", [])
            XCTAssertEqual(recovered.first?["answer"], .integer(7))
            await database.stop()
        } catch { await database.stop(); throw error }
    }

    func testCancellationDuringCommitRetainsUncertainOutcome() async throws {
        let fixture = try LocalPostgresFixture(); defer { fixture.stop() }
        let database = try SwiftDatabase(configuration: configuration(fixture.url), verification: true)
        try await database.start()
        do {
            try await database.execute("CREATE TABLE cancel_commit (id text PRIMARY KEY)", [])
            try await database.execute("CREATE FUNCTION delay_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(20); RETURN NEW; END $$", [])
            try await database.execute("CREATE CONSTRAINT TRIGGER delay_at_commit AFTER INSERT ON cancel_commit DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION delay_commit()", [])
            let state = AttemptCounter()
            let operation = Task {
                try await database.transaction { connection in
                    try await connection.execute("INSERT INTO cancel_commit VALUES ('synthetic')", [])
                    _ = await state.next()
                }
            }
            while await state.count == 0 { try await Task.sleep(for: .milliseconds(10)) }
            try await Task.sleep(for: .milliseconds(100))
            operation.cancel()
            do { _ = try await operation.value; XCTFail("Cancelled COMMIT succeeded") }
            catch { XCTAssertEqual((error as? SwiftDatabaseError)?.code, "commit_uncertain") }
            let count = await state.count
            XCTAssertEqual(count, 1)
            await database.stop()
        } catch { await database.stop(); throw error }
    }

    func testInFlightLeaseFailureIsDrainedBeforeCommitAndPoolRelease() async throws {
        let fixture = try LocalPostgresFixture(); defer { fixture.stop() }
        let database = try SwiftDatabase(configuration: configuration(fixture.url + "&connection_limit=1&socket_timeout=5"), verification: true)
        let observer = try SwiftDatabase(configuration: configuration(fixture.url + "&connection_limit=1"), verification: true)
        try await database.start(); try await observer.start()
        do {
            try await database.execute("CREATE TABLE lease_records (id text PRIMARY KEY)", [])
            try await observer.execute("SELECT pg_advisory_lock(718231::bigint)", [])
            let publication = InFlightLeasePublication()
            let transaction = Task {
                try await database.transaction { connection in
                    try await connection.execute("INSERT INTO lease_records VALUES ('must-rollback')", [])
                    let backend = try await connection.rows("SELECT pg_backend_pid() AS pid", [])
                    let pid = backend[0]["pid"]
                    let orphan = Task {
                        try await connection.execute("DO $$ BEGIN PERFORM pg_advisory_xact_lock(718231::bigint); RAISE EXCEPTION 'synthetic late failure' USING ERRCODE='22012'; END $$", [])
                    }
                    await publication.publish(connection, orphan)
                    // The server confirms the statement is running and blocked before work returns.
                    let deadline = ContinuousClock.now.advanced(by: .seconds(3))
                    while ContinuousClock.now < deadline {
                        let rows = try await observer.rows("SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1::integer", [pid])
                        if rows.first?.text("wait_event_type") == "Lock" { return "incorrect success" }
                        try await Task.sleep(for: .milliseconds(10))
                    }
                    throw NativeFailure("Fixture statement did not reach its advisory-lock barrier")
                }
            }
            let (connection, orphan) = try await publication.value()
            // This observes finish sealing the lease, not an arbitrary delay or scheduler guess.
            let deadline = ContinuousClock.now.advanced(by: .seconds(3))
            var sealed = false
            while ContinuousClock.now < deadline {
                do { _ = try await connection.rows("SELECT 1", []) }
                catch let error as SwiftDatabaseError {
                    if error.code == "connection_released" { sealed = true; break }
                    XCTAssertEqual(error.code, "connection_busy")
                }
                try await Task.sleep(for: .milliseconds(10))
            }
            XCTAssertTrue(sealed, "Transaction finish must seal the lease before draining")
            try await observer.execute("SELECT pg_advisory_unlock(718231::bigint)", [])
            do { _ = try await transaction.value; XCTFail("Late statement failure escaped COMMIT as success") }
            catch { XCTAssertEqual((error as? SwiftDatabaseError)?.sqlState, "22012") }
            do { try await orphan.value; XCTFail("Synthetic late statement unexpectedly succeeded") }
            catch { XCTAssertEqual((error as? SwiftDatabaseError)?.sqlState, "22012") }
            let records = try await database.rows("SELECT count(*) AS count FROM lease_records", [])
            XCTAssertEqual(records.first?["count"], .integer(0))
            // A new transaction on the sole pooled connection remains usable after rollback/drain.
            try await database.transaction { connection in
                try await connection.execute("INSERT INTO lease_records VALUES ('next-transaction')", [])
            }
            let remaining = try await database.rows("SELECT id FROM lease_records", [])
            XCTAssertEqual(remaining.map { $0.text("id") }, ["next-transaction"])
            await database.stop(); await observer.stop()
        } catch { await database.stop(); await observer.stop(); throw error }
    }

    func testDrainingStalledLeaseOperationIsBoundedBeforeCommit() async throws {
        let fixture = try LocalPostgresFixture(); defer { fixture.stop() }
        let database = try SwiftDatabase(configuration: configuration(fixture.url + "&connection_limit=1&socket_timeout=1"), verification: true)
        let observer = try SwiftDatabase(configuration: configuration(fixture.url + "&connection_limit=1"), verification: true)
        try await database.start(); try await observer.start()
        do {
            try await observer.execute("SELECT pg_advisory_lock(718232::bigint)", [])
            let publication = InFlightLeasePublication()
            let started = ContinuousClock.now
            let transaction = Task {
                try await database.transaction { connection in
                    let backend = try await connection.rows("SELECT pg_backend_pid() AS pid", [])
                    let pid = backend[0]["pid"]
                    let orphan = Task { try await connection.execute("SELECT pg_advisory_xact_lock(718232::bigint)", []) }
                    await publication.publish(connection, orphan)
                    let deadline = ContinuousClock.now.advanced(by: .seconds(3))
                    while ContinuousClock.now < deadline {
                        let rows = try await observer.rows("SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1::integer", [pid])
                        if rows.first?.text("wait_event_type") == "Lock" { return }
                        try await Task.sleep(for: .milliseconds(10))
                    }
                    throw NativeFailure("Fixture statement did not reach its advisory-lock barrier")
                }
            }
            let (_, orphan) = try await publication.value()
            do { try await transaction.value; XCTFail("Timed-out orphan statement escaped as success") }
            catch {
                let failure = error as? SwiftDatabaseError
                XCTAssertNotNil(failure)
                XCTAssertNotEqual(failure?.code, "commit_uncertain", "No COMMIT may begin before the orphan finishes")
                XCTAssertTrue(failure?.sqlState == "57014" || failure?.code == "query_timeout" || failure?.code == "connection_error")
            }
            XCTAssertLessThan(started.duration(to: .now), .seconds(4), "SQL deadline must bound lease drain")
            _ = await orphan.result
            try await observer.execute("SELECT pg_advisory_unlock(718232::bigint)", [])
            let recovered = try await database.rows("SELECT 11 AS answer", [])
            XCTAssertEqual(recovered.first?["answer"], .integer(11))
            await database.stop(); await observer.stop()
        } catch { await database.stop(); await observer.stop(); throw error }
    }

    func testTransactionPoolingKeepsStandaloneReadsAndWritesInConfiguredSchema() async throws {
        let fixture = try LocalPostgresFixture(); defer { fixture.stop() }
        let observer = try SwiftDatabase(configuration: configuration(fixture.url), verification: true)
        let database = try SwiftDatabase(configuration: configuration(fixture.url + "&pgbouncer=true&schema=pooled_scope&socket_timeout=2&connection_limit=1"), verification: true)
        try await observer.start(); try await database.start()
        do {
            try await observer.execute("CREATE SCHEMA pooled_scope", [])
            try await observer.execute("CREATE TABLE pooled_scope.setting_log (schema_name text, zone_name text, timeout_value text, isolation_value text)", [])
            try await database.execute("INSERT INTO setting_log SELECT current_setting('search_path'), current_setting('TimeZone'), current_setting('statement_timeout'), current_setting('transaction_isolation')", [])
            let written = try await observer.rows("SELECT * FROM pooled_scope.setting_log", [])
            XCTAssertEqual(written.first?.text("schema_name"), "pooled_scope")
            XCTAssertEqual(written.first?.text("zone_name"), "UTC")
            XCTAssertEqual(written.first?.text("timeout_value"), "2s")
            XCTAssertEqual(written.first?.text("isolation_value"), "serializable")
            let read = try await database.rows("SELECT current_setting('search_path') AS schema_name, current_setting('TimeZone') AS zone_name, current_setting('statement_timeout') AS timeout_value, current_setting('transaction_isolation') AS isolation_value", [])
            XCTAssertEqual(read.first?.text("schema_name"), "pooled_scope")
            XCTAssertEqual(read.first?.text("zone_name"), "UTC")
            XCTAssertEqual(read.first?.text("timeout_value"), "2s")
            XCTAssertEqual(read.first?.text("isolation_value"), "serializable")
            let explicit = try await database.transaction { connection in
                try await connection.rows("SELECT current_setting('search_path') AS schema_name, current_setting('TimeZone') AS zone_name, current_setting('statement_timeout') AS timeout_value", [])
            }
            XCTAssertEqual(explicit.first?.text("schema_name"), "pooled_scope")
            XCTAssertEqual(explicit.first?.text("zone_name"), "UTC")
            XCTAssertEqual(explicit.first?.text("timeout_value"), "2s")
            await database.stop(); await observer.stop()
        } catch { await database.stop(); await observer.stop(); throw error }
    }

    func testPoolTimeoutNamesTheConnectionFailure() async throws {
        let plain = try LocalPostgresFixture(); defer { plain.stop() }
        let secure = try LocalPostgresFixture(tls: true); defer { secure.stop() }
        let required = "sslmode=require&pool_timeout=1&connect_timeout=2"
        let cases = [
            (plain.url.replacingOccurrences(of: "sslmode=disable", with: required), "tls_unavailable"),
            // A self-signed certificate is exactly what an untrusted Supabase root looked like.
            (secure.url.replacingOccurrences(of: "@127.0.0.1:", with: "@localhost:").replacingOccurrences(of: "sslmode=disable", with: required), "tls_verification_failed"),
            (plain.url.replacingOccurrences(of: "tester:", with: "tester:wrong") + "&pool_timeout=1", "authentication_failed")
        ]
        for (url, expected) in cases {
            let database = try SwiftDatabase(configuration: configuration(url), verification: true)
            try await database.start()
            do { _ = try await database.rows("SELECT 1", []); XCTFail("\(expected) target answered") }
            catch { XCTAssertEqual((error as? SwiftDatabaseError)?.code, expected) }
            await database.stop()
        }
        XCTAssertTrue(SwiftDatabaseError("tls_verification_failed").isUnavailable)
        XCTAssertFalse(SwiftDatabaseError("authentication_failed").isUnavailable)
    }

    func testReturningWritesDecodeRowsExactly() async throws {
        let fixture = try LocalPostgresFixture(); defer { fixture.stop() }
        let database = try SwiftDatabase(configuration: configuration(fixture.url), verification: true)
        try await database.start()
        do {
            try await database.execute("CREATE TABLE ledger (id text PRIMARY KEY, amount numeric(30,6) NOT NULL)", [])
            let inserted = try await database.returning("INSERT INTO ledger VALUES ($1::text, $2::numeric) RETURNING id, amount", [.string("a"), .number(try SwiftValue.decimal("9007199254740993.123456"))])
            XCTAssertEqual(inserted.count, 1)
            XCTAssertEqual(inserted.first?["amount"], .number(try SwiftValue.decimal("9007199254740993.123456")))
            let updated = try await database.transaction { connection in
                try await connection.returning("WITH target AS (SELECT $1::text AS id) UPDATE ledger SET amount = amount + 1 FROM target WHERE ledger.id = target.id RETURNING ledger.amount", [.string("a")])
            }
            XCTAssertEqual(updated.first?["amount"], .number(try SwiftValue.decimal("9007199254740994.123456")))
            do { _ = try await database.returning("DELETE FROM ledger WHERE id = $1::text", [.string("a")]); XCTFail("Write without RETURNING reported rows") }
            catch { XCTAssertEqual((error as? SwiftDatabaseError)?.code, "database_error") }
            let remaining = try await database.rows("SELECT count(*)::int AS remaining FROM ledger", [])
            XCTAssertEqual(remaining.first?["remaining"], .number(1))
            await database.stop()
        } catch { await database.stop(); throw error }
    }

    private func configuration(_ url: String) -> BackendConfiguration {
        BackendConfiguration(databaseURL: url, sessionSecret: String(repeating: "s", count: 32), legacyReviewed: true)
    }
}

private actor InFlightLeasePublication {
    private var published: (SwiftSQLConnection, Task<Void, Error>)?
    func publish(_ connection: SwiftSQLConnection, _ task: Task<Void, Error>) { published = (connection, task) }
    func value() async throws -> (SwiftSQLConnection, Task<Void, Error>) {
        let deadline = ContinuousClock.now.advanced(by: .seconds(3))
        while ContinuousClock.now < deadline {
            if let published { return published }
            try await Task.sleep(for: .milliseconds(10))
        }
        throw NativeFailure("Fixture transaction did not publish its active lease")
    }
}

private actor AttemptCounter {
    var count = 0
    func next() -> Int { count += 1; return count }
}

/// Owns a new cluster in a private temporary directory. Never reads app/production configuration.
final class LocalPostgresFixture {
    private let root: URL
    private let binaries = URL(fileURLWithPath: "/opt/homebrew/opt/postgresql@16/bin")
    private var started = false
    let url: String

    /// `tls` serves a fresh self-signed certificate for localhost that no client trusts.
    init(tls: Bool = false) throws {
        guard FileManager.default.isExecutableFile(atPath: binaries.appendingPathComponent("initdb").path) else { throw XCTSkip("Homebrew PostgreSQL 16 fixture toolset is unavailable") }
        root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent("yogurt-swift-foundation-" + UUID().uuidString.lowercased())
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { throw NativeFailure("Fixture socket unavailable") }
        var address = sockaddr_in(); address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size); address.sin_family = sa_family_t(AF_INET); address.sin_addr.s_addr = inet_addr("127.0.0.1")
        let bound = withUnsafePointer(to: &address) { pointer in pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } }
        guard bound == 0 else { close(fd); throw NativeFailure("Fixture bind unavailable") }
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        _ = withUnsafeMutablePointer(to: &address) { pointer in pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(fd, $0, &length) } }
        let port = UInt16(bigEndian: address.sin_port); close(fd)
        let database = "yogurt_e2e_foundation_" + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        let password = UUID().uuidString
        let passwordFile = root.appendingPathComponent("password")
        try Data(password.utf8).write(to: passwordFile, options: .withoutOverwriting)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: passwordFile.path)
        url = "postgresql://tester:\(password)@127.0.0.1:\(port)/\(database)?sslmode=disable"
        do {
            try run("initdb", ["-D", root.appendingPathComponent("cluster").path, "--username", "tester", "--auth-local=reject", "--auth-host=scram-sha-256", "--pwfile", passwordFile.path, "--encoding=UTF8", "--no-locale"])
            var config = "\nlisten_addresses='127.0.0.1'\nport=\(port)\nunix_socket_directories=''\nmax_connections=12\nshared_buffers='16MB'\nlog_statement='none'\nlog_min_error_statement='panic'\n"
            if tls {
                let cluster = root.appendingPathComponent("cluster")
                try run("/usr/bin/openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=localhost", "-keyout", cluster.appendingPathComponent("server.key").path, "-out", cluster.appendingPathComponent("server.crt").path])
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: cluster.appendingPathComponent("server.key").path)
                config += "ssl=on\n"
            }
            let handle = try FileHandle(forWritingTo: root.appendingPathComponent("cluster/postgresql.conf")); try handle.seekToEnd(); try handle.write(contentsOf: Data(config.utf8)); try handle.close()
            try run("pg_ctl", ["-D", root.appendingPathComponent("cluster").path, "-l", root.appendingPathComponent("postgres.log").path, "-w", "-t", "15", "start"])
            started = true
            try run("createdb", ["-h", "127.0.0.1", "-p", String(port), "-U", "tester", database], password: password)
        } catch { stop(); throw error }
    }

    /// Applies only source-controlled migrations to this newly created loopback scratch DB.
    func applyRepositoryMigrations() throws {
        let repository = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let directory = repository.appendingPathComponent("prisma/migrations")
        // Later migrations read Prisma's own history table, so record each one the way `prisma migrate` does.
        let psql = ["--dbname", url, "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--quiet"]
        try run("psql", psql + ["--command", "CREATE TABLE _prisma_migrations (id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL, finished_at timestamptz, migration_name varchar(255) NOT NULL, logs text, rolled_back_at timestamptz, started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count integer NOT NULL DEFAULT 0)"])
        for migration in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            let sql = migration.appendingPathComponent("migration.sql")
            if FileManager.default.fileExists(atPath: sql.path) {
                let name = migration.lastPathComponent
                guard name.range(of: "^[0-9]{14}_[a-z0-9_]+$", options: .regularExpression) != nil else { throw NativeFailure("Unexpected migration name") }
                let checksum = SHA256.hash(data: try Data(contentsOf: sql)).map { String(format: "%02x", $0) }.joined()
                let id = UUID().uuidString.lowercased()
                try run("psql", psql + ["--command", "INSERT INTO _prisma_migrations (id, checksum, migration_name) VALUES ('\(id)', '\(checksum)', '\(name)')"])
                try run("psql", psql + ["--file", sql.path])
                try run("psql", psql + ["--command", "UPDATE _prisma_migrations SET finished_at = now(), applied_steps_count = 1 WHERE id = '\(id)'"])
            }
        }
    }

    func stop() {
        if started { try? run("pg_ctl", ["-D", root.appendingPathComponent("cluster").path, "-m", "immediate", "-w", "stop"]); started = false }
        if FileManager.default.fileExists(atPath: root.path) { try? FileManager.default.removeItem(at: root) }
    }
    deinit { stop() }

    private func run(_ name: String, _ arguments: [String], password: String? = nil) throws {
        let process = Process(); process.executableURL = name.hasPrefix("/") ? URL(fileURLWithPath: name) : binaries.appendingPathComponent(name); process.arguments = arguments
        process.environment = ["PATH": "/usr/bin:/bin", "HOME": root.path, "LANG": "C", "PGPASSWORD": password ?? ""]
        let output = root.appendingPathComponent("tool-output")
        if !FileManager.default.fileExists(atPath: output.path) { FileManager.default.createFile(atPath: output.path, contents: nil, attributes: [.posixPermissions: 0o600]) }
        let handle = try FileHandle(forWritingTo: output); process.standardOutput = handle; process.standardError = handle
        defer { try? handle.close() }
        try process.run(); process.waitUntilExit()
        guard process.terminationStatus == 0 else { throw NativeFailure("Local PostgreSQL fixture setup failed: \(name)") }
    }
}
