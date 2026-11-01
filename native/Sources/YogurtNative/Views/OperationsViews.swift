import SwiftUI
import MapKit

// Domain views deliberately consume the bounded native projections, never arbitrary model rows.
struct OperationsSection<Content: View>: View {
    let title: String
    let content: Content
    init(title: String, @ViewBuilder content: () -> Content) { self.title = title; self.content = content() }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(Theme.font(18, weight: .semibold)).accessibilityAddTraits(.isHeader)
            content
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct OperationsError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

func operationsPath(_ id: String) -> String {
    id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? id
}

func operationsDate(_ text: String) -> String {
    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let date = iso.date(from: text) ?? ISO8601DateFormatter().date(from: text)
    guard let date else { return text }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "lo_LA")
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.timeZone = TimeZone(identifier: "Asia/Vientiane")
    formatter.dateStyle = .medium; formatter.timeStyle = .short
    return formatter.string(from: date)
}

func operationsStatus(_ status: String) -> String {
    switch status {
    case "waiting": return "ລໍຖ້າ"
    case "preparing": return "ກຳລັງກຽມ"
    case "delivering": return "ກຳລັງສົ່ງ"
    case "completed": return "ສຳເລັດ"
    case "cancelled": return "ຍົກເລີກແລ້ວ"
    case "paid": return "ຊຳລະແລ້ວ"
    case "partial": return "ຊຳລະບາງສ່ວນ"
    case "pending": return "ຄ້າງຊຳລະ"
    case "maintenance": return "ບຳລຸງຮັກສາ"
    case "active": return "ໃຊ້ງານ"
    default: return status
    }
}

func operationsTone(_ status: String) -> StatusTone {
    switch status {
    case "completed", "paid", "active", "delivering": return .success
    case "preparing": return .info
    case "waiting", "partial", "pending", "maintenance": return .warning
    case "cancelled": return .neutral
    default: return .neutral
    }
}

struct OperationsReadActions: View {
    @ObservedObject var state: FeatureState
    var body: some View {
        Button { Task { await state.refresh() } } label: { Label("ໂຫຼດຄືນ", systemImage: "arrow.clockwise") }
            .disabled(state.loading).help("ໂຫຼດຂໍ້ມູນລ່າສຸດ")
    }
}

struct OperationsIssue: View {
    let text: String
    var body: some View {
        Label(text, systemImage: "exclamationmark.triangle")
            .font(Theme.font(13)).foregroundStyle(Theme.danger)
            .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.updatesFrequently)
    }
}

