import Foundation
import CryptoKit
import Darwin

struct PendingCommand: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let userID: String
    let method: String
    let path: String
    let body: Data
    let createdAt: Date
    let durable: Bool
    var draftKey: String? = nil
}

struct OperationOutcome: Codable, Equatable, Sendable {
    enum State: String, Codable { case succeeded, rejected, reconciled }
    let command: PendingCommand
    let state: State
    let result: JSONValue
}

private struct StoredDraft: Codable {
    let nativeDraftVersion: Int
    var value: JSONValue
    var submission: PendingCommand?
}

actor OperationStore {
    let directory: URL
    init(directory: URL) { self.directory = directory }
    private func key(_ userID: String, _ method: String, _ path: String) -> String {
        SHA256.hash(data: Data("\(userID):\(method):\(path)".utf8)).map { String(format: "%02x", $0) }.joined()
    }
    private func file(_ command: PendingCommand) -> URL { directory.appendingPathComponent("commands/\(key(command.userID, command.method, command.path)).json") }
    private func write(_ data: Data, to url: URL) throws {
        let parent = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try data.write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        try synchronize(url)
    }
    private func synchronize(_ url: URL) throws {
        let parent = url.deletingLastPathComponent()
        let handle = try FileHandle(forWritingTo: url)
        defer { try? handle.close() }
        try handle.synchronize()
        let descriptor = open(parent.path, O_RDONLY)
        guard descriptor >= 0 else { throw NativeFailure("ບັນທຶກລາຍການໃນເຄື່ອງບໍ່ໄດ້") }
        defer { close(descriptor) }
        guard fsync(descriptor) == 0 else { throw NativeFailure("ຢືນຢັນການບັນທຶກໃນເຄື່ອງບໍ່ໄດ້") }
    }
    func prepare(userID: String, method: String, path: String, body: Data, durable: Bool = true, draftKey: String? = nil) throws -> PendingCommand {
        var draft = try draftKey.flatMap { try storedDraft(userID: userID, name: $0) }
        if let linked = draft?.submission, try outcome(linked)?.state != .rejected {
            guard linked.userID == userID, linked.method == method, linked.path == path, linked.body == body, linked.durable == durable else {
                throw NativeFailure("ຮ່າງນີ້ສົ່ງແລ້ວ. ກວດຜົນລາຍການເດີມກ່ອນເລີ່ມໃໝ່")
            }
            // A crash may have happened after binding the draft but before writing the pending file.
            if try outcome(linked) == nil {
                let unresolved = try pending(userID: userID)
                guard unresolved.isEmpty || unresolved == [linked] else { throw NativeFailure("ມີລາຍການອື່ນທີ່ຍັງລໍຜົນ") }
                guard linked.durable else { throw NativeFailure("ລາຍການນີ້ຕ້ອງກວດຜົນກ່ອນສົ່ງໃໝ່") }
                try write(JSONEncoder().encode(linked), to: file(linked))
            }
            return linked
        }
        let candidate = PendingCommand(id: UUID().uuidString.lowercased(), userID: userID, method: method, path: path, body: body, createdAt: Date(), durable: durable, draftKey: draftKey)
        // Actor isolation makes the account-wide barrier atomic, including requests to different routes.
        // A pending audit must be resolved before a separate payment can change that store's balance.
        if let previous = try pending(userID: userID).first {
            guard previous.userID == userID, previous.method == method, previous.path == path, previous.body == body,
                  previous.draftKey == nil || previous.draftKey == draftKey else {
                throw NativeFailure("ມີລາຍການເກົ່າທີ່ຍັງບໍ່ຢືນຢັນຜົນ. ກວດກາ ຫຼືລອງລາຍການເດີມກ່ອນສ້າງໃໝ່")
            }
            guard previous.durable && durable else { throw NativeFailure("ລາຍການນີ້ບໍ່ຮອງຮັບການສົ່ງຊ້ຳ. ໂຫຼດຜົນຄືນແລະຢືນຢັນການກວດກາລາຍການຄ້າງກ່ອນ") }
            if let draftKey {
                draft = StoredDraft(nativeDraftVersion: 1, value: draft?.value ?? .object([:]), submission: previous)
                try write(JSONEncoder().encode(draft!), to: draftURL(userID: userID, name: draftKey))
            }
            return previous
        }
        if let draftKey {
            // Persist the exact command in the draft BEFORE any request can leave this process.
            let linked = StoredDraft(nativeDraftVersion: 1, value: draft?.value ?? .object([:]), submission: candidate)
            try write(JSONEncoder().encode(linked), to: draftURL(userID: userID, name: draftKey))
        }
        try write(JSONEncoder().encode(candidate), to: file(candidate))
        return candidate
    }
    func pending(userID: String) throws -> [PendingCommand] {
        let root = directory.appendingPathComponent("commands")
        let files = FileManager.default.fileExists(atPath: root.path) ? try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) : []
        var commands = try files
            .filter { $0.pathExtension == "json" }
            .map { try JSONDecoder().decode(PendingCommand.self, from: Data(contentsOf: $0)) }
            .filter { $0.userID == userID }
        let drafts = directory.appendingPathComponent("drafts")
        if FileManager.default.fileExists(atPath: drafts.path) {
            for url in try FileManager.default.contentsOfDirectory(at: drafts, includingPropertiesForKeys: nil) where url.pathExtension == "json" {
                let bytes = try Data(contentsOf: url)
                guard let draft = try? JSONDecoder().decode(StoredDraft.self, from: bytes), draft.nativeDraftVersion == 1 else {
                    _ = try JSONDecoder().decode(JSONValue.self, from: bytes) // Preserve readable legacy drafts.
                    continue
                }
                guard let bound = draft.submission, bound.userID == userID, try outcome(bound) == nil else { continue }
                if let existing = commands.first(where: { $0.method == bound.method && $0.path == bound.path }) {
                    guard existing == bound else { throw NativeFailure("ພົບຄຳຂໍຄ້າງບໍ່ກົງກັບຮ່າງ. ເກັບໄຟລ໌ໄວ້ເພື່ອກວດກາ") }
                } else {
                    // Recover the bind-before-pending crash window without sending any network request.
                    try write(JSONEncoder().encode(bound), to: file(bound))
                    commands.append(bound)
                }
            }
        }
        return commands.sorted { $0.createdAt < $1.createdAt }
    }
    func resolve(_ command: PendingCommand) throws {
        guard try outcome(command) != nil else { throw NativeFailure("ຕ້ອງເກັບຜົນລາຍການກ່ອນລຶບຄຳຂໍຄ້າງ") }
        // Retry synchronization too: an earlier write could have left readable bytes before sync failed.
        try synchronize(outcomeURL(command))
        let url = file(command)
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        let current = try JSONDecoder().decode(PendingCommand.self, from: Data(contentsOf: url))
        guard current == command else { throw NativeFailure("ລາຍການຄ້າງປ່ຽນແປງ; ບໍ່ໄດ້ລຶບຂໍ້ມູນ") }
        try FileManager.default.removeItem(at: url)
    }
    private func outcomeURL(_ command: PendingCommand) -> URL { directory.appendingPathComponent("outcomes/\(key(command.userID, command.id, "outcome")).json") }
    func outcome(_ command: PendingCommand) throws -> OperationOutcome? {
        let url = outcomeURL(command)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let saved = try JSONDecoder().decode(OperationOutcome.self, from: Data(contentsOf: url))
        guard saved.command == command else { throw NativeFailure("ຜົນລາຍການບໍ່ກົງກັບຄຳຂໍເດີມ") }
        return saved
    }
    func recordOutcome(_ command: PendingCommand, state: OperationOutcome.State, result: JSONValue) throws {
        let saved = OperationOutcome(command: command, state: state, result: result)
        if let existing = try outcome(command) {
            guard existing == saved else { throw NativeFailure("ຜົນລາຍການຖືກຢືນຢັນແລ້ວ; ບໍ່ໄດ້ຂຽນທັບ") }
            return
        }
        guard try pending(userID: command.userID).contains(command) else { throw NativeFailure("ບໍ່ພົບຄຳຂໍຄ້າງເດີມ") }
        // The outcome remains authoritative even if the process exits before resolve or UI continuation.
        try write(JSONEncoder().encode(saved), to: outcomeURL(command))
    }
    static func isDefinite(status: Int, retryable: Bool?, durable: Bool = true) -> Bool {
        (200..<300).contains(status) ||
            ([400, 404, 409].contains(status) && retryable != true && (durable || retryable == false))
    }
    private func draftURL(userID: String, name: String) -> URL { directory.appendingPathComponent("drafts/\(key(userID, "draft", name)).json") }
    private func storedDraft(userID: String, name: String) throws -> StoredDraft? {
        let url = draftURL(userID: userID, name: name)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let bytes = try Data(contentsOf: url)
        if let record = try? JSONDecoder().decode(StoredDraft.self, from: bytes), record.nativeDraftVersion == 1 { return record }
        return StoredDraft(nativeDraftVersion: 1, value: try JSONDecoder().decode(JSONValue.self, from: bytes), submission: nil)
    }
    func saveDraft(userID: String, name: String, value: JSONValue) throws {
        let existing = try storedDraft(userID: userID, name: name)
        // Autosave from a stale sheet must never replace the submitted fields or its completion binding.
        if let submission = existing?.submission, try outcome(submission)?.state != .rejected { return }
        try write(JSONEncoder().encode(StoredDraft(nativeDraftVersion: 1, value: value, submission: nil)), to: draftURL(userID: userID, name: name))
    }
    func loadDraft(userID: String, name: String) throws -> JSONValue? {
        guard let draft = try storedDraft(userID: userID, name: name) else { return nil }
        guard let submission = draft.submission, let saved = try outcome(submission), saved.state != .rejected else { return draft.value }
        var value = draft.value.object
        value["nativeOutcome"] = .string(saved.state.rawValue)
        if saved.state == .succeeded {
            value["persistedResult"] = saved.result
            value["persistedId"] = .string(saved.result.id)
            value["completion"] = saved.result
        }
        return .object(value)
    }
    func removeDraft(userID: String, name: String, startNewIntent: Bool = false) throws {
        if let submission = try storedDraft(userID: userID, name: name)?.submission {
            let saved = try outcome(submission)
            guard startNewIntent else { return }
            guard saved != nil else { throw NativeFailure("ລາຍການເດີມຍັງລໍຜົນ. ກວດກາກ່ອນເລີ່ມໃໝ່") }
            // A tombstone may precede pending removal across a crash; finish that removal first.
            try resolve(submission)
        }
        let url = draftURL(userID: userID, name: name)
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
    }
}
