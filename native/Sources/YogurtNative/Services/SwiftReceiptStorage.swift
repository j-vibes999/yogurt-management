import Foundation
import Darwin

/// uploads/receipts and receipts/{name}: private files in `dataRoot/private-receipts` (0700 folder,
/// 0600 files), admin only, with the original magic-byte structure checks per declared type.
struct SwiftReceiptStorage: Sendable {
    let context: SwiftCommandContext
    static let maximumBytes = 5 * 1024 * 1024
    private static let extensions = ["image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf"]
    private static let privateHeaders = ["Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff"]
    private var directory: URL { context.dataRoot.appendingPathComponent("private-receipts", isDirectory: true) }

    func upload(_ request: SwiftCommandRequest) async throws -> EngineResponse {
        _ = try await authorizeAdmin(request, forbidden: "ບໍ່ມີສິດເຮັດລາຍການນີ້")
        guard let parts = Self.multipart(request.body, contentType: request.contentType) else {
            return .json(400, .object(["error": .string("ຂໍ້ມູນໄຟລ໌ໃບເສັດບໍ່ຖືກຕ້ອງ")]))
        }
        guard let file = parts.first(where: { $0.name == "file" }), file.filename != nil else {
            return .json(400, .object(["error": .string("ກະລຸນາແນບໄຟລ໌ໃບເສັດ ຫຼືຫຼັກຖານ")]))
        }
        if file.data.isEmpty || file.data.count > Self.maximumBytes { return .json(400, .object(["error": .string("ໄຟລ໌ໃບເສັດຕ້ອງມີຂໍ້ມູນ ແລະບໍ່ເກີນ 5 MB")])) }
        guard Self.valid(Array(file.data), type: file.type), let suffix = Self.extensions[file.type] else {
            return .json(400, .object(["error": .string("ຮອງຮັບສະເພາະໄຟລ໌ JPG, PNG, WEBP ຫຼື PDF ທີ່ຖືກຕ້ອງ")]))
        }
        let name = "receipt-\(UUID().uuidString.lowercased()).\(suffix)"
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let descriptor = open(directory.appendingPathComponent(name).path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
            guard descriptor >= 0 else { throw NativeFailure("receipt-create") }
            let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
            try handle.write(contentsOf: file.data); try handle.synchronize(); try handle.close()
        } catch {
            return .json(500, .object(["error": .string("ບໍ່ສາມາດບັນທຶກໄຟລ໌ໃບເສັດໄດ້")]))
        }
        return .json(201, .object(["url": .string("/api/receipts/\(name)")]))
    }