struct StoresView: View {
    @ObservedObject var model: AppModel
    @StateObject private var state = FeatureState()
    @State private var query = ""
    @State private var filter = "all"
    @State private var order = "name"
    @State private var selection: String?
    @State private var create = false
    @State private var detail: JSONValue?
    private var rows: [JSONValue] {
        state.data["stores"].array.filter {
            (query.isEmpty || [$0.text("name"), $0.text("phone"), $0.text("address"), $0["fridge"].text("assetCode")].joined(separator: " ").localizedCaseInsensitiveContains(query)) &&
            (filter == "all" || (filter == "due" && $0["due"].bool) || (filter == "low" && $0["stock"].double <= $0["fridge"]["capacityCups"].double * 0.35) || (filter == "maintenance" && $0["fridge"].text("status") == "maintenance"))
        }.sorted { order == "stock" ? $0["stock"].double < $1["stock"].double : $0.text("name").localizedStandardCompare($1.text("name")) == .orderedAscending }
    }
    var body: some View {
        Workspace(title: "ຮ້ານຄ້າ", subtitle: "ຂໍ້ມູນຮ້ານ, ຕູ້ແຊ່ ແລະວຽກທີ່ຕ້ອງເຮັດ", domain: Destination.stores.domain) {
            OperationsReadActions(state: state)
            if model.session?.role == "admin" {
                Button { create = true } label: { Label("ເພີ່ມຮ້ານ", systemImage: "plus") }
                    .buttonStyle(.borderedProminent).disabled(!model.canWrite || state.source != "database")
            }
        } content: {
            ReadStateView(state: state) {
                VStack(alignment: .leading, spacing: 16) {
                    HStack {
                        TextField("ຄົ້ນຫາຮ້ານ, ເບີໂທ, ລະຫັດຕູ້…", text: $query).textFieldStyle(.roundedBorder)
                        Picker("ຕົວກອງ", selection: $filter) {
                            Text("ທັງໝົດ").tag("all"); Text("ເຖິງຮອບກວດ").tag("due")
                            Text("ສິນຄ້າຕ່ຳ").tag("low"); Text("ຕູ້ບຳລຸງ").tag("maintenance")
                        }.frame(width: 175)
                        Picker("ລຽງຕາມ", selection: $order) { Text("ຊື່ຮ້ານ").tag("name"); Text("ຈຳນວນສິນຄ້າ").tag("stock") }.frame(width: 170)
                    }
                    Text("\(rows.count) ຮ້ານ").foregroundStyle(Theme.muted)
                    if rows.isEmpty {
                        EmptyNotice(title: "ບໍ່ພົບຮ້ານ", detail: "ລອງປ່ຽນຄຳຄົ້ນຫາ ຫຼືຕົວກອງ", symbol: "storefront")
                    } else {
                        Table(rows, selection: $selection) {
                            TableColumn("ຮ້ານ") { row in
                                Button { detail = row } label: {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(row.text("name")).font(Theme.font(14, weight: .semibold))
                                        Text(row.text("address")).font(Theme.font(12)).foregroundStyle(Theme.muted).lineLimit(1)
                                    }
                                }.buttonStyle(.plain).foregroundStyle(Theme.blue)
                            }.width(min: 180, ideal: 270)
                            TableColumn("ຕິດຕໍ່") { row in Text(row.text("phone")) }.width(min: 110, ideal: 130)
                            TableColumn("ຕູ້ແຊ່") { row in Text(row["fridge"].text("assetCode")) }.width(min: 85, ideal: 105)
                            TableColumn("ສິນຄ້າ") { row in Text(row["stock"].text + " / " + row["fridge"]["capacityCups"].text).monospacedDigit() }.width(min: 85, ideal: 100)
                            TableColumn("ຮອບກວດ") { row in StatusLabel(row["due"].bool ? "ເຖິງຮອບ" : "ກວດແລ້ວ", tone: row["due"].bool ? .warning : .success) }.width(min: 100, ideal: 115)
                        }.frame(minHeight: 350).tableSurface()
                        .contextMenu(forSelectionType: String.self) { ids in
                            if let id = ids.first, let row = rows.first(where: { $0.id == id }) { Button("ເປີດຂໍ້ມູນຮ້ານ") { detail = row } }
                        } primaryAction: { ids in
                            if let id = ids.first { detail = rows.first(where: { $0.id == id }) }
                        }
                    }
                }
            }
        }
        .task { await state.load(model, "stores") }
        .sheet(isPresented: $create, onDismiss: { Task { await state.refresh() } }) { OperationsStoreEditor(model: model, store: nil) }
        .sheet(item: $detail, onDismiss: { Task { await state.refresh() } }) { row in StoreDetailView(model: model, storeId: row.id, showsClose: true).frame(minWidth: 880, minHeight: 650) }
    }
}

