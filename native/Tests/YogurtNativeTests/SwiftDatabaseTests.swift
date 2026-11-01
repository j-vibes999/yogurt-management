import XCTest
import Foundation
import Darwin
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
        }
        for query in ["schema=bad%2Cpublic", "connection_limit=999", "connect_timeout=0", "pool_timeout=not-a-number", "socket_timeout=-1"] {
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

    private func configuration(_ url: String) -> BackendConfiguration {
        BackendConfiguration(databaseURL: url, sessionSecret: String(repeating: "s", count: 32), legacyReviewed: true)
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

    init() throws {
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
            let config = "\nlisten_addresses='127.0.0.1'\nport=\(port)\nunix_socket_directories=''\nmax_connections=12\nshared_buffers='16MB'\nlog_statement='none'\nlog_min_error_statement='panic'\n"
            let handle = try FileHandle(forWritingTo: root.appendingPathComponent("cluster/postgresql.conf")); try handle.seekToEnd(); try handle.write(contentsOf: Data(config.utf8)); try handle.close()
            try run("pg_ctl", ["-D", root.appendingPathComponent("cluster").path, "-l", root.appendingPathComponent("postgres.log").path, "-w", "-t", "15", "start"])
            started = true
            try run("createdb", ["-h", "127.0.0.1", "-p", String(port), "-U", "tester", database], password: password)
        } catch { stop(); throw error }
    }

    func stop() {
        if started { try? run("pg_ctl", ["-D", root.appendingPathComponent("cluster").path, "-m", "immediate", "-w", "stop"]); started = false }
        if FileManager.default.fileExists(atPath: root.path) { try? FileManager.default.removeItem(at: root) }
    }
    deinit { stop() }

    private func run(_ name: String, _ arguments: [String], password: String? = nil) throws {
        let process = Process(); process.executableURL = binaries.appendingPathComponent(name); process.arguments = arguments
        process.environment = ["PATH": "/usr/bin:/bin", "HOME": root.path, "LANG": "C", "PGPASSWORD": password ?? ""]
        let output = root.appendingPathComponent("tool-output")
        if !FileManager.default.fileExists(atPath: output.path) { FileManager.default.createFile(atPath: output.path, contents: nil, attributes: [.posixPermissions: 0o600]) }
        let handle = try FileHandle(forWritingTo: output); process.standardOutput = handle; process.standardError = handle
        defer { try? handle.close() }
        try process.run(); process.waitUntilExit()
        guard process.terminationStatus == 0 else { throw NativeFailure("Local PostgreSQL fixture setup failed: \(name)") }
    }
}
