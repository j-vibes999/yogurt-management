import SwiftUI
import AppKit

/// The verification engine must start before SwiftUI, AppModel or Keychain initialization.
@main enum YogurtEntry {
    static func main() {
        if CommandLine.arguments.dropFirst().first == SwiftEngineCLI.flag { SwiftEngineCLI.run() }
        YogurtNativeApp.main()
    }
}

struct YogurtNativeApp: App {
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
                // ⌘1–⌘9 follow the sidebar order, replacing the arrow keys of a system list.
                ForEach(Array(Destination.allCases.enumerated()), id: \.element) { index, destination in
                    let button = Button(destination.title, systemImage: destination.symbol) { model.navigate(destination) }.disabled(!destination.isAllowed(role: model.session?.role ?? ""))
                    if index < 9 { button.keyboardShortcut(KeyEquivalent(Character(String(index + 1))), modifiers: .command) } else { button }
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
                    SidebarView(model: model, session: session).navigationSplitViewColumnWidth(min: 236, ideal: 256, max: 300)
                } detail: {
                    VStack(spacing: 0) {
                        if session.source != "database" { banner("ຖານຂໍ້ມູນຂາດການເຊື່ອມຕໍ່ · ອ່ານຂໍ້ມູນເກົ່າໄດ້ ແຕ່ບັນທຶກບໍ່ໄດ້") }
                        if !model.legacyReviewed {
                            HStack { Label("ຍັງບໍ່ໄດ້ກວດກາລາຍການຄ້າງຈາກແອັບເດີມ · ອ່ານຢ່າງດຽວ", systemImage: "exclamationmark.triangle"); Spacer(); Button("ກວດກາ") { recovery = true } }.padding(12).background(Theme.mango.opacity(0.12))
                        }
                        destination.id(session.userId + ":" + session.role + ":" + model.selected.rawValue)
                    }.background(Theme.cream)
                    // Stripes filling the empty space below a few rows read as loading placeholders.
                    .tableStyle(.inset(alternatesRowBackgrounds: false))
                }
                .toolbar {
                    // Without a window title the toolbar has no flexible space, so push the tools to the trailing edge.
                    ToolbarItem(placement: .automatic) { Spacer() }
                    ToolbarItemGroup(placement: .automatic) {
                        Button { model.navigate(.notifications) } label: { Label("ແຈ້ງເຕືອນ", systemImage: "bell") }.help("ແຈ້ງເຕືອນ")
                        Button { recovery = true; Task { await model.refreshPending() } } label: { Label(model.pendingCommands.isEmpty ? "ລາຍການຄ້າງ" : "ລາຍການຄ້າງ (\(model.pendingCommands.count))", systemImage: "clock.arrow.circlepath") }.help("ລາຍການທີ່ລໍຜົນ")
                    }
                }
                // The sidebar already names the app; each workspace shows its own title.
                .toolbar(removing: .title)
                .toolbarBackground(Theme.cream, for: .windowToolbar)
            } else { NativeLoginView(model: model) }
        }
        .sheet(isPresented: $recovery) { PendingRecoveryView(model: model) }
        .alert("Yogurt Manager", isPresented: Binding(get: { model.notice != nil }, set: { if !$0 { model.notice = nil } })) { Button("ຕົກລົງ") { model.notice = nil } } message: { Text(model.notice ?? "") }
    }
    private func banner(_ text: String) -> some View { Label(text, systemImage: "wifi.exclamationmark").padding(12).frame(maxWidth: .infinity, alignment: .leading).background(Theme.mango.opacity(0.12)) }
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
        VStack(alignment: .leading, spacing: 20) {
            BrandLockup(dark: false)
            Divider()
            Text(model.needsConfiguration ? "ເຊື່ອມຕໍ່ Supabase ຂອງທ່ານ" : "ກຳລັງເປີດແອັບ").font(Theme.font(21, weight: .bold)).foregroundStyle(Theme.ink)
            if model.needsConfiguration {
                Text("ເລືອກໄຟລ໌ .env ຂອງໂປຣເຈັກ. ແອັບຈະເກັບ DATABASE_URL ໃນ macOS Keychain.").foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true)
                Button("ເລືອກໄຟລ໌ຕັ້ງຄ່າ…") { choosing = true }.buttonStyle(.borderedProminent).controlSize(.large)
            } else if let failure = model.startupError {
                Label(failure, systemImage: "exclamationmark.triangle").foregroundStyle(Theme.danger).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                Button("ລອງເປີດໃໝ່") { Task { await model.start() } }.controlSize(.large)
            } else { HStack(spacing: 10) { ProgressView().controlSize(.small); Text(model.startupState).foregroundStyle(Theme.muted) } }
            if let error { Text(error).foregroundStyle(Theme.danger) }
        }
        .padding(32).frame(width: 480, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border))
        .frame(maxWidth: .infinity, maxHeight: .infinity).background(Theme.cream)
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
            VStack(alignment: .leading, spacing: 0) {
                BrandLockup(dark: true)
                Spacer(minLength: 32)
                Text("ຈັດການວຽກປະຈຳວັນ\nໃນບ່ອນດຽວ").font(Theme.font(30, weight: .bold)).foregroundStyle(.white).lineSpacing(6).fixedSize(horizontal: false, vertical: true)
                Text("ຮ້ານຄ້າ, ສະຕັອກ, ການຜະລິດ ແລະການເງິນ ເຊື່ອມກັບຖານຂໍ້ມູນດຽວກັນ").font(Theme.font(15)).foregroundStyle(Theme.sidebarText)
                    .fixedSize(horizontal: false, vertical: true).padding(.top, 12)
                VStack(alignment: .leading, spacing: 14) {
                    LoginFeature(symbol: Destination.driver.symbol, text: "ກວດຮ້ານ, ເຕີມສິນຄ້າ ແລະຮັບເງິນ")
                    LoginFeature(symbol: Destination.inventory.symbol, text: "ວັດຖຸດິບ ແລະການຜະລິດ")
                    LoginFeature(symbol: Destination.reports.symbol, text: "ລາຍຈ່າຍ ແລະລາຍງານກຳໄລ")
                }.padding(.top, 32)
                Spacer(minLength: 32)
                Text("ແອັບ macOS · ຂໍ້ມູນຢູ່ໃນ Supabase").font(Theme.font(12)).foregroundStyle(Theme.sidebarText.opacity(0.8))
            }.padding(48).frame(width: 440).frame(maxHeight: .infinity, alignment: .leading).background(Theme.evergreen)
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("ເຂົ້າລະບົບ").font(Theme.font(26, weight: .bold)).foregroundStyle(Theme.evergreen)
                    Text("ໃຊ້ບັນຊີດຽວກັບລະບົບເດີມ").foregroundStyle(Theme.muted)
                }
                if let startupError = model.startupError { Label(startupError, systemImage: "wifi.exclamationmark").foregroundStyle(Theme.danger).fixedSize(horizontal: false, vertical: true) }
                VStack(alignment: .leading, spacing: 8) { Text("ອີເມວ").font(Theme.font(13, weight: .semibold)); TextField("name@example.com", text: $email).textContentType(.username).focused($focus, equals: .email).onSubmit { focus = .password } }
                VStack(alignment: .leading, spacing: 8) { Text("ລະຫັດຜ່ານ").font(Theme.font(13, weight: .semibold)); SecureField("ລະຫັດຜ່ານ", text: $password).textContentType(.password).focused($focus, equals: .password).onSubmit { Task { await login() } } }
                if let error { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(Theme.danger).fixedSize(horizontal: false, vertical: true) }
                Button { Task { await login() } } label: {
                    HStack(spacing: 8) { if busy { ProgressView().controlSize(.small) }; Text(busy ? "ກຳລັງເຂົ້າລະບົບ…" : "ເຂົ້າລະບົບ").font(Theme.font(15, weight: .semibold)) }.frame(maxWidth: .infinity)
                }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(busy || email.isEmpty || password.isEmpty).padding(.top, 4)
            }
            .textFieldStyle(.roundedBorder).controlSize(.large).disabled(busy)
            .padding(32).frame(width: 400)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border))
            .frame(maxWidth: .infinity, maxHeight: .infinity).background(Theme.cream)
        }.onAppear { focus = .email }
    }
    private func login() async { guard !busy else { return }; busy = true; error = nil; defer { busy = false }; do { try await model.login(email: email.trimmingCharacters(in: .whitespaces), password: password); password = "" } catch { self.error = error.localizedDescription } }
}

/// Brand mark with the product name, as in the sidebar; `dark` places it on evergreen.
private struct BrandLockup: View {
    let dark: Bool
    var body: some View {
        HStack(spacing: 12) {
            BrandMark().frame(width: 28, height: 28).foregroundStyle(Theme.evergreen)
                .frame(width: 44, height: 44).background(Theme.accent, in: RoundedRectangle(cornerRadius: 11))
            VStack(alignment: .leading, spacing: 1) {
                Text("Yogurt Manager").font(Theme.font(18, weight: .bold)).foregroundStyle(dark ? .white : Theme.evergreen)
                Text("ລະບົບຈັດການໂຢເກີດ").font(Theme.font(13, weight: .semibold)).foregroundStyle(dark ? Theme.sidebarText : Theme.muted)
            }
        }.accessibilityElement(children: .combine)
    }
}

private struct LoginFeature: View {
    let symbol: String
    let text: String
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol).font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.accent)
                .frame(width: 32, height: 32).background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
            Text(text).font(Theme.font(14, weight: .medium)).foregroundStyle(Theme.surfaceSoft)
        }
    }
}