struct OperationsStoreEditor: View {
    @ObservedObject var model: AppModel
    let store: JSONValue?
    var fields: [EditorField] {
        var result = [
            EditorField(key: "name", label: "ຊື່ຮ້ານ", required: true),
            EditorField(key: "contactName", label: "ຜູ້ຕິດຕໍ່"), EditorField(key: "phone", label: "ເບີໂທ"),
            EditorField(key: "whatsapp", label: "WhatsApp"), EditorField(key: "facebook", label: "Facebook"),
            EditorField(key: "address", label: "ທີ່ຢູ່", kind: .multiline),
            EditorField(key: "latitude", label: "ເສັ້ນຂະໜານ", help: "−90 ຫາ 90"), EditorField(key: "longitude", label: "ເສັ້ນແວງ", help: "−180 ຫາ 180"),
            EditorField(key: "commissionPercent", label: "ສ່ວນແບ່ງຮ້ານ (%)", kind: .money, required: true, help: "0–100%"),
            EditorField(key: "monthlyElectricity", label: "ຄ່າໄຟ/ເດືອນ (LAK)", kind: .money, required: true),
            EditorField(key: "fridgeStartDate", label: "ວັນທີເລີ່ມໃຊ້ຕູ້", kind: .date)
        ]
        if store == nil {
            result += [EditorField(key: "assetCode", label: "ລະຫັດຕູ້ແຊ່", required: true), EditorField(key: "fridgeModel", label: "ຮຸ່ນຕູ້ແຊ່"), EditorField(key: "serialNo", label: "ເລກເຄື່ອງ"), EditorField(key: "capacityCups", label: "ຄວາມຈຸ (ຖ້ວຍ)", kind: .integer, required: true)]
        }
        return result
    }
    var initial: [String: String] {
        guard let store else { return ["commissionPercent": "30", "monthlyElectricity": "200000", "capacityCups": "100", "fridgeModel": "Yogurt Display 100", "fridgeStartDate": businessDateString(Date())] }
        var values = Dictionary(uniqueKeysWithValues: fields.map { ($0.key, store[$0.key].text) })
        values["commissionPercent"] = NSDecimalNumber(decimal: store["commissionRate"].decimal * 100).stringValue
        return values
    }
    var body: some View {
        NativeEditor(title: store == nil ? "ເພີ່ມຮ້ານ ແລະຕູ້ແຊ່" : "ແກ້ໄຂຮ້ານ", fields: fields, initial: initial) { values in
            let percentText = try canonicalDecimal(values["commissionPercent"] ?? "", scale: 2)
            let percent = Decimal(string: percentText) ?? 0
            guard percent <= 100 else { throw OperationsError(message: "ສ່ວນແບ່ງຕ້ອງຢູ່ລະຫວ່າງ 0–100%") }
            var body = values.filter { $0.key != "commissionPercent" }.mapValues(JSONValue.string)
            body["commissionRate"] = .string(NSDecimalNumber(decimal: percent / 100).stringValue)
            body["monthlyElectricity"] = .string(try canonicalDecimal(values["monthlyElectricity"] ?? "", scale: 2))
            for (key, limit) in [("latitude", 90.0), ("longitude", 180.0)] {
                let text = values[key] ?? ""
                if !text.isEmpty { guard let number = Double(text), number.isFinite, abs(number) <= limit else { throw OperationsError(message: "ພິກັດຮ້ານບໍ່ຖືກຕ້ອງ") } }
            }
            if store == nil {
                guard let count = Int(values["capacityCups"] ?? ""), (1...10000).contains(count) else { throw OperationsError(message: "ຄວາມຈຸຕ້ອງເປັນ 1–10000 ຖ້ວຍ") }
                body["capacityCups"] = .number(Decimal(count))
            }
            let path = store.map { "/api/stores/" + operationsPath($0.id) } ?? "/api/stores"
            _ = try await model.mutate(path, body: .object(body), method: store == nil ? "POST" : "PATCH", durable: store == nil)
            model.showNotice("ບັນທຶກຮ້ານແລ້ວ")
        }
    }
}

