import SwiftUI
import CoreText

enum Theme {
    private static func color(_ hex: UInt32) -> Color { Color(red: Double((hex >> 16) & 255) / 255, green: Double((hex >> 8) & 255) / 255, blue: Double(hex & 255) / 255) }
    static let cream = color(0xF8F6EF), surface = Color.white, evergreen = color(0x173B31), green = color(0x20754F)
    static let ink = color(0x21372D), muted = color(0x617166), border = color(0xDCE4D9), blue = color(0x326D96)
    static let mango = color(0x8A5B17), purple = color(0x75509E), danger = color(0xB6444E)
    // Navigation tokens from src/app/professional.css (--sidebar-text, --line-strong, --surface-soft, --sidebar-active-bg, --accent).
    static let sidebarText = color(0xD4E4D9), sidebarIcon = color(0xB7C6B8), surfaceSoft = color(0xF4F7F2), mint = color(0xEAF5ED)
    static let accent = color(0xE6AA50), success = color(0x2A754B), onlineDot = color(0x7BCB9A)
    static func font(_ size: CGFloat = 14, weight: Font.Weight = .regular) -> Font { .custom("NotoSansLao-Regular", size: size).weight(weight) }
    static func registerFonts() {
        for name in ["NotoSansLao-Variable", "NotoSansLao"] {
            if let url = Bundle.module.url(forResource: name, withExtension: "ttf") { CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil) }
        }
    }
}

struct Workspace<Actions: View, Content: View>: View {
    let title: String
    let subtitle: String
    let domain: WorkDomain
    let actions: Actions
    let content: Content
    init(title: String, subtitle: String = "", domain: WorkDomain, @ViewBuilder actions: () -> Actions, @ViewBuilder content: () -> Content) {
        self.title = title; self.subtitle = subtitle; self.domain = domain; self.actions = actions(); self.content = content()
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 24) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(title).font(Theme.font(25, weight: .bold)).foregroundStyle(domain.color).accessibilityAddTraits(.isHeader)
                    if !subtitle.isEmpty { Text(subtitle).font(Theme.font(13)).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true) }
                }
                Spacer(minLength: 8)
                // Header buttons keep their full labels; the title and subtitle give way instead.
                HStack(spacing: 10) { actions }.controlSize(.large).fixedSize()
            }.padding(24)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) { content }.padding(24).frame(maxWidth: .infinity, alignment: .leading)
            }
        }.frame(maxWidth: .infinity, maxHeight: .infinity).background(Theme.cream)
    }
}
extension Workspace where Actions == EmptyView {
    init(title: String, subtitle: String = "", domain: WorkDomain, @ViewBuilder content: () -> Content) { self.init(title: title, subtitle: subtitle, domain: domain, actions: { EmptyView() }, content: content) }
}

struct ReadStateView<Content: View>: View {
    @ObservedObject var state: FeatureState
    let content: Content
    init(state: FeatureState, @ViewBuilder content: () -> Content) { self.state = state; self.content = content() }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let error = state.error {
                HStack(alignment: .top, spacing: 12) {
                    Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(Theme.danger).textSelection(.enabled)
                    Spacer(); Button("ລອງໃໝ່") { Task { await state.refresh() } }.disabled(state.loading)
                }.padding(14).background(Theme.surface, in: RoundedRectangle(cornerRadius: 8))
                if state.data != .null { StatusLabel("ກຳລັງສະແດງຂໍ້ມູນທີ່ໂຫຼດໄວ້ກ່ອນໜ້າ · ກວດກາກ່ອນເຮັດລາຍການ", tone: .warning) }
            }
            if state.loading { ProgressView(state.data == .null ? "ກຳລັງໂຫຼດ…" : "ກຳລັງອັບເດດ…").controlSize(.small) }
            if state.data != .null {
                if state.source == "demo" { StatusLabel("ຂໍ້ມູນສາທິດ · ບັນທຶກລາຍການບໍ່ໄດ້", tone: .warning) }
                // One control height for every workspace's search and filter row.
                content.controlSize(.large)
                if !state.generatedAt.isEmpty { Text("ອັບເດດ \(operationsDate(state.generatedAt))").font(Theme.font(11)).foregroundStyle(Theme.muted).textSelection(.enabled) }
            } else if !state.loading && state.error == nil { EmptyNotice(title: "ຍັງບໍ່ມີຂໍ້ມູນ") }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

extension View {
    /// Tables share the panel shape: white, 10-point corners and a restrained border (DESIGN.md › Tables, Radius).
    func tableSurface() -> some View {
        clipShape(RoundedRectangle(cornerRadius: 10)).overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.border))
    }
}

