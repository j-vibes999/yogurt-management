import Foundation
import Darwin

struct NativeLaunchOptions {
    var verificationRoot: URL?
    var configurationFile: URL?
    var recoveryReviewFile: URL?
    var isVerification: Bool { verificationRoot != nil }
    init(arguments: [String] = ProcessInfo.processInfo.arguments) throws {
        var index = 1
        while index < arguments.count {
            let argument = arguments[index]
            if ["--yogurt-native-verification-root", "--yogurt-import-configuration", "--yogurt-import-legacy-review"].contains(argument) {
                guard index + 1 < arguments.count, arguments[index + 1].hasPrefix("/") else { throw NativeFailure("ທີ່ຢູ່ໄຟລ໌ຕັ້ງຄ່າບໍ່ຖືກຕ້ອງ") }
                let url = URL(fileURLWithPath: arguments[index + 1]); index += 1
                if argument == "--yogurt-import-configuration" { guard configurationFile == nil else { throw NativeFailure("ຕົວເລືອກຕັ້ງຄ່າຊ້ຳ") }; configurationFile = url }
                else if argument == "--yogurt-import-legacy-review" { guard recoveryReviewFile == nil else { throw NativeFailure("ຕົວເລືອກກວດກາຊ້ຳ") }; recoveryReviewFile = url }
                else {
                    let root = try Self.physicalDirectory(url)
                    let temporary = try Self.physicalDirectory(FileManager.default.temporaryDirectory)
                    let attributes = try FileManager.default.attributesOfItem(atPath: root.path)
                    guard verificationRoot == nil, root.deletingLastPathComponent() == temporary,
                          root.lastPathComponent.hasPrefix("yogurt-native-e2e-"),
                          attributes[.type] as? FileAttributeType == .typeDirectory,
                          (attributes[.ownerAccountID] as? NSNumber)?.uint32Value == getuid(),
                          (attributes[.posixPermissions] as? NSNumber)?.intValue == 0o700 else { throw NativeFailure("Verification ຕ້ອງໃຊ້ໂຟລເດີທົດສອບສ່ວນຕົວຊົ່ວຄາວ") }
                    verificationRoot = root
                }
            } else if argument.hasPrefix("--yogurt-") { throw NativeFailure("ຕົວເລືອກເປີດແອັບບໍ່ຖືກຕ້ອງ") }
            index += 1
        }
    }
    private static func physicalDirectory(_ url: URL) throws -> URL {
        guard let resolved = Darwin.realpath(url.path, nil) else { throw NativeFailure("ບໍ່ພົບໂຟລເດີທົດສອບ") }
        defer { free(resolved) }
        return URL(fileURLWithPath: String(cString: resolved), isDirectory: true)
    }
}
