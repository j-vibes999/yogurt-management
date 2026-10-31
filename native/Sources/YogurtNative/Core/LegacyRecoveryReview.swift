import Foundation

struct LegacyRecoveryReview: Decodable {
    struct Record: Decodable { let key: String; let value: String }
    let format: String
    let origin: String
    let exportedAt: String
    let records: [Record]
    static func read(_ data: Data) throws -> LegacyRecoveryReview {
        guard data.count <= 8 * 1024 * 1024 else { throw NativeFailure("ໄຟລ໌ກວດກາໃຫຍ່ເກີນໄປ") }
        let review = try JSONDecoder().decode(Self.self, from: data)
        let prefixes = ["yogurt:operation:", "yogurt:pending-operation:", "yogurt-restock-draft:", "yogurt-payment-pending:", "yogurt-restock-pending:"]
        guard review.format == "yogurt-legacy-recovery-v1", review.origin == "http://127.0.0.1:43187",
              ISO8601DateFormatter().date(from: review.exportedAt) != nil,
              review.records.allSatisfy({ row in prefixes.contains(where: { row.key.hasPrefix($0) }) }) else { throw NativeFailure("ໄຟລ໌ກວດກາຈາກແອັບເດີມບໍ່ຖືກຕ້ອງ") }
        return review
    }
}