struct StoreDetailView: View {
    @ObservedObject var model: AppModel
    let storeId: String
    /// A sheet on macOS cannot be dismissed with Escape unless it offers a cancel action.
    var showsClose = false
    @Environment(\.dismiss) private var dismiss
    @StateObject private var state = FeatureState()
    @State private var edit = false
    @State private var archive = false
    @State private var busy = false
    @State private var error: String?
    @State private var audit = false
    @State private var payment = false
    @State private var refill = false
    @State private var receipt: JSONValue?
    private var store: JSONValue { state.data["store"] }
    private var canOperate: Bool { model.canWrite && state.source == "database" && ["admin", "driver"].contains(model.session?.role ?? "") }
    var body: some View {
        Workspace(title: store.text("name").isEmpty ? "ຂໍ້ມູນຮ້ານ" : store.text("name"), subtitle: store.text("address"), domain: Destination.stores.domain) {
            if showsClose { Button("ປິດ") { dismiss() }.keyboardShortcut(.cancelAction) }
            OperationsReadActions(state: state)
            if model.session?.role == "admin" { Button("ແກ້ໄຂ") { edit = true }.disabled(!canOperate || store.id.isEmpty) }
        } content: {
            ReadStateView(state: state) {
                VStack(alignment: .leading, spacing: 24) {
                        if let error { OperationsIssue(text: error) }
                        if !store["isActive"].bool { StatusLabel("ຮ້ານປິດໃຊ້ແລ້ວ", tone: .warning) }
                        HStack(spacing: 12) {
                            if ["admin", "driver"].contains(model.session?.role ?? "") {
                                Button("ກວດຮ້ານ / ປິດຮອບ") { audit = true }.buttonStyle(.borderedProminent).disabled(!canOperate || store["fridge"] == .null || !store["isActive"].bool)
                                Button("ສ້າງຄຳຂໍເຕີມ") { refill = true }.disabled(!canOperate || store["fridge"] == .null || !store["isActive"].bool)
                                Button("ຮັບເງິນຄ້າງ") { payment = true }.disabled(!canOperate || state.data["latestBalance"].decimal <= 0)
                            }
                            Button("ເບິ່ງແຜນທີ່") { model.navigate(.map, storeId: storeId) }
                        }
                        HStack(alignment: .top, spacing: 32) {
                            OperationsSection(title: "ຂໍ້ມູນຕິດຕໍ່") {
                                LabeledContent("ຜູ້ຕິດຕໍ່", value: store.text("contactName"))
                                LabeledContent("ເບີໂທ", value: store.text("phone"))
                                LabeledContent("WhatsApp", value: store.text("whatsapp"))
                                LabeledContent("Facebook", value: store.text("facebook"))
                            }
                            OperationsSection(title: "ຕູ້ແຊ່ ແລະບັນຊີ") {
                                LabeledContent("ລະຫັດຕູ້", value: store["fridge"].text("assetCode"))
                                LabeledContent("ສະຖານະ") { StatusLabel(operationsStatus(store["fridge"].text("status")), tone: operationsTone(store["fridge"].text("status"))) }
                                LabeledContent("ສ່ວນແບ່ງຮ້ານ") { Text(NSDecimalNumber(decimal: store["commissionRate"].decimal * 100).stringValue + "%") }
                                LabeledContent("ຄ່າໄຟ/ເດືອນ") { MoneyText(store["monthlyElectricity"]) }
                                LabeledContent("ຍອດຄ້າງລ່າສຸດ") { MoneyText(state.data["latestBalance"]) }
                            }
                        }.textSelection(.enabled)
                        Divider()
                        OperationsSection(title: "ສິນຄ້າໃນຕູ້") {
                            if state.data["inventory"].array.isEmpty { EmptyNotice(title: "ບໍ່ມີສິນຄ້າໃນຕູ້") }
                            ForEach(state.data["inventory"].array) { row in
                                HStack { Text(row["product"].text("name")); Spacer(); Text(row["currentStock"].text + " ຖ້ວຍ").monospacedDigit() }
                            }
                        }
                        OperationsSection(title: "ຄຳຂໍເຕີມສິນຄ້າ") {
                            if state.data["refills"].array.isEmpty { Text("ບໍ່ມີຄຳຂໍ").foregroundStyle(Theme.muted) }
                            ForEach(state.data["refills"].array) { row in HStack { Text(operationsDate(row.text("requestedAt"))); Spacer(); StatusLabel(operationsStatus(row.text("status")), tone: operationsTone(row.text("status"))) } }
                            Button("ໄປລາຍການເຕີມ") { model.navigate(.refills, storeId: storeId) }
                        }
                        if model.session?.role == "production" {
                            if state.data["latestSettlement"] != .null {
                                OperationsSection(title: "ການຮັບເງິນລ່າສຸດ") {
                                    LabeledContent("ວັນທີ", value: operationsDate(state.data["latestSettlement"].text("settlementDate")))
                                    LabeledContent("ຮັບແລ້ວ") { MoneyText(state.data["latestSettlement"]["paidAmount"]) }
                                    LabeledContent("ຄົງຄ້າງ") { MoneyText(state.data["latestSettlement"]["closingBalance"]) }
                                }
                            }
                        } else {
                            OperationsSection(title: "ປະຫວັດການຮັບເງິນ") {
                                if state.data["settlements"].array.isEmpty { Text("ບໍ່ມີລາຍການ").foregroundStyle(Theme.muted) }
                                ForEach(state.data["settlements"].array) { row in
                                    HStack { Button(row.text("receiptNumber").isEmpty ? row.id : row.text("receiptNumber")) { receipt = row }; Text(operationsDate(row.text("settlementDate"))); Spacer(); MoneyText(row["paidAmount"]); StatusLabel(operationsStatus(row.text("paymentStatus")), tone: operationsTone(row.text("paymentStatus"))) }
                                }
                                Button("ປະຫວັດທັງໝົດ") { model.navigate(.settlements, storeId: storeId) }
                            }
                        }
                        OperationsSection(title: "ປະຫວັດກວດຮ້ານ") {
                            if state.data["visits"].array.isEmpty { Text("ບໍ່ມີຮອບກວດ").foregroundStyle(Theme.muted) }
                            ForEach(state.data["visits"].array) { row in HStack { Text(operationsDate(row.text("visitDate"))); Spacer(); StatusLabel(operationsStatus(row.text("status")), tone: operationsTone(row.text("status"))) } }
                        }
                        if model.session?.role == "admin" && store["isActive"].bool {
                            Divider()
                            Button("ປິດການໃຊ້ງານຮ້ານ", role: .destructive) { archive = true }.disabled(!canOperate || busy)
                        }
                }.padding(.vertical, 8)
            }
        }
        .task(id: storeId) { await state.load(model, "store", query: ["id": storeId]) }
        .sheet(isPresented: $edit, onDismiss: { Task { await state.refresh() } }) { OperationsStoreEditor(model: model, store: store) }
        .sheet(isPresented: $refill, onDismiss: { Task { await state.refresh() } }) { OperationsRefillEditor(model: model, storeId: storeId) }
        .sheet(isPresented: $audit, onDismiss: { Task { await state.refresh() } }) { OperationsAuditView(model: model, storeId: storeId, paymentOnly: false) }
        .sheet(isPresented: $payment, onDismiss: { Task { await state.refresh() } }) { OperationsAuditView(model: model, storeId: storeId, paymentOnly: true) }
        .sheet(item: $receipt) { row in OperationsReceiptView(model: model, row: row, storeName: store.text("name")) }
        .confirmationDialog("ປິດການໃຊ້ງານ “\(store.text("name"))” ?", isPresented: $archive, titleVisibility: .visible) {
            Button("ປິດການໃຊ້ງານ", role: .destructive) { Task { await deactivate() } }
            Button("ຍົກເລີກ", role: .cancel) {}
        } message: { Text("ປະຫວັດຈະຍັງຢູ່. ຕ້ອງຈັດການຄຳຂໍເຕີມ, ສິນຄ້າໃນຕູ້ ແລະຍອດຄ້າງໃຫ້ຄົບກ່ອນ.") }
    }
    private func deactivate() async {
        busy = true; error = nil
        do {
            _ = try await model.mutate("/api/stores/" + operationsPath(storeId), body: .object([:]), method: "DELETE", durable: false)
            await state.refresh(); model.showNotice("ປິດການໃຊ້ງານຮ້ານແລ້ວ")
        } catch { self.error = error.localizedDescription; await state.refresh() }
        busy = false
    }
}
