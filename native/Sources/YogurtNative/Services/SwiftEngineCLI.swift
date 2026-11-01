import Foundation
import Darwin

/// Verification-only adapter: newline-delimited JSON frames on stdin/stdout, no listener.
/// It accepts only a local `yogurt_e2e_*` database and an owner-only scratch data root.
///   in:  {"version":1,"type":"bootstrap","dataRoot":…,"capability":…,"config":{"DATABASE_URL":…,"SESSION_SECRET":…}}
///        {"version":1,"type":"request","id":…,"method":…,"path":…,"headers":{…},"body":<base64>}
///        {"version":1,"type":"shutdown"}
///   out: {"version":1,"type":"ready"|"failed"|"shutdown"} and {"version":1,"type":"response","id":…,"status":…,"headers":{…},"body":<base64>}
enum SwiftEngineCLI {
    static let flag = "--yogurt-engine-stdio"
    private static let maximumFrame = 40 * 1024 * 1024
    private static let maximumInFlight = 32

    static func run() -> Never {
        signal(SIGPIPE, SIG_IGN)
        Task.detached { exit(await serve()) }
        dispatchMain()
    }

    private static func serve() async -> Int32 {
        let output = FrameWriter()
        var engine: SwiftEngine?
        var capability = ""
        let gate = InFlightGate(limit: maximumInFlight)
        var tasks: [Task<Void, Never>] = []
        func fail(_ code: String) async -> Int32 { await output.write(["version": .integer(1), "type": .string("failed"), "code": .string(code)]); return 1 }
        do {
            for try await line in FileHandle.standardInput.bytes.lines {
                guard line.utf8.count <= maximumFrame, let frame = try? JSONDecoder().decode(JSONValue.self, from: Data(line.utf8)), frame["version"] == .integer(1) else {
                    return await fail("protocol")
                }
                switch frame.text("type") {
                case "bootstrap" where engine == nil:
                    guard let started = await bootstrap(frame) else { return await fail("bootstrap") }
                    engine = started.engine; capability = started.capability
                    await output.write(["version": .integer(1), "type": .string("ready")])
                case "request" where engine != nil:
                    let id = frame.text("id")
                    guard !id.isEmpty, id.utf8.count <= 64, let body = Data(base64Encoded: frame.text("body")) else { return await fail("request-frame") }
                    let headers = frame["headers"].object.compactMapValues { value -> String? in if case .string(let text) = value { return text }; return nil }
                    let request = EngineRequest(method: frame.text("method"), path: frame.text("path"), headers: headers, body: body)
                    await gate.enter()
                    let running = engine!
                    tasks.append(Task {
                        let response: EngineResponse
                        if request.header("x-yogurt-desktop-token") != capability { response = .json(403, .object(["error": .string("ຄຳຂໍບໍ່ໄດ້ຮັບອະນຸຍາດ")])) }
                        else if request.path == "/_desktop/ready" { response = .json(200, .object(["ok": .bool(true)])) }
                        else { response = await running.handle(request) }
                        await output.write(["version": .integer(1), "type": .string("response"), "id": .string(id), "status": .integer(response.status),
                                            "headers": .object(response.headers.mapValues(JSONValue.string)), "body": .string(response.body.base64EncodedString())])
                        await gate.leave()
                    })
                case "shutdown":
                    for task in tasks { await task.value }
                    await engine?.stop()
                    await output.write(["version": .integer(1), "type": .string("shutdown")])
                    return 0
                default: return await fail("protocol")
                }
            }
        } catch { return await fail("stdin") }
        for task in tasks { await task.value }
        await engine?.stop()
        return 0
    }

    private static func bootstrap(_ frame: JSONValue) async -> (engine: SwiftEngine, capability: String)? {
        let capability = frame.text("capability"), url = frame["config"].text("DATABASE_URL"), secret = frame["config"].text("SESSION_SECRET")
        let root = URL(fileURLWithPath: frame.text("dataRoot"))
        guard capability.count >= 32, secret.count >= 32, frame.text("dataRoot").hasPrefix("/"),
              (try? BackendConfiguration.validate(url, verification: true)) != nil,
              let attributes = try? FileManager.default.attributesOfItem(atPath: root.path),
              attributes[.type] as? FileAttributeType == .typeDirectory,
              (attributes[.ownerAccountID] as? NSNumber)?.uint32Value == getuid(),
              (attributes[.posixPermissions] as? NSNumber)?.intValue == 0o700 else { return nil }
        guard let engine = try? SwiftEngine(configuration: BackendConfiguration(databaseURL: url, sessionSecret: secret, legacyReviewed: true), dataRoot: root, verification: true),
              (try? await engine.start()) != nil else { return nil }
        return (engine, capability)
    }
}

/// Serializes protocol output so concurrent replies never interleave.
private actor FrameWriter {
    func write(_ fields: [String: JSONValue]) {
        guard let data = try? JSONValue.object(fields).encoded() else { return }
        FileHandle.standardOutput.write(data + Data("\n".utf8))
    }
}

/// Bounds concurrent requests while still letting them overlap in the database.
private actor InFlightGate {
    private let limit: Int
    private var active = 0
    private var waiting: [CheckedContinuation<Void, Never>] = []
    init(limit: Int) { self.limit = limit }
    func enter() async {
        if active < limit { active += 1; return }
        await withCheckedContinuation { waiting.append($0) }
    }
    func leave() {
        if waiting.isEmpty { active -= 1 } else { waiting.removeFirst().resume() }
    }
}
