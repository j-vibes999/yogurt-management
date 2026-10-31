import Foundation
import Security

@MainActor final class BackendRuntime {
    private var process: Process?
    private var input: FileHandle?
    private var output: FileHandle?
    private var buffer = Data()
    private var heartbeat: Task<Void, Never>?
    private var deadline: Task<Void, Never>?
    private var continuation: CheckedContinuation<String, Error>?
    private var capability = ""
    private var stopping = false
    var didExit: (() -> Void)?

    func start(configuration: BackendConfiguration, dataRoot: URL) async throws -> String {
        guard process == nil else { throw NativeFailure("Backend ເປີດຢູ່ແລ້ວ") }
        guard let resources = Bundle.main.resourceURL else { throw NativeFailure("ບໍ່ພົບຊຸດແອັບ") }
        let helper = Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/yogurt-supervisor")
        let node = resources.appendingPathComponent("runtime/node")
        let bootstrap = resources.appendingPathComponent("runtime/bootstrap.cjs")
        let backend = resources.appendingPathComponent("backend")
        for url in [helper, node, bootstrap, backend] {
            guard FileManager.default.fileExists(atPath: url.path) else { throw NativeFailure("ຊຸດແອັບບໍ່ສົມບູນ. ກະລຸນາເປີດ Yogurt Manager Native.app ທີ່ປະກອບແລ້ວ") }
        }
        try FileManager.default.createDirectory(at: dataRoot, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let appRootPath = try Self.canonicalDirectoryPath(backend)
        let dataRootPath = try Self.canonicalDirectoryPath(dataRoot)
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw NativeFailure("ສ້າງ capability ບໍ່ໄດ້") }
        capability = bytes.map { String(format: "%02x", $0) }.joined()
        stopping = false; buffer.removeAll(keepingCapacity: false)
        let child = Process(); let inbound = Pipe(); let outbound = Pipe(); let diagnostics = Pipe()
        child.executableURL = helper; child.arguments = [node.path, bootstrap.path]
        child.currentDirectoryURL = URL(fileURLWithPath: dataRootPath, isDirectory: true)
        child.environment = ["PATH": "/usr/bin:/bin", "HOME": FileManager.default.homeDirectoryForCurrentUser.path,
                             "TMPDIR": FileManager.default.temporaryDirectory.path]
        child.standardInput = inbound; child.standardOutput = outbound; child.standardError = diagnostics
        input = inbound.fileHandleForWriting; output = outbound.fileHandleForReading
        output?.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            Task { @MainActor [weak self] in self?.receive(data) }
        }
        diagnostics.fileHandleForReading.readabilityHandler = { handle in _ = handle.availableData }
        child.terminationHandler = { [weak self] _ in
            Task { @MainActor [weak self] in self?.exited() }
        }
        return try await withCheckedThrowingContinuation { pending in
            continuation = pending; process = child
            do {
                try child.run()
                try send(.object(["version": .number(1), "type": .string("bootstrap"), "port": .number(43188),
                    "appRoot": .string(appRootPath), "dataRoot": .string(dataRootPath), "capability": .string(capability),
                    "config": .object(["DATABASE_URL": .string(configuration.databaseURL), "SESSION_SECRET": .string(configuration.sessionSecret)])]))
                heartbeat = Task { [weak self] in
                    while !Task.isCancelled {
                        try? await Task.sleep(for: .seconds(2))
                        guard !Task.isCancelled, let self, self.process?.isRunning == true else { return }
                        do { try self.send(.object(["version": .number(1), "type": .string("heartbeat")])) }
                        catch { self.fail(NativeFailure("ຕິດຕໍ່ backend ບໍ່ໄດ້")); return }
                    }
                }
                deadline = Task { [weak self] in
                    try? await Task.sleep(for: .seconds(60))
                    guard !Task.isCancelled, let self, self.continuation != nil else { return }
                    self.fail(NativeFailure("Backend ເປີດບໍ່ທັນເວລາ. ປິດແອັບແລ້ວເປີດໃໝ່"))
                }
            } catch { fail(NativeFailure("ເປີດ backend ບໍ່ສຳເລັດ")) }
        }
    }
    private func send(_ frame: JSONValue) throws {
        guard let input else { throw NativeFailure("Backend ປິດແລ້ວ") }
        var data = try frame.encoded(); data.append(10)
        try input.write(contentsOf: data)
    }
    private func receive(_ data: Data) {
        guard !data.isEmpty else { return }
        buffer.append(data)
        guard buffer.count <= 96 * 1024 else { fail(NativeFailure("Backend protocol ບໍ່ຖືກຕ້ອງ")); return }
        while let end = buffer.firstIndex(of: 10) {
            let line = buffer[..<end]; buffer.removeSubrange(...end)
            guard let event = try? JSONDecoder().decode(JSONValue.self, from: line), event["version"].decimal == 1 else { fail(NativeFailure("Backend protocol ບໍ່ຖືກຕ້ອງ")); return }
            switch event.text("type") {
            case "ready":
                deadline?.cancel(); let waiting = continuation; continuation = nil; waiting?.resume(returning: capability)
            case "failed", "failure":
                fail(NativeFailure(Self.failureMessage(code: event.text("code"))))
            case "shutdown", "stopped": break
            default: fail(NativeFailure("Backend protocol ບໍ່ຖືກຕ້ອງ"))
            }
        }
    }
    private func fail(_ error: Error) {
        deadline?.cancel(); let waiting = continuation; continuation = nil; waiting?.resume(throwing: error)
        stop()
        if waiting == nil { didExit?() }
    }
    private func exited() {
        heartbeat?.cancel(); deadline?.cancel(); output?.readabilityHandler = nil
        try? input?.close(); input = nil; output = nil; process = nil
        let waiting = continuation; continuation = nil
        waiting?.resume(throwing: NativeFailure("Backend ປິດກ່ອນພ້ອມໃຊ້ງານ"))
        if !stopping && waiting == nil { didExit?() }
    }
    func stop() {
        stopping = true; heartbeat?.cancel(); deadline?.cancel()
        try? send(.object(["version": .number(1), "type": .string("shutdown")]))
        try? input?.close(); input = nil
    }
    /// The bootstrap rejects symlinked path components. Foundation reports temporary
    /// folders as /var/..., which is itself a symlink, so resolve with realpath(3).
    nonisolated static func canonicalDirectoryPath(_ url: URL) throws -> String {
        guard let resolved = realpath(url.path, nil) else { throw NativeFailure("ບໍ່ພົບໂຟນເດີຂອງແອັບ") }
        defer { free(resolved) }
        let path = String(cString: resolved)
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory), isDirectory.boolValue else { throw NativeFailure("ບໍ່ພົບໂຟນເດີຂອງແອັບ") }
        return path
    }

    /// Only the supervisor/bootstrap's own codes are shown; anything else could carry backend diagnostics.
    nonisolated static func failureMessage(code: String) -> String {
        switch code {
        case "PORT_BUSY": return "Port 43188 ຖືກໃຊ້ຢູ່. ປິດ Yogurt Manager Native ຕົວທີ່ເປີດຄ້າງແລ້ວລອງໃໝ່ (PORT_BUSY)"
        case "CONFIGURATION": return "ການຕັ້ງຄ່າ Supabase ຫຼືໂຟນເດີແອັບບໍ່ຖືກຕ້ອງ. ນຳເຂົ້າໄຟລ໌ .env ໃໝ່ແລ້ວລອງອີກຄັ້ງ (CONFIGURATION)"
        case "CONTROL_PROTOCOL", "HEARTBEAT_TIMEOUT", "SPAWN_FAILED", "CHILD_EXIT":
            return "Backend ຢຸດເຮັດວຽກ. ລາຍການຄ້າງຖືກເກັບໄວ້; ເປີດແອັບໃໝ່ເພື່ອກວດກາ (\(code))"
        default: return "Backend ເປີດບໍ່ສຳເລັດ. ລາຍການຄ້າງຖືກເກັບໄວ້; ເປີດແອັບໃໝ່ເພື່ອກວດກາ (START_FAILED)"
        }
    }

    func waitForStop() async {
        stop()
        for _ in 0..<60 {
            if process?.isRunning != true { return }
            try? await Task.sleep(for: .milliseconds(100))
        }
        process?.terminate()
    }
}
