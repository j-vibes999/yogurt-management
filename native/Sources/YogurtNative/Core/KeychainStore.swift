import Foundation
import Security

actor KeychainStore {
    private let service: String
    init(service: String = "com.yogurt.manager.native") { self.service = service }
    func read(_ account: String) throws -> Data? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
            kSecAttrAccount as String: account, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var value: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &value)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = value as? Data else { throw NativeFailure("ເຂົ້າເຖິງ Keychain ບໍ່ໄດ້; ກວດສິດຂອງແອັບ") }
        return data
    }
    func write(_ data: Data, account: String) throws {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        let update = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if update == errSecItemNotFound {
            var create = query; create[kSecValueData as String] = data
            guard SecItemAdd(create as CFDictionary, nil) == errSecSuccess else { throw NativeFailure("ບັນທຶກ Keychain ບໍ່ໄດ້") }
        } else if update != errSecSuccess { throw NativeFailure("ບັນທຶກ Keychain ບໍ່ໄດ້") }
    }
    func remove(_ account: String) throws {
        let status = SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account] as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw NativeFailure("ອອກຈາກລະບົບ Keychain ບໍ່ສຳເລັດ") }
    }
}
