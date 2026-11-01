import Foundation
import CryptoKit
import PostgresNIO
import NIOSSL
import Logging

/// Contains no SQL, parameter values, server detail, or underlying errors.
struct SwiftDatabaseError: Error, Sendable, LocalizedError, CustomStringConvertible {
    let code: String
    let sqlState: String?
    let rollbackConfirmed: Bool
    fileprivate let receiptConflict: Bool
    init(_ code: String, sqlState: String? = nil, rollbackConfirmed: Bool = false, receiptConflict: Bool = false) {
        self.code = code; self.sqlState = sqlState; self.rollbackConfirmed = rollbackConfirmed; self.receiptConflict = receiptConflict
    }
    var description: String { "Database error: \(code)" + (sqlState.map { " (\($0))" } ?? "") }
    var errorDescription: String? { description }
    /// The database was unreachable or its secure channel failed; reads may show offline data.
    var isUnavailable: Bool { sqlState == nil && ["connection_error", "pool_timeout", "not_running", "tls_verification_failed", "tls_unavailable"].contains(code) }
    fileprivate static func safe(_ error: Error) -> SwiftDatabaseError {
        if let safe = error as? SwiftDatabaseError { return safe }
        if let postgres = error as? PSQLError {
            let state = postgres.serverInfo?[.sqlState]
            return SwiftDatabaseError("database_error", sqlState: state?.range(of: "^[A-Z0-9]{5}$", options: .regularExpression) != nil ? state : nil, receiptConflict: state == "23505" && postgres.serverInfo?[.constraintName] == "operation_receipts_user_id_scope_key_key")
        }
        return SwiftDatabaseError(error is CancellationError ? "cancelled" : "connection_error")
    }
}

/// Validated settings are shared by configuration inspection and the real client factory.
struct SwiftDatabaseOptions: Sendable {
    let clientConfiguration: PostgresClient.Configuration
    let schema: String
    let poolTimeout: Int
    let connectTimeout: Int
    let statementTimeout: Int
    let requiresTLS: Bool
    let transactionPooling: Bool
    var verifiesCertificateAndHostname: Bool { tlsConfiguration.certificateVerification == .fullVerification }
    let tlsConfiguration: TLSConfiguration
    let tlsServerName: String

