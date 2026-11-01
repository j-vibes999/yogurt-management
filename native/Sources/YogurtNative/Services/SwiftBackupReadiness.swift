import Foundation

/// backup-readiness.ts: evidence files live directly in `dataRoot/backups`. A corrupt or absent
/// state file provides no readiness evidence.
enum SwiftBackupReadiness {
    static func load(dataRoot: URL, configuration: BackendConfiguration, now: Date = Date()) -> JSONValue {
        let directory = dataRoot.appendingPathComponent("backups", isDirectory: true)
        func read(_ name: String) -> JSONValue? {
            guard let data = try? Data(contentsOf: directory.appendingPathComponent(name)), data.count <= 1_048_576,
                  let value = try? JSONDecoder().decode(JSONValue.self, from: data), case .object = value else { return nil }
            return value
        }
        let backup = read("latest.json"), attempt = read("latest-attempt.json"), restore = read("last-restore-verification.json")
        var reasons: [String] = []
        let fingerprint = targetOverride(configuration.databaseURL) ? nil : configuration.databaseFingerprint
        if fingerprint == nil { reasons.append("invalid-target") }
        let backupFile = backup?["file"].stringValue, backupHash = backup?["sha256"].stringValue
        if backup?["ok"] != .bool(true) || (backupHash ?? "").isEmpty || (backupFile ?? "").isEmpty || backup?["scope"] != .string("public") { reasons.append("missing-backup") }
        if fingerprint == nil || backup?["sourceFingerprint"] != fingerprint.map(JSONValue.string) { reasons.append("wrong-target") }
        let created = timestamp(backup?["createdAt"])
        var ageHours: Double?
        if let created, created <= now.addingTimeInterval(60) { ageHours = max(0, now.timeIntervalSince(created) / 3600) }
        if let ageHours { if ageHours > 36 { reasons.append("stale") } } else { reasons.append("invalid-timestamp") }
        if attempt == nil || attempt?["sourceFingerprint"] != fingerprint.map(JSONValue.string) || fingerprint == nil { reasons.append("attempt-unverified") }
        else if attempt?["ok"] != .bool(true) { reasons.append("latest-attempt-failed") }
        var restoreOk = false
        if let restore, let fingerprint, let verified = timestamp(restore["verifiedAt"]), let created {
            restoreOk = restore["ok"] == .bool(true) && restore["sourceFingerprint"] == .string(fingerprint) && restore["sha256"] != .null && restore["sha256"] == backup?["sha256"]
                && restore["scope"] == .string("public") && verified >= created && verified <= now.addingTimeInterval(60)
        }
        if !restoreOk { reasons.append("restore-unverified") }
        let age: JSONValue = ageHours.map { .number(Decimal(Int64(($0 * 10).rounded(.toNearestOrAwayFromZero))) / 10) } ?? .null
        func artifact(_ name: String?) -> [FileAttributeKey: Any]? {
            guard let name, !name.isEmpty, name != ".", name != "..", !name.contains("\0"), !name.contains("/") else { return nil }
            guard let attributes = try? FileManager.default.attributesOfItem(atPath: directory.appendingPathComponent(name).path),
                  attributes[.type] as? FileAttributeType == .typeRegular else { return nil }
            return attributes
        }
        if let dump = artifact(backupFile) {
            let expected = backup?["bytes"] ?? .null
            let size = (dump[.size] as? NSNumber)?.int64Value ?? -1
            if case .number(let bytes) = expected, bytes > 0, bytes == Decimal(size), bytes <= 9_007_199_254_740_991 {} else { reasons.append("backup-size-mismatch") }
        } else { reasons.append("backup-artifact-missing") }
        if let receipts = backup?["receipts"], receipts != .null, artifact(receipts.stringValue) == nil { reasons.append("receipt-artifact-missing") }
        let ok = reasons.isEmpty
        return .object(["ok": .bool(ok), "ageHours": age, "restoreVerified": .bool(ok && restoreOk), "reasons": .array(reasons.map(JSONValue.string))])
    }
    /// Date.parse of an ISO string; anything else is no evidence.
    private static func timestamp(_ value: JSONValue?) -> Date? {
        guard let text = value?.stringValue, !text.isEmpty else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = text.contains(".") ? [.withInternetDateTime, .withFractionalSeconds] : [.withInternetDateTime]
        return formatter.date(from: text)
    }
    private static func targetOverride(_ url: String) -> Bool {
        let overrides: Set<String> = ["host", "hostaddr", "port", "dbname", "user", "password", "service", "servicefile"]
        return (URLComponents(string: url)?.queryItems ?? []).contains { overrides.contains($0.name.lowercased()) }
    }
}

private extension JSONValue {
    var stringValue: String? { if case .string(let value) = self { return value }; return nil }
}
