import Foundation

/// Lifecycle of the in-process Swift engine. There is no child process, listener or heartbeat:
/// the engine's database pool starts here and stops when the app quits.
@MainActor final class BackendRuntime {
    private var engine: SwiftEngine?

    func start(configuration: BackendConfiguration, dataRoot: URL, verification: Bool) async throws -> SwiftEngine {
        guard engine == nil else { throw NativeFailure("Backend ເປີດຢູ່ແລ້ວ") }
        try FileManager.default.createDirectory(at: dataRoot, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let root = URL(fileURLWithPath: try Self.canonicalDirectoryPath(dataRoot), isDirectory: true)
        let started: SwiftEngine
        do {
            started = try SwiftEngine(configuration: configuration, dataRoot: root, verification: verification)
            try await started.start()
        } catch {
            throw NativeFailure(Self.failureMessage(code: "CONFIGURATION"))
        }
        engine = started
        return started
    }

    func waitForStop() async {
        let running = engine; engine = nil
        await running?.stop()
    }

    /// Receipts and backups live under one physical data root; resolve symlinked components
    /// (Foundation reports temporary folders as /var/..., itself a symlink) with realpath(3).
    nonisolated static func canonicalDirectoryPath(_ url: URL) throws -> String {
        guard let resolved = realpath(url.path, nil) else { throw NativeFailure("ບໍ່ພົບໂຟນເດີຂອງແອັບ") }
        defer { free(resolved) }
        let path = String(cString: resolved)
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory), isDirectory.boolValue else { throw NativeFailure("ບໍ່ພົບໂຟນເດີຂອງແອັບ") }
        return path
    }

    /// Only fixed startup codes are shown; anything else could carry configuration detail.
    nonisolated static func failureMessage(code: String) -> String {
        switch code {
        case "PORT_BUSY": return "Port 43188 ຖືກໃຊ້ຢູ່. ປິດ Yogurt Manager Native ຕົວທີ່ເປີດຄ້າງແລ້ວລອງໃໝ່ (PORT_BUSY)"
        case "CONFIGURATION": return "ການຕັ້ງຄ່າ Supabase ຫຼືໂຟນເດີແອັບບໍ່ຖືກຕ້ອງ. ນຳເຂົ້າໄຟລ໌ .env ໃໝ່ແລ້ວລອງອີກຄັ້ງ (CONFIGURATION)"
        case "CONTROL_PROTOCOL", "HEARTBEAT_TIMEOUT", "SPAWN_FAILED", "CHILD_EXIT":
            return "Backend ຢຸດເຮັດວຽກ. ລາຍການຄ້າງຖືກເກັບໄວ້; ເປີດແອັບໃໝ່ເພື່ອກວດກາ (\(code))"
        default: return "Backend ເປີດບໍ່ສຳເລັດ. ລາຍການຄ້າງຖືກເກັບໄວ້; ເປີດແອັບໃໝ່ເພື່ອກວດກາ (START_FAILED)"
        }
    }
}