    func download(_ request: SwiftCommandRequest, name: String, head: Bool) async throws -> EngineResponse {
        do { _ = try await authorizeAdmin(request, forbidden: "ບັນຊີນີ້ບໍ່ມີສິດເບິ່ງໃບບິນ") }
        catch let failure as SwiftServiceFailure { return .json(failure.status, .object(["error": .string(failure.message)]), headers: Self.privateHeaders) }
        guard name.count <= 150, name.range(of: "^receipt-[A-Za-z0-9-]+\\.(?:jpg|jpeg|png|webp|pdf)$", options: .regularExpression) != nil else {
            return .json(404, .object(["error": .string("ບໍ່ພົບໃບບິນ")]), headers: Self.privateHeaders)
        }
        let suffix = String(name[name.index(after: name.lastIndex(of: ".")!)...])
        let type = suffix == "pdf" ? "application/pdf" : suffix == "png" ? "image/png" : suffix == "webp" ? "image/webp" : "image/jpeg"
        let descriptor = open(directory.appendingPathComponent(name).path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else {
            if [ENOENT, ENOTDIR, ELOOP].contains(errno) { return .json(404, .object(["error": .string("ບໍ່ພົບໃບບິນ")]), headers: Self.privateHeaders) }
            return .json(500, .object(["error": .string("ເປີດໃບບິນບໍ່ໄດ້")]), headers: Self.privateHeaders)
        }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        defer { try? handle.close() }
        var info = stat()
        guard fstat(descriptor, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG, info.st_size > 0, info.st_size <= Self.maximumBytes else {
            return .json(404, .object(["error": .string("ບໍ່ພົບໃບບິນ")]), headers: Self.privateHeaders)
        }
        let headers = Self.privateHeaders.merging(["Content-Type": type, "Content-Length": String(info.st_size), "Content-Disposition": "inline; filename=\"\(name)\""], uniquingKeysWith: { _, new in new })
        if head { return .init(status: 200, headers: headers, body: Data()) }
        guard let bytes = try? handle.readToEnd(), bytes.count == Int(info.st_size) else {
            return .json(500, .object(["error": .string("ເປີດໃບບິນບໍ່ໄດ້")]), headers: Self.privateHeaders)
        }
        return .init(status: 200, headers: headers, body: bytes)
    }

    /// Fresh session and admin role, read in its own short transaction.
    private func authorizeAdmin(_ request: SwiftCommandRequest, forbidden: String) async throws -> SwiftUserIdentity {
        let user: SwiftUserIdentity
        do { user = try await context.authentication.authorize(token: request.token) }
        catch let failure as SwiftServiceFailure where failure.status == 401 { throw SwiftServiceFailure(status: 401, message: "ກະລຸນາເຂົ້າລະບົບກ່ອນ") }
        guard user.role == "admin" else { throw SwiftServiceFailure(status: 403, message: forbidden) }
        return user
    }

    struct Part { let name: String; let filename: String?; let type: String; let data: Data }

    /// multipart/form-data as `request.formData()` reads it.
    static func multipart(_ body: Data, contentType: String) -> [Part]? {
        guard contentType.lowercased().hasPrefix("multipart/form-data"),
              let boundaryRange = contentType.range(of: "boundary=", options: .caseInsensitive) else { return nil }
        var boundary = String(contentType[boundaryRange.upperBound...]).split(separator: ";").first.map(String.init) ?? ""
        boundary = boundary.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "\""))
        guard !boundary.isEmpty, boundary.count <= 200 else { return nil }
        let delimiter = Data("--\(boundary)".utf8), separator = Data("\r\n\r\n".utf8)
        var parts: [Part] = []
        guard var cursor = body.range(of: delimiter)?.upperBound else { return nil }
        while true {
            guard cursor + 2 <= body.count else { return nil }
            if body[cursor..<cursor + 2] == Data("--".utf8) { return parts }
            guard body[cursor..<cursor + 2] == Data("\r\n".utf8), let headerEnd = body.range(of: separator, in: (cursor + 2)..<body.count),
                  let next = body.range(of: Data("\r\n".utf8) + delimiter, in: headerEnd.upperBound..<body.count) else { return nil }
            let headerText = String(decoding: body[(cursor + 2)..<headerEnd.lowerBound], as: UTF8.self)
            var name: String?, filename: String?, type = ""
            for line in headerText.components(separatedBy: "\r\n") {
                let lower = line.lowercased()
                if lower.hasPrefix("content-disposition:") {
                    name = attribute("name", in: line); filename = attribute("filename", in: line)
                } else if lower.hasPrefix("content-type:") {
                    type = String(line.dropFirst("content-type:".count)).trimmingCharacters(in: .whitespaces).lowercased()
                }
            }
            guard let name else { return nil }
            parts.append(Part(name: name, filename: filename, type: type, data: Data(body[headerEnd.upperBound..<next.lowerBound])))
            cursor = next.upperBound
        }
    }
    private static func attribute(_ key: String, in header: String) -> String? {
        guard let match = header.range(of: "(?:^|;)\\s*\(key)=\"([^\"]*)\"", options: [.regularExpression, .caseInsensitive]) else { return nil }
        let text = String(header[match]); guard let open = text.firstIndex(of: "\"") else { return nil }
        return String(text[text.index(after: open)..<text.index(before: text.endIndex)])
    }

    // MARK: receipt-storage.ts structure checks

