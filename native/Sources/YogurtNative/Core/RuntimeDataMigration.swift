import Foundation
import CryptoKit
import Darwin

struct RuntimeMigrationReport: Equatable { var receipts = 0; var backupFiles = 0; var skippedBackupMetadata = 0 }

enum ReceiptRoute {
    static func canonical(_ path: String) throws -> String {
        guard path.range(of: "^/(?:api/receipts|uploads/receipts)/receipt-[A-Za-z0-9-]+\\.(?:jpg|jpeg|png|webp|pdf)$", options: .regularExpression) != nil else { throw NativeFailure("ໃບເສັດບໍ່ຖືກຕ້ອງ") }
        return "/api/receipts/" + URL(fileURLWithPath: path).lastPathComponent
    }
}

/// Copies private artifacts only. Existing files and the old application are never changed.
actor RuntimeDataMigration {
    private let manager = FileManager.default
    func importLegacy(source: URL, target: URL, fingerprint: String) throws -> RuntimeMigrationReport {
        var report = RuntimeMigrationReport()
        guard manager.fileExists(atPath: source.path) else { return report }
        try directory(source, create: false); try directory(target, create: true)
        let receipts = source.appendingPathComponent("private-receipts")
        if manager.fileExists(atPath: receipts.path) {
            try directory(receipts, create: false)
            let destination = target.appendingPathComponent("private-receipts"); try directory(destination, create: true)
            for name in try manager.contentsOfDirectory(atPath: receipts.path).sorted() {
                if name == ".DS_Store" { continue }
                _ = try ReceiptRoute.canonical("/api/receipts/" + name)
                if try copy(receipts.appendingPathComponent(name), to: destination.appendingPathComponent(name), maximum: 5 * 1024 * 1024) { report.receipts += 1 }
            }
        }
        let backups = source.appendingPathComponent("backups")
        guard manager.fileExists(atPath: backups.path) else { return report }
        try directory(backups, create: false)
        let destination = target.appendingPathComponent("backups"); try directory(destination, create: true)
        var publications: [(URL, URL)] = []
        for name in ["latest.json", "latest-attempt.json", "last-restore-verification.json"] {
            let input = backups.appendingPathComponent(name)
            guard manager.fileExists(atPath: input.path) else { continue }
            let metadata = try JSONDecoder().decode(JSONValue.self, from: read(input, maximum: 1024 * 1024))
            guard metadata.text("sourceFingerprint") == fingerprint else { report.skippedBackupMetadata += 1; continue }
            for field in ["file", "receipts"] where !metadata.text(field).isEmpty {
                let artifact = metadata.text(field)
                guard !artifact.hasPrefix("."), !artifact.contains("/"), !artifact.contains("\\"), !artifact.contains("\0"), artifact.count <= 255 else { throw NativeFailure("ຊື່ໄຟລ໌ສຳຮອງເກົ່າບໍ່ປອດໄພ") }
                let original = backups.appendingPathComponent(artifact)
                if field == "file", !metadata.text("sha256").isEmpty {
                    guard try digest(original, maximum: 16 * 1024 * 1024 * 1024) == metadata.text("sha256") else { throw NativeFailure("Checksum ໄຟລ໌ສຳຮອງເກົ່າບໍ່ກົງກັບຫຼັກຖານ") }
                }
                if try copy(original, to: destination.appendingPathComponent(artifact), maximum: 16 * 1024 * 1024 * 1024) { report.backupFiles += 1 }
            }
            publications.append((input, destination.appendingPathComponent(name)))
        }
        // Publish readiness evidence only after all of its referenced artifacts exist.
        for (input, output) in publications { if try copy(input, to: output, maximum: 1024 * 1024) { report.backupFiles += 1 } }
        return report
    }
    private func directory(_ url: URL, create: Bool) throws {
        var current = URL(fileURLWithPath: "/", isDirectory: true)
        for component in url.pathComponents.dropFirst() {
            current.appendPathComponent(component)
            if create && !manager.fileExists(atPath: current.path) { try manager.createDirectory(at: current, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700]) }
            let info = try manager.attributesOfItem(atPath: current.path)
            guard info[.type] as? FileAttributeType == .typeDirectory else { throw NativeFailure("ໂຟລເດີຂໍ້ມູນເກົ່າມີ symbolic link ຫຼືບໍ່ປອດໄພ") }
        }
        let info = try manager.attributesOfItem(atPath: url.path)
        guard (info[.ownerAccountID] as? NSNumber)?.uint32Value == getuid(), ((info[.posixPermissions] as? NSNumber)?.intValue ?? 0o777) & 0o022 == 0 else { throw NativeFailure("ໂຟລເດີຂໍ້ມູນຕ້ອງເປັນຂອງຜູ້ໃຊ້ນີ້") }
    }
    private func handle(_ url: URL, maximum: UInt64) throws -> FileHandle {
        let descriptor = Darwin.open(url.path, O_RDONLY | O_NOFOLLOW)
        guard descriptor >= 0 else { throw NativeFailure("ອ່ານໄຟລ໌ຂໍ້ມູນເກົ່າບໍ່ໄດ້") }
        var info = stat()
        guard fstat(descriptor, &info) == 0, info.st_mode & S_IFMT == S_IFREG, info.st_uid == getuid(), info.st_size > 0, UInt64(info.st_size) <= maximum else { Darwin.close(descriptor); throw NativeFailure("ໄຟລ໌ຂໍ້ມູນເກົ່າບໍ່ປອດໄພ ຫຼືໃຫຍ່ເກີນໄປ") }
        return FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
    }
    private func read(_ url: URL, maximum: UInt64) throws -> Data {
        let input = try handle(url, maximum: maximum); defer { try? input.close() }
        let data = try input.readToEnd() ?? Data()
        guard data.count <= maximum else { throw NativeFailure("ໄຟລ໌ຂໍ້ມູນປ່ຽນຂະນະອ່ານ") }
        return data
    }
    private func digest(_ url: URL, maximum: UInt64) throws -> String {
        let input = try handle(url, maximum: maximum); defer { try? input.close() }
        var hash = SHA256(); var total: UInt64 = 0
        while let block = try input.read(upToCount: 256 * 1024), !block.isEmpty { total += UInt64(block.count); guard total <= maximum else { throw NativeFailure("ໄຟລ໌ຂໍ້ມູນປ່ຽນຂະນະອ່ານ") }; hash.update(data: block) }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }
    private func copy(_ source: URL, to target: URL, maximum: UInt64) throws -> Bool {
        let expected = try digest(source, maximum: maximum)
        if manager.fileExists(atPath: target.path) {
            guard try digest(target, maximum: maximum) == expected else { throw NativeFailure("ໄຟລ໌ໃນ Native ຕ່າງຈາກໄຟລ໌ເກົ່າ. ເກັບທັງສອງຕົ້ນສະບັບໄວ້ແລ້ວ; ບໍ່ໄດ້ຂຽນທັບ") }
            return false
        }
        let temporary = target.deletingLastPathComponent().appendingPathComponent(".migration-\(UUID().uuidString).tmp")
        defer { try? manager.removeItem(at: temporary) }
        try manager.copyItem(at: source, to: temporary)
        try manager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: temporary.path)
        guard try digest(temporary, maximum: maximum) == expected, try digest(source, maximum: maximum) == expected else { throw NativeFailure("ໄຟລ໌ເກົ່າປ່ຽນຂະນະສຳເນົາ. ບໍ່ໄດ້ລຶບຕົ້ນສະບັບ") }
        // An exclusive hard-link publication never replaces a concurrently created file.
        guard Darwin.link(temporary.path, target.path) == 0 else { throw NativeFailure("ໄຟລ໌ Native ປ່ຽນຂະນະສຳເນົາ. ບໍ່ໄດ້ຂຽນທັບ") }
        return true
    }
}
