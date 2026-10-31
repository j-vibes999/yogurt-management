import SwiftUI
import AppKit

@main struct YogurtNativeApp: App {
    @NSApplicationDelegateAdaptor(YogurtAppDelegate.self) private var delegate
    @StateObject private var model = AppModel()
    init() { Theme.registerFonts() }
    var body: some Scene {
        Window("Yogurt Manager", id: "main") {
            NativeRootView(model: model)
                .environmentObject(model).font(Theme.font()).tint(Theme.green).preferredColorScheme(.light)
                .frame(minWidth: 1050, minHeight: 700)
                .onAppear { delegate.model = model }
                .task { await model.start() }
        }.defaultSize(width: 1320, height: 860)
        .commands {
            CommandGroup(replacing: .newItem) {}
            CommandMenu("ໜ້າວຽກ") {
                ForEach(Destination.allCases) { destination in
                    Button(destination.title) { model.navigate(destination) }.disabled(!destination.isAllowed(role: model.session?.role ?? ""))
                }
            }
        }
    }
}

@MainActor final class YogurtAppDelegate: NSObject, NSApplicationDelegate {
    weak var model: AppModel?
    private var terminating = false
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !terminating else { return .terminateLater }; terminating = true
        Task { await model?.shutdown(); NSApp.reply(toApplicationShouldTerminate: true) }
        return .terminateLater
    }
}

struct NativeRootView: View {
    @ObservedObject var model: AppModel
    @State private var recovery = false
    var body: some View {
        Group {
            if !model.ready { NativeStartupView(model: model) }
            else if let session = model.session {
                NavigationSplitView {
                    List(selection: Binding<Destination?>(get: { model.selected }, set: { if let value = $0 { model.navigate(value) } })) {
                        Section("ວຽກປະຈຳວັນ") { links([.overview, .stores, .map, .refills, .driver, .settlements], role: session.role) }
                        Section("ສະຕັອກ ແລະການຜະລິດ") { links([.inventory, .production], role: session.role) }
                        if session.role == "admin" {
                            Section("ການເງິນ") { links([.expenses, .reports], role: session.role) }
                            Section("ຈັດການ") { links([.operations], role: session.role) }
                        }
                    }.listStyle(.sidebar).navigationTitle("Yogurt Manager").navigationSplitViewColumnWidth(min: 220, ideal: 245, max: 300)
                    .safeAreaInset(edge: .bottom) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(session.fullName).font(Theme.font(13, weight: .semibold))
                            Text(session.role == "admin" ? "ຜູ້ຈັດການ" : session.role == "driver" ? "ຈັດສົ່ງ / ຮັບເງິນ" : "ຝ່າຍຜະລິດ").font(Theme.font(11)).foregroundStyle(Theme.muted)
                            Text("SwiftUI · Supabase").font(.system(size: 10)).foregroundStyle(.secondary)
                        }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
                    }
                } detail: {
                    VStack(spacing: 0) {
                        if session.source != "database" { banner("ຖານຂໍ້ມູນຂາດການເຊື່ອມຕໍ່ · ອ່ານຂໍ້ມູນເກົ່າໄດ້ ແຕ່ບັນທຶກບໍ່ໄດ້") }
                        if !model.legacyReviewed {
                            HStack { Label("ຍັງບໍ່ໄດ້ກວດກາລາຍການຄ້າງຈາກແອັບເດີມ · ອ່ານຢ່າງດຽວ", systemImage: "exclamationmark.triangle"); Spacer(); Button("ກວດກາ") { recovery = true } }.padding(12).background(Theme.mango.opacity(0.12))
                        }
                        destination.id(session.userId + ":" + model.selected.rawValue)
                    }.background(Theme.cream)
                }
                .toolbar {
                    ToolbarItemGroup(placement: .primaryAction) {
                        Button { model.navigate(.notifications) } label: { Label("ແຈ້ງເຕືອນ", systemImage: "bell") }.help("ແຈ້ງເຕືອນ")
                        Button { recovery = true; Task { await model.refreshPending() } } label: { Label(model.pendingCommands.isEmpty ? "ລາຍການຄ້າງ" : "ລາຍການຄ້າງ (\(model.pendingCommands.count))", systemImage: "clock.arrow.circlepath") }
                        Menu { Button("ກວດກາການເຊື່ອມຕໍ່") { Task { do { try await model.refreshSession() } catch { model.showNotice(error.localizedDescription) } } }; Button("ອອກຈາກລະບົບ") { Task { do { try await model.logout() } catch { model.showNotice(error.localizedDescription) } } } } label: { Label("ບັນຊີ", systemImage: "person.crop.circle") }
                    }
                }
            } else { NativeLoginView(model: model) }
        }
        .sheet(isPresented: $recovery) { PendingRecoveryView(model: model) }
        .alert("Yogurt Manager", isPresented: Binding(get: { model.notice != nil }, set: { if !$0 { model.notice = nil } })) { Button("ຕົກລົງ") { model.notice = nil } } message: { Text(model.notice ?? "") }
    }
    private func banner(_ text: String) -> some View { Label(text, systemImage: "wifi.exclamationmark").padding(12).frame(maxWidth: .infinity, alignment: .leading).background(Theme.mango.opacity(0.12)) }
    @ViewBuilder private func links(_ destinations: [Destination], role: String) -> some View {
        ForEach(destinations.filter { $0.isAllowed(role: role) }) { destination in Label(destination.title, systemImage: destination.symbol).foregroundStyle(destination == model.selected ? Theme.ink : destination.domain.color).tag(destination) }
    }
    @ViewBuilder private var destination: some View {
        switch model.selected {
        case .overview: OverviewView(model: model)
        case .stores:
            if let store = model.contextStoreId { VStack(spacing: 0) { HStack { Button("ກັບຄືນລາຍຊື່ຮ້ານ", systemImage: "chevron.left") { model.navigate(.stores) }; Spacer() }.padding(.horizontal, 24).padding(.top, 12); StoreDetailView(model: model, storeId: store) }.id(store) }
            else { StoresView(model: model) }
        case .map: MapWorkspaceView(model: model)
        case .refills: RefillsView(model: model)
        case .driver: DriverView(model: model)
        case .settlements: SettlementsView(model: model)
        case .inventory: InventoryView(model: model)
        case .production: ProductionView(model: model)
        case .expenses: ExpensesView(model: model)
        case .reports: ReportsView(model: model)
        case .operations: OperationsView(model: model)
        case .fridges: FridgesView(model: model)
        case .notifications: NotificationsView(model: model)
        case .audit: AuditView(model: model)
        }
    }
}