    static func valid(_ bytes: [UInt8], type: String) -> Bool {
        guard !bytes.isEmpty, bytes.count <= maximumBytes else { return false }
        switch type {
        case "image/jpeg": return jpeg(bytes)
        case "image/png": return png(bytes)
        case "image/webp":
            guard bytes.count >= 20, ascii(bytes, 0, 4) == "RIFF", ascii(bytes, 8, 12) == "WEBP", Int(le32(bytes, 4)) + 8 == bytes.count else { return false }
            return webpChunks(bytes, start: 12, limit: bytes.count)
        case "application/pdf":
            let header = ascii(bytes, 0, min(8, bytes.count))
            let latin1 = String(bytes: bytes[max(0, bytes.count - 1024)...], encoding: .isoLatin1) ?? ""
            let space = "[\\t\\n\\x{0B}\\f\\r \\x{A0}]"
            return header.range(of: "^%PDF-(?:1\\.[0-7]|2\\.0)", options: .regularExpression) != nil
                && latin1.range(of: "startxref\(space)+[0-9]+\(space)+%%EOF\(space)*\\z", options: .regularExpression) != nil
        default: return false
        }
    }
    private static func ascii(_ bytes: [UInt8], _ start: Int, _ end: Int) -> String {
        guard start <= end, end <= bytes.count else { return "" }
        return String(bytes[start..<end].map { Character(Unicode.Scalar($0)) })
    }
    private static func be32(_ b: [UInt8], _ o: Int) -> UInt32 { UInt32(b[o]) << 24 | UInt32(b[o + 1]) << 16 | UInt32(b[o + 2]) << 8 | UInt32(b[o + 3]) }
    private static func be16(_ b: [UInt8], _ o: Int) -> Int { Int(b[o]) << 8 | Int(b[o + 1]) }
    private static func le32(_ b: [UInt8], _ o: Int) -> UInt32 { UInt32(b[o]) | UInt32(b[o + 1]) << 8 | UInt32(b[o + 2]) << 16 | UInt32(b[o + 3]) << 24 }
    private static func le16(_ b: [UInt8], _ o: Int) -> Int { Int(b[o]) | Int(b[o + 1]) << 8 }

    private static func png(_ b: [UInt8]) -> Bool {
        guard b.count >= 8, Array(b[0..<8]) == [137, 80, 78, 71, 13, 10, 26, 10] else { return false }
        var imageData = false, offset = 8
        while offset + 12 <= b.count {
            let length = Int(be32(b, offset)), type = ascii(b, offset + 4, offset + 8), end = offset + length + 12
            if end > b.count || (offset == 8 && (type != "IHDR" || length != 13)) { return false }
            if type == "IHDR" && (length != 13 || be32(b, offset + 8) == 0 || be32(b, offset + 12) == 0) { return false }
            if type == "IDAT" && length > 0 { imageData = true }
            if type == "IEND" { return imageData && length == 0 && end == b.count }
            offset = end
        }
        return false
    }

    private static func jpeg(_ b: [UInt8]) -> Bool {
        guard b.count >= 16, b[0] == 0xff, b[1] == 0xd8, b[b.count - 2] == 0xff, b[b.count - 1] == 0xd9 else { return false }
        var components = 0, offset = 2
        while offset + 4 <= b.count {
            if b[offset] != 0xff { return false }
            while offset < b.count, b[offset] == 0xff { offset += 1 }
            guard offset < b.count else { return false }
            let marker = b[offset]; offset += 1
            if marker == 0x01 { continue }
            if marker == 0x00 || marker == 0xd8 || marker == 0xd9 || (0xd0...0xd7).contains(marker) || offset + 2 > b.count { return false }
            let length = be16(b, offset), end = offset + length
            if length < 2 || end > b.count - 2 { return false }
            if (0xc0...0xcf).contains(marker) && ![0xc4, 0xc8, 0xcc].contains(marker) {
                if length < 8 || be16(b, offset + 3) == 0 || be16(b, offset + 5) == 0 { return false }
                components = Int(b[offset + 7])
                if components == 0 || components > 4 || length != 8 + components * 3 { return false }
            }
            if marker == 0xda {
                let scan = Int(b[offset + 2])
                return components > 0 && scan > 0 && scan <= components && length == 6 + scan * 2 && end < b.count - 2
            }
            offset = end
        }
        return false
    }

    private static func webpChunks(_ b: [UInt8], start: Int, limit: Int, insideFrame: Bool = false) -> Bool {
        var hasImage = false, offset = start
        while offset < limit {
            if offset + 8 > limit { return false }
            let type = ascii(b, offset, offset + 4), length = Int(le32(b, offset + 4)), payload = offset + 8
            let end = payload + length, padded = end + (length % 2)
            if padded > limit { return false }
            if type == "VP8 " {
                if length < 10 || (b[payload] & 1) != 0 || Array(b[(payload + 3)..<(payload + 6)]) != [0x9d, 0x01, 0x2a]
                    || le16(b, payload + 6) & 0x3fff == 0 || le16(b, payload + 8) & 0x3fff == 0 { return false }
                hasImage = true
            } else if type == "VP8L" {
                if length < 5 || b[payload] != 0x2f || le32(b, payload + 1) >> 29 != 0 { return false }
                hasImage = true
            } else if type == "VP8X" && length != 10 { return false }
            else if type == "ANMF" {
                if insideFrame || length <= 16 || !webpChunks(b, start: payload + 16, limit: end, insideFrame: true) { return false }
                hasImage = true
            }
            offset = padded
        }
        return hasImage
    }
}
