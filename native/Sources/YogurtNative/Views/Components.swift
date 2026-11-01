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
    /// Forms load reference data with this view too; there the "updated" line is only clutter.
    var showsFreshness = true
    init(state: FeatureState, showsFreshness: Bool = true, @ViewBuilder content: () -> Content) { self.state = state; self.showsFreshness = showsFreshness; self.content = content() }
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
                if showsFreshness && !state.generatedAt.isEmpty { Text("ອັບເດດ \(operationsDate(state.generatedAt))").font(Theme.font(11)).foregroundStyle(Theme.muted).textSelection(.enabled) }
            } else if !state.loading && state.error == nil { EmptyNotice(title: "ຍັງບໍ່ມີຂໍ້ມູນ") }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A titled white card grouping related form fields (the same card every form uses).
struct FormCard<Content: View>: View {
    let title: String?
    let content: Content
    init(_ title: String? = nil, @ViewBuilder content: () -> Content) { self.title = title; self.content = content() }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let title { Text(title).font(Theme.font(14, weight: .bold)).foregroundStyle(Theme.evergreen).accessibilityAddTraits(.isHeader) }
            content
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border))
    }
}

/// Label above its control, as in the shared form, instead of a ragged inline label.
struct StackedLabeledContentStyle: LabeledContentStyle {
    func makeBody(configuration: Configuration) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            configuration.label.font(Theme.font(13, weight: .semibold)).foregroundStyle(Theme.ink)
            configuration.content.frame(maxWidth: .infinity, alignment: .leading)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A calendar date picker over the yyyy-MM-dd business-date strings the API uses.
struct DateOnlyPicker: View {
    let label: String
    @Binding var text: String
    private static let formatter: DateFormatter = {
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "Asia/Vientiane"); formatter.dateFormat = "yyyy-MM-dd"; return formatter
    }()
    var body: some View {
        DatePicker(label, selection: Binding(get: { Self.formatter.date(from: text) ?? Date() }, set: { text = businessDateString($0) }), displayedComponents: .date)
            .labelsHidden().datePickerStyle(.field)
            .environment(\.calendar, Calendar(identifier: .gregorian)).environment(\.timeZone, TimeZone(identifier: "Asia/Vientiane")!)
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
/// 1,234,567.25 ₭ — grouped like the web app (the POSIX locale has no grouping separator).
func amountString(_ value: Decimal, currency: Bool = true) -> String {
    let formatter = NumberFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.numberStyle = .decimal
    formatter.usesGroupingSeparator = true; formatter.groupingSeparator = ","; formatter.groupingSize = 3
    formatter.minimumFractionDigits = currency ? 2 : 0; formatter.maximumFractionDigits = currency ? 2 : 6
    return (formatter.string(from: NSDecimalNumber(decimal: value)) ?? "—") + (currency ? " ₭" : "")
}
struct AmountText: View {
    let value: Decimal
    var currency = true
    init(_ value: Decimal, currency: Bool = true) { self.value = value; self.currency = currency }
    var body: some View { Text(amountString(value, currency: currency)).monospacedDigit() }
}
struct MoneyText: View {
    let value: JSONValue
    init(_ value: JSONValue) { self.value = value }
    var body: some View { AmountText(value.decimal) }
}

struct EditorChoice: Identifiable { let id: String; let label: String }
struct EditorField: Identifiable {
    /// `location` edits this field's latitude together with `longitudeKey`, with a map picker.
    enum Kind { case text, multiline, money, integer, decimal, date, choice([EditorChoice]), location(longitudeKey: String) }
    let key: String
    let label: String
    var kind: Kind = .text
    var required = false
    var help = ""
    /// Heading of the card this field starts; later fields stay in it until another section begins.
    var section: String?
    /// Short fields share a row with the next half-width field.
    var isHalf = false
    var id: String { key }
    func inSection(_ title: String) -> EditorField { var copy = self; copy.section = title; return copy }
    func half() -> EditorField { var copy = self; copy.isHalf = true; return copy }
}

/// The shared form sheet: a fixed header and footer, fields grouped into titled cards, short
/// fields two per row, and missing required fields marked where they are.
struct NativeEditor: View {
    let title: String
    let subtitle: String
    let fields: [EditorField]
    let initial: [String: String]
    var saveLabel: String
    /// A live line beside the save button, such as a total, computed from the current values.
    let summary: (([String: String]) -> String?)?
    let onSave: ([String: String]) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var values: [String: String]
    @State private var error: String?
    @State private var missing: Set<String> = []
    @State private var busy = false
    @State private var discard = false
    @State private var picking: EditorField?
    init(title: String, subtitle: String = "", fields: [EditorField], initial: [String: String] = [:], saveLabel: String = "ບັນທຶກ",
         summary: (([String: String]) -> String?)? = nil, onSave: @escaping ([String: String]) async throws -> Void) {
        var prepared = initial
        for field in fields where field.required && (prepared[field.key] ?? "").isEmpty { if case .date = field.kind { prepared[field.key] = businessDateString(Date()) } }
        self.title = title; self.subtitle = subtitle; self.fields = fields; self.initial = prepared; self.saveLabel = saveLabel; self.summary = summary; self.onSave = onSave
        _values = State(initialValue: prepared)
    }
    /// Text editors report an empty string for a key that was never set; that is not an edit.
    private var dirty: Bool { values.filter { !$0.value.isEmpty } != initial.filter { !$0.value.isEmpty } }
    private func binding(_ key: String) -> Binding<String> { Binding(get: { values[key] ?? "" }, set: { values[key] = $0; missing.remove(key) }) }
    private struct Row: Identifiable { let fields: [EditorField]; var id: String { fields.map(\.key).joined(separator: "+") } }
    private struct Group: Identifiable { let title: String?; let rows: [Row]; var id: String { (title ?? "") + (rows.first?.id ?? "") } }
    private var groups: [Group] {
        var groups: [Group] = []
        var title: String? = nil, rows: [Row] = [], pendingHalf: EditorField? = nil
        func closeRow() { if let half = pendingHalf { rows.append(Row(fields: [half])); pendingHalf = nil } }
        func closeGroup() { closeRow(); if !rows.isEmpty { groups.append(Group(title: title, rows: rows)) }; rows = [] }
        for field in fields {
            if let section = field.section, section != title { closeGroup(); title = section }
            if field.isHalf {
                if let half = pendingHalf { rows.append(Row(fields: [half, field])); pendingHalf = nil } else { pendingHalf = field }
            } else { closeRow(); rows.append(Row(fields: [field])) }
        }
        closeGroup()
        return groups
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(Theme.font(22, weight: .bold)).foregroundStyle(Theme.evergreen)
                if !subtitle.isEmpty { Text(subtitle).font(Theme.font(13)).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true) }
            }.padding(.horizontal, 24).padding(.top, 22).padding(.bottom, 16)
            Divider()
            ScrollViewReader { scroller in
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        ForEach(groups) { group in
                            FormCard(group.title) {
                                ForEach(group.rows) { row in
                                    HStack(alignment: .top, spacing: 14) {
                                        ForEach(row.fields) { field in fieldView(field).frame(maxWidth: .infinity, alignment: .leading).id(field.key) }
                                        if row.fields.count == 1 && row.fields[0].isHalf { Color.clear.frame(maxWidth: .infinity, maxHeight: 1) }
                                    }
                                }
                            }
                        }
                    }.padding(20)
                }
                // Bring the first field still to be filled into view when saving is refused.
                .onChange(of: missing) { _, keys in
                    if let first = fields.first(where: { keys.contains($0.key) }) { withAnimation(.easeOut(duration: 0.2)) { scroller.scrollTo(first.key, anchor: .center) } }
                }
            }.textFieldStyle(.roundedBorder).controlSize(.large).disabled(busy)
            Divider()
            VStack(alignment: .leading, spacing: 12) {
                if let error {
                    Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Theme.danger).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                        .padding(10).frame(maxWidth: .infinity, alignment: .leading).background(Theme.danger.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                }
                HStack {
                    Button("ຍົກເລີກ") { if dirty { discard = true } else { dismiss() } }.keyboardShortcut(.cancelAction).disabled(busy)
                    if fields.contains(where: \.required) { Text("* ຈຳເປັນຕ້ອງໃສ່").font(Theme.font(12)).foregroundStyle(Theme.muted).padding(.leading, 8) }
                    Spacer()
                    if let line = summary?(values) { Text(line).font(Theme.font(14, weight: .semibold)).foregroundStyle(Theme.ink).monospacedDigit().padding(.trailing, 6) }
                    if busy { ProgressView().controlSize(.small) }
                    Button(saveLabel) { Task { await save() } }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(busy)
                }.controlSize(.large)
            }.padding(.horizontal, 24).padding(.vertical, 16)
        }
        .frame(width: 640).frame(minHeight: 320, maxHeight: 780).fixedSize(horizontal: false, vertical: true)
        .font(Theme.font()).background(Theme.cream)
        .interactiveDismissDisabled(dirty || busy)
        .confirmationDialog("ຍົກເລີກການແກ້ໄຂ?", isPresented: $discard) {
            Button("ຖິ້ມການແກ້ໄຂ", role: .destructive) { dismiss() }; Button("ກັບໄປແກ້ໄຂ", role: .cancel) {}
        } message: { Text("ຄ່າທີ່ຍັງບໍ່ບັນທຶກຈະຫາຍໄປ") }
        .sheet(item: $picking) { field in
            if case .location(let longitudeKey) = field.kind {
                StoreLocationPicker(latitude: values[field.key] ?? "", longitude: values[longitudeKey] ?? "") { latitude, longitude in
                    values[field.key] = latitude; values[longitudeKey] = longitude
                }
            }
        }
    }
    private func fieldView(_ field: EditorField) -> some View {
        let isMissing = missing.contains(field.key)
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 3) {
                Text(field.label).font(Theme.font(13, weight: .semibold)).foregroundStyle(isMissing ? Theme.danger : Theme.ink)
                if field.required { Text("*").font(Theme.font(13, weight: .bold)).foregroundStyle(Theme.danger).accessibilityHidden(true) }
            }
            control(field).accessibilityLabel(field.label + (field.required ? ", ຈຳເປັນ" : ""))
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(isMissing ? Theme.danger : .clear, lineWidth: 1.5).allowsHitTesting(false))
            if isMissing { Text("ກະລຸນາໃສ່ຂໍ້ມູນນີ້").font(Theme.font(12)).foregroundStyle(Theme.danger) }
            else if !field.help.isEmpty { Text(field.help).font(Theme.font(12)).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true) }
        }
    }
    @ViewBuilder private func control(_ field: EditorField) -> some View {
        switch field.kind {
        case .choice(let options):
            Picker(field.label, selection: binding(field.key)) { Text("ເລືອກ…").tag(""); ForEach(options) { Text($0.label).tag($0.id) } }
                .labelsHidden().pickerStyle(.menu).frame(maxWidth: .infinity, alignment: .leading)
        case .location(let longitudeKey):
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Button { picking = field } label: { Label("ປັກໝຸດໃນແຜນທີ່", systemImage: "mappin.and.ellipse") }.buttonStyle(.borderedProminent)
                    if (values[field.key] ?? "").isEmpty && (values[longitudeKey] ?? "").isEmpty {
                        Label("ຍັງບໍ່ໄດ້ປັກໝຸດ", systemImage: "mappin.slash").font(Theme.font(13)).foregroundStyle(Theme.muted)
                    } else {
                        Label("ປັກໝຸດແລ້ວ", systemImage: "checkmark.circle.fill").font(Theme.font(13, weight: .semibold)).foregroundStyle(Theme.green)
                        Button("ລ້າງ") { values[field.key] = ""; values[longitudeKey] = "" }
                    }
                }
                HStack {
                    TextField("ເສັ້ນຂະໜານ", text: binding(field.key)).accessibilityLabel("ເສັ້ນຂະໜານ")
                    TextField("ເສັ້ນແວງ", text: binding(longitudeKey)).accessibilityLabel("ເສັ້ນແວງ")
                }
            }
        case .multiline:
            TextEditor(text: binding(field.key)).font(Theme.font()).scrollContentBackground(.hidden).padding(6).frame(minHeight: 72)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 6)).overlay(RoundedRectangle(cornerRadius: 6).stroke(Theme.border))
        case .date:
            HStack {
                if field.required || !(values[field.key] ?? "").isEmpty {
                    DateOnlyPicker(label: field.label, text: binding(field.key))
                    if !field.required { Button("ລ້າງວັນທີ") { values[field.key] = "" } }
                } else { Button("ເລືອກວັນທີ…") { values[field.key] = businessDateString(Date()) } }
            }
        default: TextField(field.label, text: binding(field.key)).labelsHidden()
        }
    }
    private func save() async {
        guard !busy else { return }; error = nil
        missing = Set(fields.filter { $0.required && (values[$0.key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }.map(\.key))
        if !missing.isEmpty { error = "ກະລຸນາໃສ່ຂໍ້ມູນໃນຊ່ອງທີ່ໝາຍສີແດງ (\(missing.count) ຊ່ອງ)"; return }
        busy = true; defer { busy = false }
        do { try await onSave(values); dismiss() }
        catch { self.error = error.localizedDescription }
    }
}