struct NativeStartupView: View {
    @ObservedObject var model: AppModel
    @State private var choosing = false
    @State private var error: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            Label("Yogurt Manager", systemImage: "cup.and.saucer.fill").font(Theme.font(32, weight: .bold)).foregroundStyle(Theme.evergreen)
            Text(model.needsConfiguration ? "ເຊື່ອມຕໍ່ Supabase ຂອງທ່ານ" : "ກຳລັງເປີດແອັບ").font(Theme.font(23, weight: .semibold))
            if model.needsConfiguration {
                Text("ເລືອກໄຟລ໌ .env ຂອງໂປຣເຈັກ. ແອັບຈະເກັບ DATABASE_URL ໃນ macOS Keychain.").fixedSize(horizontal: false, vertical: true)
                Button("ເລືອກໄຟລ໌ຕັ້ງຄ່າ…") { choosing = true }.buttonStyle(.borderedProminent).controlSize(.large)
            } else if let failure = model.startupError {
                Label(failure, systemImage: "exclamationmark.triangle").foregroundStyle(Theme.danger).textSelection(.enabled)
                Button("ລອງເປີດໃໝ່") { Task { await model.start() } }.controlSize(.large)
            } else { ProgressView(model.startupState) }
            if let error { Text(error).foregroundStyle(Theme.danger) }
        }.frame(width: 560, alignment: .leading).padding(44).frame(maxWidth: .infinity, maxHeight: .infinity).background(Theme.cream)
        .fileImporter(isPresented: $choosing, allowedContentTypes: [.item]) { result in
            Task { do { try await model.importConfiguration(result.get()) } catch { self.error = error.localizedDescription } }
        }
    }
}

struct NativeLoginView: View {
    @ObservedObject var model: AppModel
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focus: Field?
    enum Field { case email, password }
    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 24) {
                Label("Yogurt Manager", systemImage: "cup.and.saucer.fill").font(Theme.font(33, weight: .bold))
                Text("ຈັດການວຽກປະຈຳວັນ\nຮ້ານຄ້າ, ສະຕັອກ ແລະການເງິນ").font(Theme.font(24, weight: .medium)).lineSpacing(10)
                Text("ແອັບ macOS · ຖານຂໍ້ມູນ Supabase").font(Theme.font(13)).opacity(0.8)
            }.foregroundStyle(.white).padding(48).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading).background(Theme.evergreen)
            VStack(alignment: .leading, spacing: 20) {
                Text("ເຂົ້າລະບົບ").font(Theme.font(29, weight: .bold)).foregroundStyle(Theme.evergreen)
                Text("ໃຊ້ບັນຊີຂອງລະບົບເດີມ").foregroundStyle(Theme.muted)
                if let startupError = model.startupError { Label(startupError, systemImage: "wifi.exclamationmark").foregroundStyle(Theme.danger).fixedSize(horizontal: false, vertical: true) }
                VStack(alignment: .leading, spacing: 8) { Text("ອີເມວ"); TextField("name@example.com", text: $email).textContentType(.username).focused($focus, equals: .email).onSubmit { focus = .password } }
                VStack(alignment: .leading, spacing: 8) { Text("ລະຫັດຜ່ານ"); SecureField("ລະຫັດຜ່ານ", text: $password).textContentType(.password).focused($focus, equals: .password).onSubmit { Task { await login() } } }
                if let error { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(Theme.danger).fixedSize(horizontal: false, vertical: true) }
                HStack { if busy { ProgressView().controlSize(.small) }; Button("ເຂົ້າລະບົບ") { Task { await login() } }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(busy || email.isEmpty || password.isEmpty) }.frame(maxWidth: .infinity, alignment: .trailing)
            }.textFieldStyle(.roundedBorder).controlSize(.large).disabled(busy).padding(56).frame(width: 500).frame(maxHeight: .infinity).background(Theme.cream)
        }.onAppear { focus = .email }
    }
    private func login() async { guard !busy else { return }; busy = true; error = nil; defer { busy = false }; do { try await model.login(email: email.trimmingCharacters(in: .whitespaces), password: password); password = "" } catch { self.error = error.localizedDescription } }
}