    init(configuration: BackendConfiguration, verification: Bool) throws {
        do { try BackendConfiguration.validate(configuration.databaseURL, verification: verification) }
        catch { throw SwiftDatabaseError("invalid_configuration") }
        guard let url = URLComponents(string: configuration.databaseURL), let host = url.host, let username = url.user else { throw SwiftDatabaseError("invalid_configuration") }
        let query = Dictionary(uniqueKeysWithValues: (url.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        guard query["pgbouncer"] == nil || ["true", "false"].contains(query["pgbouncer"]!) else { throw SwiftDatabaseError("invalid_configuration") }
        transactionPooling = url.port == 6543 || query["pgbouncer"] == "true"
        func bounded(_ name: String, default fallback: Int, maximum: Int) throws -> Int {
            guard let text = query[name] else { return fallback }
            guard text.range(of: "^[0-9]+$", options: .regularExpression) != nil, let number = Int(text), (1...maximum).contains(number) else { throw SwiftDatabaseError("invalid_configuration") }
            return number
        }
        schema = query["schema"] ?? "public"
        guard schema.utf8.count <= 63, schema.range(of: "^[A-Za-z_][A-Za-z0-9_]*$", options: .regularExpression) != nil else { throw SwiftDatabaseError("invalid_configuration") }
        let maximumConnections = try bounded("connection_limit", default: 5, maximum: 20)
        connectTimeout = try bounded("connect_timeout", default: 10, maximum: 60)
        poolTimeout = try bounded("pool_timeout", default: 15, maximum: 120)
        statementTimeout = try bounded("socket_timeout", default: 30, maximum: 120)
        guard url.port == nil || (1...65535).contains(url.port!) else { throw SwiftDatabaseError("invalid_configuration") }
        // sslmode=require / verify-ca must never weaken the production trust policy.
        requiresTLS = !verification || query["sslmode"] != "disable"
        var tls = TLSConfiguration.makeClientConfiguration()
        tls.certificateVerification = .fullVerification
        // Supabase signs database certificates with its own root, and its server certificates
        // (5-year validity, no serverAuth usage) fail Apple's TLS policy even with that root as
        // an anchor. Verify chain and hostname against only the pinned root instead; production
        // hosts are restricted to Supabase, so no other root is needed.
        tls.trustRoots = .certificates([try SupabaseTrust.root()])
        tlsConfiguration = tls
        tlsServerName = host
        var client = PostgresClient.Configuration(host: host, port: url.port ?? 5432, username: username, password: url.password, database: String(url.path.dropFirst()), tls: requiresTLS ? .require(tls) : .disable)
        client.options.maximumConnections = maximumConnections
        client.options.minimumConnections = 0
        client.options.connectTimeout = .seconds(connectTimeout)
        client.options.tlsServerName = requiresTLS ? host : nil
        client.options.keepAliveBehavior = nil
        clientConfiguration = client
    }
}

/// Supabase Root 2021 CA (expires 2031-04-26), bundled as a resource and pinned by the
/// SHA-256 of its DER bytes so a swapped file can never widen what the app trusts.
enum SupabaseTrust {
    static let fingerprint = "807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa"
    static func root() throws -> NIOSSLCertificate {
        guard let url = Bundle.module.url(forResource: "supabase-root-2021", withExtension: "pem"),
              let pem = try? Data(contentsOf: url),
              let certificate = try? NIOSSLCertificate(bytes: Array(pem), format: .pem),
              let der = try? certificate.toDERBytes(),
              SHA256.hash(data: der).map({ String(format: "%02x", $0) }).joined() == fingerprint else { throw SwiftDatabaseError("tls_configuration") }
        return certificate
    }
}

/// An expiring lease; returning this value from a transaction never retains authorization
/// to use a pooled connection once that transaction has completed.
struct SwiftSQLConnection: Sendable {
    fileprivate let lease: SwiftSQLLease
    func rows(_ sql: String, _ values: [JSONValue] = []) async throws -> [JSONValue] { try await lease.perform(sql, values, read: true) }
    func execute(_ sql: String, _ values: [JSONValue] = []) async throws { _ = try await lease.perform(sql, values, read: false) }
    /// INSERT/UPDATE/DELETE … RETURNING; the returned rows decode exactly like `rows`.
    func returning(_ sql: String, _ values: [JSONValue] = []) async throws -> [JSONValue] { try await lease.perform(sql, values, read: false, returning: true) }
}

private actor SwiftSQLLease {
    let connection: PostgresConnection
    let timeout: Int
    private var active = true
    private var busy = false
    private var failure: SwiftDatabaseError?
    private var drainWaiters: [CheckedContinuation<Void, Never>] = []
    init(_ connection: PostgresConnection, timeout: Int) { self.connection = connection; self.timeout = timeout }
    func invalidate() async {
        // Seal before suspending: captured leases cannot start another query during drain.
        active = false
        if busy { await withCheckedContinuation { drainWaiters.append($0) } }
    }
    func finish() async throws {
        // The driver's statement deadline/watchdog also bounds an orphaned operation here.
        await invalidate()
        if let failure { throw failure }
    }
    func perform(_ sql: String, _ values: [JSONValue], read: Bool, returning: Bool = false) async throws -> [JSONValue] {
        guard active else { throw SwiftDatabaseError("connection_released") }
        guard !busy else { throw SwiftDatabaseError("connection_busy") }
        busy = true
        defer {
            busy = false
            let waiters = drainWaiters; drainWaiters.removeAll()
            for waiter in waiters { waiter.resume() }
        }
        do { return try await SwiftSQLDriver.run(connection, sql, values, read: read, returning: returning, timeout: timeout) }
        catch let error as SwiftDatabaseError { failure = error; throw error }
    }
}

actor SwiftDatabase {
    private let client: PostgresClient
    private let options: SwiftDatabaseOptions
    private let diagnosis = ConnectionDiagnosis()
    private var runner: Task<Void, Never>?
    private var stopped = false

    init(configuration: BackendConfiguration, verification: Bool = false) throws {
        let options = try SwiftDatabaseOptions(configuration: configuration, verification: verification)
        self.options = options
        client = PostgresClient(configuration: options.clientConfiguration)
    }
    /// Construction and start do not eagerly open connections. Pool work starts explicitly.
    func start() async throws {
        guard !stopped else { throw SwiftDatabaseError("stopped") }
        guard runner == nil else { return }
        let client = client
        runner = Task { await client.run() }
    }
    func stop() async {
        stopped = true
        let running = runner; runner = nil
        running?.cancel()
        await running?.value
    }
    func rows(_ sql: String, _ values: [JSONValue] = []) async throws -> [JSONValue] {
        try ensureRunning()
        if options.transactionPooling {
            return try await transaction { try await $0.rows(sql, values) }
        }
        return try await withConnection { connection in
            try await SwiftSQLDriver.run(connection, sql, values, read: true, timeout: self.options.statementTimeout)
        }
    }
    func execute(_ sql: String, _ values: [JSONValue] = []) async throws {
        try ensureRunning()
        if options.transactionPooling {
            return try await transaction { try await $0.execute(sql, values) }
        }
        _ = try await withConnection { connection in
            try await SwiftSQLDriver.run(connection, sql, values, read: false, timeout: self.options.statementTimeout)
        }
    }
    func returning(_ sql: String, _ values: [JSONValue] = []) async throws -> [JSONValue] {
        try ensureRunning()
        if options.transactionPooling {
            return try await transaction { try await $0.returning(sql, values) }
        }
        return try await withConnection { connection in
            try await SwiftSQLDriver.run(connection, sql, values, read: false, returning: true, timeout: self.options.statementTimeout)
        }
    }
    func transaction<T: Sendable>(_ work: @escaping @Sendable (SwiftSQLConnection) async throws -> T) async throws -> T {
        try ensureRunning()
        for attempt in 0...12 {
            do {
                return try await withConnection(configureSession: false) { connection in
                    let timeout = self.options.statementTimeout
                    let lease = SwiftSQLLease(connection, timeout: timeout)
                    _ = try await SwiftSQLDriver.run(connection, "BEGIN ISOLATION LEVEL SERIALIZABLE", [], read: false, timeout: timeout)
                    var committing = false
                    do {
                        // Supavisor transaction mode pins its backend only after BEGIN. Local
                        // settings therefore cover the exact backend used by all transaction SQL.
                        try await Self.applySettings(connection, options: self.options, local: true)
                        let result = try await work(SwiftSQLConnection(lease: lease))
                        try await lease.finish()
                        try Task.checkCancellation()
                        committing = true
                        _ = try await SwiftSQLDriver.run(connection, "COMMIT", [], read: false, timeout: timeout)
                        return result
                    } catch {
                        await lease.invalidate()
                        let safe = SwiftDatabaseError.safe(error)
                        // A transport failure during COMMIT is indeterminate. Do not retry or reuse.
                        if committing && !(safe.sqlState?.hasPrefix("23") == true || safe.sqlState?.hasPrefix("40") == true) {
                            try? await connection.close()
                            throw SwiftDatabaseError("commit_uncertain")
                        }
                        // Detached cleanup is deliberately not cancelled with the caller.
                        let rolledBack = await Task.detached {
                            do { _ = try await SwiftSQLDriver.run(connection, "ROLLBACK", [], read: false, timeout: timeout); return true }
                            catch { try? await connection.close(); return false }
                        }.value
                        if let databaseError = error as? SwiftDatabaseError {
                            throw SwiftDatabaseError(databaseError.code, sqlState: databaseError.sqlState, rollbackConfirmed: rolledBack, receiptConflict: databaseError.receiptConflict)
                        }
                        if error is CancellationError { throw CancellationError() }
                        // Work closures own domain validation errors. Driver errors never escape raw.
                        throw error
                    }
                }
            } catch let error as SwiftDatabaseError {
                guard attempt < 12, error.rollbackConfirmed, (["40001", "40P01"].contains(error.sqlState ?? "") || error.receiptConflict) else { throw error }
                let delay = min(500, 12 * (1 << min(attempt, 5))) + Int.random(in: 0..<25)
                try await Task.sleep(for: .milliseconds(delay))
            }
        }
        throw SwiftDatabaseError("retry_exhausted")
    }
    private func ensureRunning() throws {
        guard !stopped else { throw SwiftDatabaseError("stopped") }
        guard runner != nil else { throw SwiftDatabaseError("not_started") }
        try Task.checkCancellation()
    }
    private static func applySettings(_ connection: PostgresConnection, options: SwiftDatabaseOptions, local: Bool) async throws {
        _ = try await SwiftSQLDriver.run(connection,
            "SELECT set_config('search_path', quote_ident($1::text), $3::boolean), set_config('statement_timeout', $2::text, $3::boolean), set_config('TimeZone', 'UTC', $3::boolean)",
            [.string(options.schema), .string(String(options.statementTimeout * 1000)), .bool(local)], read: false, timeout: options.statementTimeout)
    }
    private func withConnection<T: Sendable>(configureSession: Bool = true, _ work: @escaping @Sendable (PostgresConnection) async throws -> T) async throws -> T {
        let client = client; let options = options; let diagnosis = diagnosis
        let acquired = AcquisitionState()
        // The timer covers leasing only, never times out a business closure halfway through COMMIT.
        return try await withThrowingTaskGroup(of: T?.self) { group in
            group.addTask {
                do {
                    return try await client.withConnection { connection in
                        guard await acquired.claim() else { throw SwiftDatabaseError("pool_timeout") }
                        if configureSession { try await Self.applySettings(connection, options: options, local: false) }
                        return try await work(connection)
                    }
                } catch let error as PSQLError { throw SwiftDatabaseError.safe(error) }
            }
            group.addTask {
                do { try await Task.sleep(for: .seconds(options.poolTimeout)) }
                catch is CancellationError { return nil }
                if await acquired.expire() { throw SwiftDatabaseError(await diagnosis.explain(options)) }
                return nil
            }
            defer { group.cancelAll() }
            while let next = try await group.next() { if let value = next { return value } }
            throw SwiftDatabaseError("connection_error")
        }
    }
}

/// The pool retries failed connections silently, so a rejected certificate would only ever
/// look like a slow database. After a pool timeout, one direct attempt with the same settings
/// names the cause. A result is shared for 30 seconds so a busy pool cannot multiply probes.
private actor ConnectionDiagnosis {
    private static let logger = Logger(label: "yogurt.swift.database.diagnosis", factory: { _ in SwiftLogNoOpLogHandler() })
    private var recent: (at: ContinuousClock.Instant, code: String)?
    private var running: Task<String, Never>?

    func explain(_ options: SwiftDatabaseOptions) async -> String {
        if let recent, ContinuousClock.now - recent.at < .seconds(30) { return recent.code }
        if let running { return await running.value }
        // Startup and authentication have no driver deadline, so bound the whole attempt.
        let task = Task { await Self.firstOf({ await Self.attempt(options) }, orAfter: options.connectTimeout + 5) }
        running = task
        let code = await task.value
        running = nil; recent = (ContinuousClock.now, code)
        return code
    }
    private static func attempt(_ options: SwiftDatabaseOptions) async -> String {
        let client = options.clientConfiguration
        guard let host = client.host, let port = client.port else { return "pool_timeout" }
        do {
            let tls: PostgresConnection.Configuration.TLS = options.requiresTLS ? .require(try NIOSSLContext(configuration: options.tlsConfiguration)) : .disable
            var configuration = PostgresConnection.Configuration(host: host, port: port, username: client.username, password: client.password, database: client.database, tls: tls)
            configuration.options.connectTimeout = .seconds(Int64(options.connectTimeout))
            configuration.options.tlsServerName = client.options.tlsServerName
            let connection = try await PostgresConnection.connect(configuration: configuration, id: 0, logger: logger)
            try? await connection.close()
            return "pool_timeout"
        } catch let error as PSQLError {
            if error.code == .sslUnsupported { return "tls_unavailable" }
            if error.serverInfo?[.sqlState]?.hasPrefix("28") == true { return "authentication_failed" }
            return isTLS(error.underlying) ? "tls_verification_failed" : "connection_error"
        } catch { return isTLS(error) ? "tls_verification_failed" : "connection_error" }
    }
    private static func isTLS(_ error: Error?) -> Bool { error is NIOSSLError || error is NIOSSLExtraError || error is BoringSSLError }
    /// Returns without waiting for a stalled attempt; that task ends when its socket does.
    private static func firstOf(_ work: @escaping @Sendable () async -> String, orAfter seconds: Int) async -> String {
        let gate = FirstResult()
        return await withCheckedContinuation { continuation in
            Task { await gate.finish(continuation, await work()) }
            Task { try? await Task.sleep(for: .seconds(seconds)); await gate.finish(continuation, "pool_timeout") }
        }
    }
}

private actor FirstResult {
    private var finished = false
    func finish(_ continuation: CheckedContinuation<String, Never>, _ code: String) {
        guard !finished else { return }
        finished = true; continuation.resume(returning: code)
    }
}

private actor AcquisitionState {
    private enum State { case pending, acquired, expired }
    private var state = State.pending
    func claim() -> Bool {
        guard state == .pending else { return false }
        state = .acquired; return true
    }
    func expire() -> Bool {
        guard state == .pending else { return false }
        state = .expired; return true
    }
}

private enum SwiftSQLDriver {
    private static let logger = Logger(label: "yogurt.swift.database", factory: { _ in SwiftLogNoOpLogHandler() })
    static func run(_ connection: PostgresConnection, _ sql: String, _ values: [JSONValue], read: Bool, returning: Bool = false, timeout: Int) async throws -> [JSONValue] {
        try Task.checkCancellation()
        var binds = PostgresBindings(capacity: values.count)
        for value in values {
            switch value {
            case .null: binds.appendNull()
            case .bool(let flag): binds.append(flag)
            case .number(let decimal):
                guard !decimal.isNaN else { throw SwiftDatabaseError("invalid_binding") }
                binds.append(NSDecimalNumber(decimal: decimal).stringValue)
            case .string(let string): binds.append(string)
            case .object, .array:
                do {
                    let data = try value.encoded()
                    _ = try SwiftValue.decodeJSON(data)
                    binds.append(String(decoding: data, as: UTF8.self))
                } catch { throw SwiftDatabaseError("invalid_binding") }
            }
        }
        var statement = sql.trimmingCharacters(in: .whitespacesAndNewlines)
        if statement.last == ";" { statement.removeLast() }
        // Source-controlled SELECT text is wrapped to preserve numeric JSON tokens and textual
        // timestamp values. Bind values remain positional; no untrusted value enters SQL text.
        if read { statement = "SELECT row_to_json(_yogurt_row)::text FROM (" + statement + ") AS _yogurt_row" }
        // A data-modifying CTE gives RETURNING rows the same exact JSON decoding as reads.
        // PostgreSQL rejects a wrapped statement that has no RETURNING clause.
        else if returning { statement = "WITH _yogurt_write AS (" + statement + ") SELECT row_to_json(_yogurt_write)::text FROM _yogurt_write" }
        let decodesRows = read || returning
        let query = PostgresQuery(unsafeSQL: statement, binds: binds)
        do {
            return try await withTaskCancellationHandler {
                try await withThrowingTaskGroup(of: [JSONValue].self) { group in
                    group.addTask {
                        let stream = try await connection.query(query, logger: logger)
                        var result: [JSONValue] = []
                        for try await row in stream {
                            try Task.checkCancellation()
                            if decodesRows {
                                guard result.count < 100_000 else { throw SwiftDatabaseError("row_limit") }
                                let text = try row[row.startIndex].decode(String.self)
                                let object = try SwiftValue.decodeJSON(Data(text.utf8))
                                guard case .object = object else { throw SwiftDatabaseError("invalid_row") }
                                result.append(object)
                            }
                        }
                        return result
                    }
                    group.addTask {
                        try await Task.sleep(for: .seconds(timeout))
                        try? await connection.close()
                        throw SwiftDatabaseError("query_timeout")
                    }
                    defer { group.cancelAll() }
                    guard let value = try await group.next() else { throw SwiftDatabaseError("connection_error") }
                    return value
                }
            } onCancel: { Task { try? await connection.close() } }
        } catch {
            if Task.isCancelled { throw CancellationError() }
            throw SwiftDatabaseError.safe(error)
        }
    }
}
