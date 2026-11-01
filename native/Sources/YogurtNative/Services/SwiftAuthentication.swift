import Foundation

actor SwiftAuthentication {
    private let database: SwiftDatabase
    private let configuration: BackendConfiguration
    private var ipBuckets: [String:(count:Int,reset:Date)] = [:]
    private var unknown: [String:(count:Int,locked:Date?,touched:Date)] = [:]
    private var queues: [String:[CheckedContinuation<Void,Never>]] = [:]
    private var decoy: String?
    private static let invalid = "ອີເມວ ຫຼືລະຫັດຜ່ານບໍ່ຖືກຕ້ອງ"
    private static let signIn = "ກະລຸນາເຂົ້າລະບົບກ່ອນ"
    private static let headers = ["Cache-Control":"no-store"]

    init(database: SwiftDatabase, configuration: BackendConfiguration) { self.database = database; self.configuration = configuration }

    func authorize(token: String?, connection: SwiftSQLConnection? = nil, roles: [String]? = nil, expectedUserID: String? = nil) async throws -> SwiftUserIdentity {
        guard configuration.sessionSecret.utf16.count >= 32,
              let payload = SwiftCredentials.verifySession(token, secret: configuration.sessionSecret) else { throw SwiftServiceFailure(status:401,message:Self.signIn) }
        let sql = """
        SELECT s.user_id AS "userId", s.expires_at AS "expiresAt", u.email, u.full_name AS "fullName", u.role, u.is_active AS "isActive", u.password_hash AS "passwordHash"
        FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.user_id=$2
        """
        let params: [JSONValue] = [payload["sid"],payload["userId"]]
        let rows: [JSONValue]
        if let connection { rows = try await connection.rows(sql, params) }
        else { rows = try await database.rows(sql, params) }
        guard let row = rows.first, row["isActive"].bool, try SwiftServiceJSON.date(row["expiresAt"]) > Date(), SwiftCredentials.verifySessionCredentials(payload:payload,passwordHash:row.text("passwordHash"),secret:configuration.sessionSecret), expectedUserID == nil || expectedUserID == row.text("userId") else { throw SwiftServiceFailure(status:401,message:Self.signIn) }
        if let roles, !roles.contains(row.text("role")) { throw SwiftServiceFailure(status:403,message:"ບໍ່ມີສິດເບິ່ງຂໍ້ມູນນີ້") }
        return SwiftUserIdentity(userID:row.text("userId"),sessionID:payload.text("sid"),email:row.text("email"),fullName:row.text("fullName"),role:row.text("role"))
    }

    func session(token: String?) async throws -> SwiftServiceReply {
        do {
            let user = try await authorize(token:token)
            return .init(data:.object(["userId":.string(user.userID),"fullName":.string(user.fullName),"email":.string(user.email),"role":.string(user.role),"source":.string("database")]),headers:Self.headers)
        } catch let error as SwiftDatabaseError where error.isUnavailable {
            if let payload = SwiftCredentials.verifySession(token,secret:configuration.sessionSecret) {
                return .init(data:.object(["userId":payload["userId"],"fullName":payload["fullName"],"email":payload["email"],"role":payload["role"],"source":.string("offline")]),headers:Self.headers)
            }
            return Self.error(401,Self.signIn)
        } catch let error as SwiftServiceFailure where error.status == 401 { return Self.error(401,Self.signIn) }
    }

    func login(body: JSONValue, ip: String = "local", userAgent: String? = nil) async throws -> SwiftServiceReply {
        guard configuration.sessionSecret.utf16.count >= 32 else { return Self.error(503,"ການຕັ້ງຄ່າຄວາມປອດໄພຂອງລະບົບຍັງບໍ່ສົມບູນ") }
        let now = Date()
        // The caller supplies an already-trusted identity; headers are never interpreted here.
        let address = ip.utf8.count <= 45 && ip.range(of:"^[0-9A-Fa-f:.]+$",options:.regularExpression) != nil ? ip : "local"
        let key = address.lowercased()
        if let bucket = ipBuckets[key], bucket.reset > now, bucket.count >= 10 { return Self.limited(bucket.reset.timeIntervalSince(now)) }
        if ipBuckets.count >= 5000 {
            ipBuckets = ipBuckets.filter { $0.value.reset > now }
            if ipBuckets.count >= 5000 { for key in ipBuckets.sorted(by: { $0.value.reset < $1.value.reset }).prefix(500).map(\.key) { ipBuckets.removeValue(forKey:key) } }
        }
        let prior = ipBuckets[key]
        ipBuckets[key] = prior.map { $0.reset > now ? ($0.count + 1,$0.reset) : (1,now.addingTimeInterval(600)) } ?? (1,now.addingTimeInterval(600))
        guard case .string(let rawEmail) = body["email"], case .string(let password) = body["password"] else { return Self.error(400,Self.invalid) }
        let email = rawEmail.trimmingCharacters(in:.whitespacesAndNewlines).lowercased()
        guard email.utf16.count <= 254, email.range(of:"^(?!\\.)(?!.*\\.\\.)([A-Z0-9_+\\-\\.']+)@([A-Z0-9][A-Z0-9\\-]*\\.)+[A-Z]{2,}$",options:[.regularExpression,.caseInsensitive]) != nil, password.utf16.count >= 1, password.utf16.count <= 256 else { return Self.error(400,Self.invalid) }
        await acquire(email); defer { release(email) }
        if decoy == nil { decoy = try SwiftCredentials.hashPassword(UUID().uuidString + UUID().uuidString) }
        let decoyHash = decoy!
        let attempted = Date()
        let unknownState = unknown[email].flatMap { attempted.timeIntervalSince($0.touched) <= 86400 ? $0 : nil }
        let secret = configuration.sessionSecret
        let agent: JSONValue = userAgent.map { .string(String(decoding: Array($0.utf16.prefix(200)), as: UTF16.self)) } ?? .null
        let outcome = try await database.transaction { connection -> (SwiftServiceReply,Bool) in
            let user = try await connection.rows("SELECT id,email,password_hash AS \"passwordHash\",full_name AS \"fullName\",role,is_active AS \"isActive\",locked_until AS \"lockedUntil\",failed_login_count AS \"failedLoginCount\" FROM users WHERE email=$1 FOR UPDATE",[.string(email)]).first
            let locked = try user.flatMap { $0["lockedUntil"] == .null ? nil : try SwiftServiceJSON.date($0["lockedUntil"]) } ?? unknownState?.locked
            if let locked, locked > attempted { return (Self.limited(locked.timeIntervalSince(attempted)),false) }
            let hasPassword = user?.text("passwordHash").hasPrefix("scrypt$") == true
            let matched = SwiftCredentials.verifyPassword(password,encoded:hasPassword ? user!.text("passwordHash") : decoyHash) && hasPassword
            guard let user, user["isActive"].bool, matched else {
                if let user {
                    // Never reset the lockout counter on an unexpected value; fail the attempt instead.
                    guard let previous = Int(user["failedLoginCount"].text) else { throw SwiftDatabaseError("invalid_row") }
                    let failed = previous + 1
                    let lock = Self.lockout(failed,now:attempted)
                    try await connection.execute("UPDATE users SET failed_login_count=$2::integer,locked_until=$3::timestamp WHERE id=$1",[user["id"],.integer(failed),lock.map { .string(SwiftServiceJSON.iso($0)) } ?? .null])
                    let summary = lock == nil ? "ເຂົ້າລະບົບບໍ່ສຳເລັດ · \(address)" : "ເຂົ້າລະບົບບໍ່ສຳເລັດ \(failed) ຄັ້ງ · ລັອກບັນຊີຊົ່ວຄາວ · \(address)"
                    try await Self.audit(connection,userID:user.text("id"),action:"login_failed",summary:summary,metadata:.object(["ip":.string(address),"userAgent":agent,"failedLoginCount":.integer(failed),"lockedUntil":lock.map { .string(SwiftServiceJSON.iso($0)) } ?? .null]))
                }
                return (Self.error(401,Self.invalid),user == nil)
            }
            let sid = try SwiftCredentials.createSessionId(); let expires = attempted.addingTimeInterval(43200)
            try await connection.execute("DELETE FROM user_sessions WHERE expires_at < $1::timestamp",[.string(SwiftServiceJSON.iso(attempted))])
            try await connection.execute("INSERT INTO user_sessions(id,user_id,expires_at,ip,user_agent) VALUES($1,$2,$3::timestamp,$4,$5)",[.string(sid),user["id"],.string(SwiftServiceJSON.iso(expires)),.string(address),agent])
            try await connection.execute("UPDATE users SET last_login_at=$2::timestamp,failed_login_count=0,locked_until=NULL WHERE id=$1",[user["id"],.string(SwiftServiceJSON.iso(attempted))])
            try await Self.audit(connection,userID:user.text("id"),action:"login",summary:"ເຂົ້າລະບົບ · \(address)",metadata:.object(["ip":.string(address),"userAgent":agent]))
            let payload: JSONValue = .object(["userId":user["id"],"sid":.string(sid),"email":user["email"],"fullName":user["fullName"],"role":user["role"],"credentialTag":.string(SwiftCredentials.createCredentialTag(userId:user.text("id"),passwordHash:user.text("passwordHash"),secret:secret)),"exp":.number(SwiftCredentials.epochSeconds(expires))])
            let token = try SwiftCredentials.signSession(payload,secret:secret)
            return (.init(data:.object(["ok":.bool(true),"role":user["role"],"fullName":user["fullName"]]),headers:Self.headers.merging(["Set-Cookie":Self.cookie(token,age:43200) + "; Priority=High"],uniquingKeysWith: { _,new in new })),false)
        }
        if outcome.1 {
            if unknown.count >= 5000 {
                unknown = unknown.filter { attempted.timeIntervalSince($0.value.touched) <= 86400 }
                if unknown.count >= 5000, let oldest = unknown.min(by: { $0.value.touched < $1.value.touched })?.key { unknown.removeValue(forKey:oldest) }
            }
            let count = (unknownState?.count ?? 0) + 1
            unknown[email] = (count,Self.lockout(count,now:attempted),attempted)
        }
        return outcome.0
    }
    func logout(token: String?) async throws -> SwiftServiceReply {
        if let payload = SwiftCredentials.verifySession(token,secret:configuration.sessionSecret) {
            // Like the old route, always clear the client cookie even if storage is unavailable.
            try? await database.execute("DELETE FROM user_sessions WHERE id=$1 AND user_id=$2",[payload["sid"],payload["userId"]])
        }
        return .init(status:303,data:.null,headers:["Location":"/login","Cache-Control":"no-store","Set-Cookie":Self.cookie("",age:0)])
    }
    private func acquire(_ email: String) async {
        if queues[email] == nil { queues[email] = []; return }
        await withCheckedContinuation { queues[email,default:[]].append($0) }
    }
    private func release(_ email: String) {
        if queues[email]?.isEmpty == false { queues[email]!.removeFirst().resume() } else { queues.removeValue(forKey:email) }
    }
    private static func lockout(_ count: Int, now: Date) -> Date? { count < 5 ? nil : now.addingTimeInterval(min(3600,900 * pow(2,Double(min(count - 5,8))))) }
    private static func error(_ status: Int, _ text: String) -> SwiftServiceReply { .init(status:status,data:.object(["error":.string(text)]),headers:headers) }
    private static func limited(_ seconds: TimeInterval) -> SwiftServiceReply {
        .init(status:429,data:.object(["error":.string("ລອງເຂົ້າລະບົບຫຼາຍເກີນໄປ ກະລຸນາລໍຖ້າແລ້ວລອງໃໝ່")]),headers:headers.merging(["Retry-After":String(max(1,Int(ceil(seconds))))],uniquingKeysWith: { _,new in new }))
    }
    private static func cookie(_ token: String, age: Int) -> String { "yogurt_session=\(token); Path=/; Max-Age=\(age); HttpOnly; Secure; SameSite=Strict" }
    private static func audit(_ connection: SwiftSQLConnection, userID: String, action: String, summary: String, metadata: JSONValue) async throws {
        try await connection.execute("INSERT INTO audit_logs(id,user_id,action,entity_type,entity_id,summary,metadata) VALUES($1,$2,$3,'user',$2,$4,$5::jsonb)",[.string(UUID().uuidString),.string(userID),.string(action),.string(summary),metadata])
    }
}