enum StatusTone { case neutral, info, success, warning, danger
    var color: Color { switch self { case .neutral: Theme.muted; case .info: Theme.blue; case .success: Theme.green; case .warning: Theme.mango; case .danger: Theme.danger } }
    var symbol: String { switch self { case .neutral: "circle"; case .info: "info.circle"; case .success: "checkmark.circle"; case .warning: "exclamationmark.triangle"; case .danger: "xmark.octagon" } }
}
struct StatusLabel: View {
    let text: String
    let tone: StatusTone
    init(_ text: String, tone: StatusTone = .neutral) { self.text = text; self.tone = tone }
    var body: some View { Label(text, systemImage: tone.symbol).font(Theme.font(12, weight: .medium)).foregroundStyle(tone.color).padding(.horizontal, 9).padding(.vertical, 5).background(tone.color.opacity(0.08), in: RoundedRectangle(cornerRadius: 6)).fixedSize(horizontal: false, vertical: true) }
}
struct EmptyNotice: View {
    let title: String
    var detail = ""
    var symbol = "tray"
    var body: some View { ContentUnavailableView { Label(title, systemImage: symbol).font(Theme.font(19, weight: .semibold)) } description: { Text(detail).font(Theme.font()) }.frame(maxWidth: .infinity, minHeight: 170) }
}
struct AmountText: View {
    let value: Decimal
    var currency = true
    init(_ value: Decimal, currency: Bool = true) { self.value = value; self.currency = currency }
    var body: some View {
        let formatter = NumberFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.numberStyle = .decimal
        // The POSIX locale has no grouping separator; keep 1,234,567.25 like the web app.
        formatter.usesGroupingSeparator = true; formatter.groupingSeparator = ","; formatter.groupingSize = 3
        formatter.minimumFractionDigits = currency ? 2 : 0; formatter.maximumFractionDigits = currency ? 2 : 6
        return Text((formatter.string(from: NSDecimalNumber(decimal: value)) ?? "—") + (currency ? " ₭" : "")).monospacedDigit()
    }
}
struct MoneyText: View {
    let value: JSONValue
    init(_ value: JSONValue) { self.value = value }
    var body: some View { AmountText(value.decimal) }
}

struct EditorChoice: Identifiable { let id: String; let label: String }
struct EditorField: Identifiable {
    enum Kind { case text, multiline, money, integer, decimal, date, choice([EditorChoice]) }
    let key: String
    let label: String
    var kind: Kind = .text
    var required = false
    var help = ""
    var id: String { key }
}

struct NativeEditor: View {
    let title: String
    let fields: [EditorField]
    let initial: [String: String]
    var saveLabel: String
    let onSave: ([String: String]) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var values: [String: String]
    @State private var error: String?
    @State private var busy = false
    @State private var discard = false
    init(title: String, fields: [EditorField], initial: [String: String] = [:], saveLabel: String = "ບັນທຶກ", onSave: @escaping ([String: String]) async throws -> Void) {
        var prepared = initial
        for field in fields where field.required && (prepared[field.key] ?? "").isEmpty { if case .date = field.kind { prepared[field.key] = businessDateString(Date()) } }
        self.title = title; self.fields = fields; self.initial = prepared; self.saveLabel = saveLabel; self.onSave = onSave
        _values = State(initialValue: prepared)
    }
    private var dirty: Bool { values != initial }
    private func binding(_ key: String) -> Binding<String> { Binding(get: { values[key] ?? "" }, set: { values[key] = $0 }) }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text(title).font(Theme.font(23, weight: .bold)).foregroundStyle(Theme.evergreen)
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ForEach(fields) { field in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(field.label + (field.required ? " *" : "")).font(Theme.font(13, weight: .medium))
                            control(field).accessibilityLabel(field.label)
                            if !field.help.isEmpty { Text(field.help).font(Theme.font(12)).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true) }
                        }
                    }
                }.padding(.vertical, 4)
            }.textFieldStyle(.roundedBorder).disabled(busy)
            if let error { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(Theme.danger).textSelection(.enabled).fixedSize(horizontal: false, vertical: true) }
            Divider()
            HStack {
                Button("ຍົກເລີກ") { if dirty { discard = true } else { dismiss() } }.keyboardShortcut(.cancelAction).disabled(busy)
                Spacer(); if busy { ProgressView().controlSize(.small) }
                Button(saveLabel) { Task { await save() } }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(busy)
            }.controlSize(.large)
        }.padding(24).frame(width: 600).frame(minHeight: 340, maxHeight: 740).font(Theme.font()).background(Theme.cream)
        .interactiveDismissDisabled(dirty || busy)
        .confirmationDialog("ຍົກເລີກການແກ້ໄຂ?", isPresented: $discard) {
            Button("ຖິ້ມການແກ້ໄຂ", role: .destructive) { dismiss() }; Button("ກັບໄປແກ້ໄຂ", role: .cancel) {}
        } message: { Text("ຄ່າທີ່ຍັງບໍ່ບັນທຶກຈະຫາຍໄປ") }
    }
    @ViewBuilder private func control(_ field: EditorField) -> some View {
        switch field.kind {
        case .choice(let options):
            Picker(field.label, selection: binding(field.key)) { Text("ເລືອກ…").tag(""); ForEach(options) { Text($0.label).tag($0.id) } }.labelsHidden()
        case .multiline: TextEditor(text: binding(field.key)).frame(minHeight: 78).padding(5).overlay(RoundedRectangle(cornerRadius: 6).stroke(Theme.border))
        case .date:
            HStack {
                if field.required || !(values[field.key] ?? "").isEmpty {
                    DatePicker(field.label, selection: Binding(get: { Self.dateFormatter.date(from: values[field.key] ?? "") ?? Date() }, set: { values[field.key] = businessDateString($0) }), displayedComponents: .date).labelsHidden().environment(\.calendar, Calendar(identifier: .gregorian)).environment(\.timeZone, TimeZone(identifier: "Asia/Vientiane")!)
                    if !field.required { Button("ລ້າງວັນທີ") { values[field.key] = "" } }
                } else { Button("ເລືອກວັນທີ…") { values[field.key] = businessDateString(Date()) } }
            }
        default: TextField(field.label, text: binding(field.key)).labelsHidden()
        }
    }
    private func save() async {
        guard !busy else { return }; error = nil
        for field in fields where field.required && (values[field.key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { error = "ກະລຸນາໃສ່ \(field.label)"; return }
        busy = true; defer { busy = false }
        do { try await onSave(values); dismiss() }
        catch { self.error = error.localizedDescription }
    }
    private static var dateFormatter: DateFormatter { let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(identifier: "Asia/Vientiane"); formatter.dateFormat = "yyyy-MM-dd"; return formatter }
}
