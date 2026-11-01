import SwiftUI
import AppKit
import CryptoKit
import UniformTypeIdentifiers

@MainActor final class AppModel: ObservableObject, NativeReadSource {
    @Published var session: NativeSession? {
        didSet {
            if session?.userId != oldValue?.userId || session?.role != oldValue?.role || session?.source != oldValue?.source { readCache.invalidate() }
        }
    }
    @Published var selected: Destination = .overview
    @Published var contextStoreId: String?
    @Published var notice: String?
    @Published var startupState = "ກຳລັງກຽມແອັບ…"
    @Published var ready = false
    @Published var startupError: String?
    @Published var needsConfiguration = false
    @Published var legacyReviewed = false
    @Published var pendingCommands: [PendingCommand] = []
    /// Sidebar badges from `/api/nav-counts`, the same counts the web navigation shows.
    @Published var navCounts: [Destination: Int] = [:]
    @Published var recoveryError: String?
    let dataDirectory: URL
    private let keychain: KeychainStore
    private let client: APIClient
    private let runtime = BackendRuntime()
    private var commands: OperationStore
    private var configuration: BackendConfiguration?
    private var booting = false
    private var inFlight: Set<String> = []
    private var readCache = WorkspaceReadCache()
    private let launch: NativeLaunchOptions?
    private var importedLaunchFile = false
    var canWrite: Bool { ready && session?.source == "database" && legacyReviewed }
    init() {
        let options = try? NativeLaunchOptions(); launch = options
        dataDirectory = options?.verificationRoot ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Yogurt Manager Native")
        let namespace = options?.verificationRoot.map { SHA256.hash(data: Data($0.path.utf8)).map { String(format: "%02x", $0) }.joined() }
        let storage = KeychainStore(service: namespace.map { "com.yogurt.manager.native.verification.\($0)" } ?? "com.yogurt.manager.native"); keychain = storage; client = APIClient(keychain: storage)
        commands = OperationStore(directory: dataDirectory.appendingPathComponent("unconfigured"))
        runtime.didExit = { [weak self] in self?.ready = false; self?.startupError = "Backend ປິດແລ້ວ. ລາຍການຄ້າງຍັງຢູ່; ເປີດແອັບໃໝ່ເພື່ອກວດກາ" }
    }
    func start() async {
        guard !booting, !ready else { return }
        guard let launch else { startupError = "ຕົວເລືອກເປີດແອັບບໍ່ຖືກຕ້ອງ"; return }
        booting = true; defer { booting = false }
        startupError = nil; startupState = "ກຳລັງອ່ານການຕັ້ງຄ່າຈາກ Keychain…"
        do {
            if !importedLaunchFile, let file = launch.configurationFile {
                importedLaunchFile = true
                var imported = try readConfigurationFile(file)
                if launch.isVerification { imported.legacyReviewed = true }
                try await keychain.write(JSONEncoder().encode(imported), account: "configuration-v1")
                try await client.clearSession()
            }
            guard let bytes = try await keychain.read("configuration-v1") else { needsConfiguration = true; return }
            let config = try JSONDecoder().decode(BackendConfiguration.self, from: bytes)
            try BackendConfiguration.validate(config.databaseURL, verification: launch.isVerification); configuration = config; legacyReviewed = config.legacyReviewed
            let scope = SHA256.hash(data: Data(config.scopeIdentifier.utf8)).map { String(format: "%02x", $0) }.joined()
            commands = OperationStore(directory: dataDirectory.appendingPathComponent("projects/\(scope)"))
            if let review = launch.recoveryReviewFile { try await importLegacyReview(review) }
            startupState = "ກຳລັງເປີດ backend ພາຍໃນແອັບ…"
            let capability = try await runtime.start(configuration: config, dataRoot: dataDirectory.appendingPathComponent("projects/\(scope)/runtime"))
            try await client.configure(capability: capability)
            ready = true; needsConfiguration = false
            do { try await refreshSession() } catch { startupError = error.localizedDescription }
        } catch { await runtime.waitForStop(); ready = false; startupError = error.localizedDescription }
    }
    func importConfiguration(_ url: URL) async throws {
        guard !ready, !booting else { throw NativeFailure("ປິດແອັບກ່ອນປ່ຽນຖານຂໍ້ມູນ") }
        let scoped = url.startAccessingSecurityScopedResource(); defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let config = try readConfigurationFile(url)
        try await keychain.write(JSONEncoder().encode(config), account: "configuration-v1")
        try await client.clearSession(); session = nil; configuration = config; needsConfiguration = false
        await start()
    }
    private func readConfigurationFile(_ url: URL) throws -> BackendConfiguration {
        let info = try FileManager.default.attributesOfItem(atPath: url.path)
        guard info[.type] as? FileAttributeType == .typeRegular, (info[.size] as? NSNumber)?.intValue ?? Int.max <= 1024 * 1024,
              (info[.ownerAccountID] as? NSNumber)?.uint32Value == getuid() else { throw NativeFailure("ໄຟລ໌ຕັ້ງຄ່າບໍ່ຖືກຕ້ອງ") }
        var imported = try BackendConfiguration.fromEnvironment(String(contentsOf: url, encoding: .utf8), previous: configuration, verification: launch?.isVerification == true)
        let oldProfile = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Yogurt Manager")
        if !FileManager.default.fileExists(atPath: oldProfile.path) { imported.legacyReviewed = true }
        return imported
    }
    func login(email: String, password: String) async throws {
        startupError = nil
        let body = try JSONValue.object(["email": .string(email), "password": .string(password)]).encoded()
        let result = try await client.send(path: "/api/auth/login", method: "POST", body: body)
        guard result.successful else { throw NativeFailure(result.error) }
        try await refreshSession()
        guard session?.source == "database" else { throw NativeFailure("ເຂົ້າລະບົບຍັງບໍ່ສຳເລັດ") }
    }
    func logout() async throws {
        guard inFlight.isEmpty else { throw NativeFailure("ລໍລາຍການທີ່ກຳລັງສົ່ງໃຫ້ສິ້ນສຸດກ່ອນ") }
        let result = try await client.send(path: "/api/auth/logout", method: "POST")
        guard result.successful else { throw NativeFailure(result.error) }
        session = nil; pendingCommands = []; contextStoreId = nil; selected = .overview
    }
    func refreshSession() async throws {
        let result = try await client.send(path: "/api/session")
        if result.status == 401 { session = nil; pendingCommands = []; return }
        guard result.successful else { throw NativeFailure(result.error) }
        let fresh = try JSONDecoder().decode(NativeSession.self, from: result.bytes)
        guard ["admin", "production", "driver"].contains(fresh.role), !fresh.userId.isEmpty else { throw NativeFailure("Session ບໍ່ຖືກຕ້ອງ") }
        if session?.userId != fresh.userId { contextStoreId = nil; selected = .overview }
        session = fresh
        if !selected.isAllowed(role: fresh.role) { selected = .overview }
        await refreshPending()
        await refreshCounts()
    }
    func refreshCounts() async {
        guard ready, session != nil, let reply = try? await client.send(path: "/api/nav-counts"), reply.successful else { navCounts = [:]; return }
        var counts: [Destination: Int] = [:]
        for (key, destination) in [("refill", Destination.refills), ("driver", .driver), ("settlements", .settlements), ("inventory", .inventory)] {
            let value = NSDecimalNumber(decimal: reply.data[key].decimal).intValue
            if value > 0 { counts[destination] = value }
        }
        navCounts = counts
    }
    private func authorize() async throws -> NativeSession {
        guard canWrite, let before = session else { throw NativeFailure(legacyReviewed ? "ຕ້ອງເຊື່ອມຕໍ່ຖານຂໍ້ມູນແລະເຂົ້າລະບົບກ່ອນບັນທຶກ" : "ຕ້ອງກວດກາລາຍການຄ້າງຈາກແອັບເດີມກ່ອນໃຊ້ງານ") }
        try await refreshSession()
        guard let fresh = session, fresh.userId == before.userId, fresh.source == "database" else { throw NativeFailure("Session ປ່ຽນແປງ ຫຼືຖານຂໍ້ມູນບໍ່ພ້ອມ. ບໍ່ໄດ້ສົ່ງລາຍການ") }
        return fresh
    }
    func cachedRead(_ resource: String, query: [String: String] = [:]) -> NativeReadResponse? {
        guard ready, let session else { return nil }
        return readCache.value(resource: resource, session: session, query: query)
    }
    func read(_ resource: String, query: [String: String] = [:]) async throws -> NativeReadResponse {
        guard ready, session != nil, resource.range(of: "^[a-z-]+$", options: .regularExpression) != nil else { throw NativeFailure("ກະລຸນາເຂົ້າລະບົບກ່ອນ") }
        let owner = session
        let cacheGeneration = readCache.generation
        var parts = URLComponents(); parts.path = "/api/native/v1/\(resource)"
        parts.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        let result = try await client.send(path: parts.string!)
        if result.status == 401 || result.status == 403 || result.status == 503 { try? await refreshSession() }
        guard result.successful else { throw NativeFailure(result.error) }
        guard session?.userId == owner?.userId, session?.role == owner?.role else { throw NativeFailure("ບັນຊີຫຼືສິດປ່ຽນແປງ; ກະລຸນາໂຫຼດຂໍ້ມູນຄືນ") }
        let value = try JSONDecoder().decode(NativeReadResponse.self, from: result.bytes)
        guard value.version == 1, value.resource == resource else { throw NativeFailure("ຮຸ່ນຂໍ້ມູນບໍ່ຖືກຕ້ອງ") }
        guard readCache.generation == cacheGeneration else { throw NativeFailure("ຂໍ້ມູນປ່ຽນແປງແລ້ວ · ກະລຸນາໂຫຼດຄືນ") }
        if let owner { readCache.store(value, session: owner, query: query, generation: cacheGeneration) }
        return value
    }
    struct PlaceResult: Identifiable, Sendable { let id: String; let name: String; let latitude: Double; let longitude: Double }
    /// OpenStreetMap place search through the backend's `/api/map/search`, as the web map uses.
    func searchPlaces(_ query: String) async throws -> [PlaceResult] {
        guard ready, session != nil else { throw NativeFailure("ກະລຸນາເຂົ້າລະບົບກ່ອນ") }
        var parts = URLComponents(); parts.path = "/api/map/search"; parts.queryItems = [URLQueryItem(name: "q", value: query)]
        let reply = try await client.send(path: parts.string!)
        guard reply.successful else { throw NativeFailure(reply.error) }
        return reply.data["results"].array.compactMap { row in
            guard let latitude = Double(row.text("lat")), let longitude = Double(row.text("lon")) else { return nil }
            return PlaceResult(id: row.text("place_id"), name: row.text("display_name"), latitude: latitude, longitude: longitude)
        }
    }
    func mutate(_ path: String, body: JSONValue, method: String = "POST", durable: Bool = true, draftKey: String? = nil) async throws -> JSONValue {
        let owner = try await authorize()
        let lock = "\(owner.userId):\(method):\(path)"
        guard !inFlight.contains(lock) else { throw NativeFailure("ລາຍການນີ້ກຳລັງສົ່ງ") }
        inFlight.insert(lock); defer { inFlight.remove(lock) }
        let store = commands
        let command = try await store.prepare(userID: owner.userId, method: method, path: path, body: body.encoded(), durable: durable, draftKey: draftKey)
        await refreshPending()
        return try await perform(command, store: store)
    }
    private func perform(_ command: PendingCommand, store: OperationStore) async throws -> JSONValue {
        guard session?.userId == command.userID else { throw NativeFailure("ບັນຊີປ່ຽນແປງ. ລາຍການຄ້າງຖືກເກັບໄວ້") }
        // Uncertain outcomes invalidate too; a response can be lost after a commit.
        readCache.invalidate()
        defer { readCache.invalidate() }
        do {
            if let saved = try await store.outcome(command) {
                try await store.resolve(command); await refreshPending()
                guard saved.state == .succeeded else { throw NativeFailure(saved.state == .reconciled ? "ລາຍການນີ້ກວດກາແລ້ວ. ໂຫຼດຜົນລ່າສຸດກ່ອນເລີ່ມໃໝ່" : saved.result.text("error")) }
                return saved.result
            }
            let reply = try await client.send(path: command.path, method: command.method, body: command.body, operationKey: command.durable ? command.id : nil, userID: command.userID)
            guard !reply.successful || !reply.data.object.isEmpty else { throw NativeFailure("Backend ຕອບກັບບໍ່ສົມບູນ. ລາຍການຖືກເກັບເປັນຄ້າງໄວ້ເພື່ອກວດກາ") }
            if OperationStore.isDefinite(status: reply.status, retryable: reply.retryable, durable: command.durable) {
                try await store.recordOutcome(command, state: reply.successful ? .succeeded : .rejected, result: reply.data)
                try await store.resolve(command); await refreshPending()
            }
            if reply.status == 401 || reply.status == 503 { try? await refreshSession() }
            guard reply.successful else { throw NativeFailure(reply.error) }
            return reply.data
        } catch { await refreshPending(); throw error }
    }
    func hasPendingCommand(path: String, method: String = "POST") async -> Bool {
        guard let session else { return true }
        do { return try await commands.pending(userID: session.userId).contains { $0.path == path && $0.method == method } }
        catch { recoveryError = error.localizedDescription; return true }
    }
    func refreshPending() async {
        guard let session else { return }
        do { pendingCommands = try await commands.pending(userID: session.userId); recoveryError = nil }
        catch { recoveryError = "ອ່ານລາຍການຄ້າງບໍ່ໄດ້. ເກັບໄຟລ໌ຕົ້ນສະບັບໄວ້ແລະກວດກາກ່ອນ" }
    }
    func retry(_ command: PendingCommand) async throws -> JSONValue {
        let owner = try await authorize()
        guard command.userID == owner.userId, command.durable else { throw NativeFailure("ລາຍການນີ້ຕ້ອງກວດຜົນກ່ອນ; ບໍ່ສາມາດສົ່ງຊ້ຳອັດຕະໂນມັດ") }
        guard try await commands.pending(userID: owner.userId).contains(command) else { throw NativeFailure("ລາຍການນີ້ບໍ່ໄດ້ຄ້າງແລ້ວ; ໂຫຼດໜ້າວຽກເພື່ອກວດຜົນ") }
        let lock = "\(owner.userId):\(command.method):\(command.path)"
        guard !inFlight.contains(lock) else { throw NativeFailure("ລາຍການກຳລັງສົ່ງ") }; inFlight.insert(lock); defer { inFlight.remove(lock) }
        return try await perform(command, store: commands)
    }
    func confirmReconciled(_ command: PendingCommand) async throws {
        let owner = try await authorize()
        guard command.userID == owner.userId else { throw NativeFailure("ບັນຊີບໍ່ກົງກັບລາຍການ") }
        guard !inFlight.contains("\(owner.userId):\(command.method):\(command.path)") else { throw NativeFailure("ລາຍການນີ້ກຳລັງສົ່ງ; ລໍຜົນກ່ອນຢືນຢັນ") }
        if try await commands.outcome(command) == nil { try await commands.recordOutcome(command, state: .reconciled, result: .null) }
        try await commands.resolve(command); await refreshPending()
    }
    func saveDraft(key: String, body: JSONValue) async throws {
        guard let session else { throw NativeFailure("ຕ້ອງເຂົ້າລະບົບເພື່ອເກັບສະບັບຮ່າງ") }
        try await commands.saveDraft(userID: session.userId, name: key, value: body)
    }
    func loadDraft(key: String) async throws -> JSONValue? { guard let session else { return nil }; return try await commands.loadDraft(userID: session.userId, name: key) }
    func removeDraft(key: String, startNewIntent: Bool = false) async throws { guard let session else { return }; try await commands.removeDraft(userID: session.userId, name: key, startNewIntent: startNewIntent) }
    func navigate(_ destination: Destination, storeId: String? = nil) {
        guard let role = session?.role, destination.isAllowed(role: role) else { showNotice("ບໍ່ມີສິດເປີດໜ້ານີ້"); return }
        contextStoreId = storeId; selected = destination
        Task { await refreshCounts() }
    }
    func showNotice(_ text: String) { notice = text }
    func importLegacyReview(_ url: URL) async throws {
        guard var configuration, launch?.isVerification != true else { throw NativeFailure("ກະລຸນາເຊື່ອມຕໍ່ຖານຂໍ້ມູນກ່ອນ") }
        let scoped = url.startAccessingSecurityScopedResource(); defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let values = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
        guard values.isRegularFile == true, (values.fileSize ?? Int.max) <= 8 * 1024 * 1024 else { throw NativeFailure("ໄຟລ໌ກວດກາບໍ່ຖືກຕ້ອງ") }
        let data = try Data(contentsOf: url); let review = try LegacyRecoveryReview.read(data)
        try FileManager.default.createDirectory(at: dataDirectory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let archived = dataDirectory.appendingPathComponent("legacy-recovery-\(UUID().uuidString).json")
        try data.write(to: archived, options: .atomic); try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: archived.path)
        guard review.records.isEmpty else { throw NativeFailure("ພົບ \(review.records.count) ລາຍການຈາກແອັບເດີມ. ເກັບຕົ້ນສະບັບໄວ້ແລ້ວ; ຕ້ອງກວດແລະຈັດການໃນແອັບເດີມກ່ອນເລີ່ມບັນທຶກໃນ Native") }
        let scope = SHA256.hash(data: Data(configuration.scopeIdentifier.utf8)).map { String(format: "%02x", $0) }.joined()
        let oldRuntime = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Yogurt Manager/runtime")
        _ = try await RuntimeDataMigration().importLegacy(source: oldRuntime, target: dataDirectory.appendingPathComponent("projects/\(scope)/runtime"), fingerprint: configuration.databaseFingerprint)
        configuration.legacyReviewed = true
        try await keychain.write(JSONEncoder().encode(configuration), account: "configuration-v1")
        self.configuration = configuration; legacyReviewed = true
    }
    func openReceipt(_ path: String) async throws {
        guard session?.role == "admin" else { throw NativeFailure("ບໍ່ມີສິດເປີດໃບເສັດ") }
        let receiptPath = try ReceiptRoute.canonical(path)
        let reply = try await client.send(path: receiptPath)
        guard reply.successful else { throw NativeFailure(reply.error) }
        let folder = dataDirectory.appendingPathComponent("preview")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let file = folder.appendingPathComponent(URL(fileURLWithPath: path).lastPathComponent)
        try reply.bytes.write(to: file, options: .atomic); try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        NSWorkspace.shared.open(file)
    }
    func uploadReceipt(_ url: URL) async throws -> String {
        _ = try await authorize()
        guard session?.role == "admin" else { throw NativeFailure("ບໍ່ມີສິດແນບໃບເສັດ") }
        let scoped = url.startAccessingSecurityScopedResource(); defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size > 0, size <= 5 * 1024 * 1024 else { throw NativeFailure("ໃບເສັດຕ້ອງມີຂໍ້ມູນ ແລະບໍ່ເກີນ 5 MB") }
        let types = ["jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "pdf": "application/pdf"]
        guard let type = types[url.pathExtension.lowercased()] else { throw NativeFailure("ຮອງຮັບ JPG, PNG, WEBP ຫຼື PDF") }
        let boundary = UUID().uuidString; var bytes = Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"receipt.\(url.pathExtension.lowercased())\"\r\nContent-Type: \(type)\r\n\r\n".utf8)
        bytes.append(try Data(contentsOf: url)); bytes.append(Data("\r\n--\(boundary)--\r\n".utf8))
        let reply = try await client.send(path: "/api/uploads/receipts", method: "POST", body: bytes, contentType: "multipart/form-data; boundary=\(boundary)")
        guard reply.successful, !reply.data.text("url").isEmpty else { throw NativeFailure(reply.error) }
        return reply.data.text("url")
    }
    func exportCSV(name: String, headers: [String], rows: [[String]]) {
        let panel = NSSavePanel(); panel.allowedContentTypes = [.commaSeparatedText]; panel.nameFieldStringValue = "\(name)-\(businessDateString(Date())).csv"
        panel.begin { [weak self] response in
            guard response == .OK, let url = panel.url else { return }
            do { try NativeCSV.encode(headers: headers, rows: rows).write(to: url, atomically: true, encoding: .utf8) }
            catch { Task { @MainActor in self?.showNotice("ສົ່ງອອກ CSV ບໍ່ໄດ້: \(error.localizedDescription)") } }
        }
    }
    func shutdown() async { ready = false; await runtime.waitForStop(); try? FileManager.default.removeItem(at: dataDirectory.appendingPathComponent("preview")); if launch?.isVerification == true { try? await keychain.remove("session-cookie"); try? await keychain.remove("configuration-v1") } }
}
