import SwiftUI
import UniformTypeIdentifiers

// Domain views keep server snapshots intact. Decimal arithmetic here is an estimate;
// the existing transactional endpoints remain authoritative for stock and money.
private func mgBody(_ values: [String: String]) -> JSONValue {
    .object(values.mapValues(JSONValue.string))
}
// A metadata edit must never restore a cost/price changed by a concurrent receipt.
func mgEditPatch(original: JSONValue, values: [String: JSONValue], numeric: Set<String>, nullable: Set<String> = []) -> [String: JSONValue] {
    var patch: [String: JSONValue] = [:]
    for (key, value) in values {
        let next = value.text.trimmingCharacters(in: .whitespacesAndNewlines)
        let previous = original.text(key).trimmingCharacters(in: .whitespacesAndNewlines)
        if numeric.contains(key), let left = Decimal(string: next), let right = Decimal(string: previous), left == right { continue }
        if !numeric.contains(key), next == previous { continue }
        patch[key] = nullable.contains(key) && next.isEmpty ? .null : value
    }
    return patch
}

private func mgChoices(_ rows: [JSONValue], label: String = "name") -> [EditorChoice] {
    rows.map { EditorChoice(id: $0.text("id"), label: $0.text(label)) }
}
private func mgIdentified(_ rows: [JSONValue], key: String) -> [JSONValue] {
    rows.map { row in var object = row.object; object["id"] = row[key]; return .object(object) }
}
private func mgDecimalText(_ value: Decimal) -> String { NSDecimalNumber(decimal: value).stringValue }
private func mgContains(_ row: JSONValue, _ query: String, keys: [String]) -> Bool {
    query.isEmpty || keys.contains { row.text($0).localizedCaseInsensitiveContains(query) }
}
private func mgError(_ text: String) -> NSError {
    NSError(domain: "YogurtManagement", code: 1, userInfo: [NSLocalizedDescriptionKey: text])
}
private func mgPositiveInteger(_ text: String, maximum: Int = 100000) throws -> Int {
    guard let n = Int(text), n > 0, n <= maximum else {
        throw mgError("ກະລຸນາໃສ່ຈຳນວນເຕັມ 1–\(maximum)")
    }
    return n
}
private struct ManagementPanel<Content: View>: View {
    let title: String
    let color: Color
    @ViewBuilder let content: Content
    init(_ title: String, color: Color = Theme.blue, @ViewBuilder content: () -> Content) {
        self.title = title; self.color = color; self.content = content()
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(title).font(Theme.font(19, weight: .bold)).foregroundStyle(color)
            content
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border))
    }
}
private struct ManagementMetric: View {
    let title: String
    let value: JSONValue
    var currency = true
    var color: Color = Theme.ink
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(Theme.font(12)).foregroundStyle(Theme.muted)
            AmountText(value.decimal, currency: currency).font(Theme.font(20, weight: .semibold)).foregroundStyle(color)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}
private struct ManagementPagination: View {
    let page: Int
    let pages: Int
    let change: (Int) -> Void
    var body: some View {
        HStack {
            Text("ໜ້າ \(page) / \(max(1, pages))").foregroundStyle(Theme.muted)
            Spacer()
            Button("ກ່ອນໜ້າ") { change(page - 1) }.disabled(page <= 1)
            Button("ຖັດໄປ") { change(page + 1) }.disabled(page >= pages)
        }.controlSize(.large)
    }
}
private struct ManagementFeedback: View {
    let error: String?
    let success: String?
    var body: some View {
        if let error { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(Theme.danger).textSelection(.enabled) }
        if let success { Label(success, systemImage: "checkmark.circle").foregroundStyle(Theme.green).textSelection(.enabled) }
    }
}

struct InventoryView: View {
    @ObservedObject var model: AppModel
    @StateObject private var state = FeatureState()
    @State private var query = ""
    @State private var category = "all"
    @State private var stockFilter = "all"
    @State private var order = "attention"
    @State private var selection: String?
    @State private var editor: String?
    @State private var selected: JSONValue?
    @FocusState private var searchFocused: Bool
    private var materials: [JSONValue] { state.data["materials"].array }
    private var matching: [JSONValue] { inventoryRows(materials, query: query, category: category, status: "all", order: order) }
    private var rows: [JSONValue] { inventoryRows(materials, query: query, category: category, status: stockFilter, order: order) }
    private var selectedMaterial: JSONValue? { rows.first { $0.id == selection } }
    private var lowCount: Int { matching.filter { InventoryStockState($0) != .available }.count }
    private var writable: Bool { model.canWrite && state.source == "database" }
    var body: some View {
        Workspace(title: "ວັດຖຸດິບ", subtitle: "ກວດສະຕັອກ ແລະເລືອກລາຍການເພື່ອຮັບເຂົ້າ ຫຼືປັບຈຳນວນ", domain: .inventory, scrollsContent: false) {
            Button { Task { await state.refresh() } } label: { Label("ໂຫຼດຄືນ", systemImage: "arrow.clockwise") }
                .disabled(state.loading).keyboardShortcut("r", modifiers: .command)
            Button("CSV", systemImage: "square.and.arrow.up") { export() }.disabled(rows.isEmpty).help("ສົ່ງອອກລາຍການທີ່ສະແດງ")
            Button("ຮັບວັດຖຸດິບ", systemImage: "plus") { openEditor("receive", row: selectedMaterial) }
                .buttonStyle(.borderedProminent).tint(Theme.green).disabled(!writable || materials.isEmpty)
        } content: {
            ReadStateView(state: state, showsFreshness: false, fillsHeight: true) {
                VStack(alignment: .leading, spacing: 12) {
                    filters
                    VStack(spacing: 0) {
                        if rows.isEmpty { emptyState.frame(maxWidth: .infinity, maxHeight: .infinity) }
                        else { materialTable }
                        Divider()
                        selectionActions
                    }
                    .frame(maxWidth: .infinity, minHeight: 0, maxHeight: .infinity)
                    .background(Theme.surface).tableSurface()
                    HStack(spacing: 12) {
                        Text("ສະແດງ \(rows.count) ຈາກ \(materials.count) ລາຍການ")
                        Spacer()
                        if !state.generatedAt.isEmpty { Text("ອັບເດດ \(operationsDate(state.generatedAt))") }
                    }.font(Theme.font(11)).foregroundStyle(Theme.muted)
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task { await state.load(model, "inventory") }
        .onChange(of: rows.map(\.id)) { _, ids in if let selection, !ids.contains(selection) { self.selection = nil } }
        .sheet(isPresented: Binding(get: { editor != nil }, set: { if !$0 { editor = nil; selected = nil } })) { inventoryEditor }
        .background { Button("") { searchFocused = true }.keyboardShortcut("f", modifiers: .command).hidden().accessibilityHidden(true) }
    }
    private var filters: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 16) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").foregroundStyle(Theme.muted).accessibilityHidden(true)
                    TextField("ຄົ້ນຫາຊື່, ລະຫັດ ຫຼືໜ່ວຍ…", text: $query).textFieldStyle(.plain).focused($searchFocused)
                        .accessibilityLabel("ຄົ້ນຫາວັດຖຸດິບ")
                    if !query.isEmpty {
                        Button { query = ""; searchFocused = true } label: { Image(systemName: "xmark.circle.fill") }
                            .buttonStyle(.plain).foregroundStyle(Theme.muted).accessibilityLabel("ລ້າງຄຳຄົ້ນຫາ")
                    }
                }.padding(.horizontal, 12).frame(minWidth: 190, minHeight: 40).background(Theme.surface, in: RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(searchFocused ? Theme.purple : Theme.border, lineWidth: searchFocused ? 2 : 1))
                Picker("ປະເພດ", selection: $category) {
                    Text("ທັງໝົດ").tag("all"); Text("ສ່ວນປະກອບ").tag("ingredient"); Text("ບັນຈຸພັນ").tag("packaging")
                }.frame(width: 210)
                Picker("ລຽງ", selection: $order) {
                    Text("ຕ້ອງເຕີມກ່ອນ").tag("attention"); Text("ຊື່ວັດຖຸດິບ").tag("name")
                }.frame(width: 185)
            }
            Picker("ສະຖານະສະຕັອກ", selection: $stockFilter) {
                Text("ທັງໝົດ (\(matching.count))").tag("all")
                Text("ຕ້ອງເຕີມ (\(lowCount))").tag("low")
                Text("ພຽງພໍ (\(matching.count - lowCount))").tag("available")
            }.pickerStyle(.segmented).labelsHidden().frame(maxWidth: 480)
        }
    }
    private var materialTable: some View {
        Table(rows, selection: $selection) {
            TableColumn("ວັດຖຸດິບ") { row in
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.text("name")).font(Theme.font(14, weight: .semibold)).lineLimit(1).help(row.text("name"))
                    Text(row.text("code")).font(Theme.font(11)).foregroundStyle(rowStyle(row, normal: Theme.muted))
                }.padding(.vertical, 4)
            }.width(min: 180, ideal: 280)
            TableColumn("ປະເພດ") { row in Text(row.text("category") == "packaging" ? "ບັນຈຸພັນ" : "ສ່ວນປະກອບ").font(Theme.font(12)).foregroundStyle(rowStyle(row, normal: Theme.muted)) }.width(min: 100, ideal: 115)
            TableColumn("ຄົງເຫຼືອ") { row in
                Text(amountString(row["stock"].decimal, currency: false) + " " + row.text("unit"))
                    .font(Theme.font(14, weight: .semibold)).monospacedDigit()
                    .foregroundStyle(rowStyle(row, normal: InventoryStockState(row) == .empty ? Theme.danger : Theme.ink))
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }.width(min: 100, ideal: 120)
            TableColumn("ຈຸດເຕືອນ") { row in Text(amountString(row["minStock"].decimal, currency: false) + " " + row.text("unit")).monospacedDigit().foregroundStyle(rowStyle(row, normal: Theme.muted)).frame(maxWidth: .infinity, alignment: .trailing) }.width(min: 95, ideal: 110)
            TableColumn("ຕົ້ນທຶນ / ໜ່ວຍ") { row in MoneyText(row["avgCost"]).frame(maxWidth: .infinity, alignment: .trailing) }.width(min: 120, ideal: 145)
            TableColumn("ສະຖານະ") { row in stockStatus(row) }.width(min: 90, ideal: 110)
        }
        .frame(maxWidth: .infinity, minHeight: 0, maxHeight: .infinity)
        .contextMenu(forSelectionType: String.self) { ids in
            if let row = rows.first(where: { ids.contains($0.id) }) {
                Button("ຮັບເຂົ້າລາຍການນີ້", systemImage: "plus") { openEditor("receive", row: row) }.disabled(!writable)
                Button("ປັບຈຳນວນ", systemImage: "plusminus") { openEditor("adjust", row: row) }.disabled(!writable)
                Button("ແກ້ໄຂ / ກວດນັບ", systemImage: "square.and.pencil") { openEditor("edit", row: row) }.disabled(!writable)
            }
        } primaryAction: { ids in
            if let row = rows.first(where: { ids.contains($0.id) }), writable { openEditor("edit", row: row) }
        }
    }
    private func stockStatus(_ row: JSONValue) -> some View {
        let status = InventoryStockState(row)
        return Label(status == .empty ? "ໝົດ" : status == .low ? "ໃກ້ໝົດ" : "ພຽງພໍ", systemImage: status == .empty ? "exclamationmark.circle" : status == .low ? "exclamationmark.triangle" : "checkmark.circle")
            .font(Theme.font(12, weight: .medium)).foregroundStyle(rowStyle(row, normal: status == .empty ? Theme.danger : status == .low ? Theme.mango : Theme.green))
    }
    private func rowStyle(_ row: JSONValue, normal: Color) -> AnyShapeStyle {
        selection == row.id ? AnyShapeStyle(.primary) : AnyShapeStyle(normal)
    }
    private var selectionActions: some View {
        HStack(spacing: 12) {
            if let row = selectedMaterial {
                Text(row.text("name")).font(Theme.font(13, weight: .semibold)).lineLimit(1)
                Spacer(minLength: 8)
                Button("ຮັບເຂົ້າ", systemImage: "plus") { openEditor("receive", row: row) }.disabled(!writable)
                Button("ປັບຈຳນວນ", systemImage: "plusminus") { openEditor("adjust", row: row) }.disabled(!writable)
                Button("ແກ້ໄຂ / ກວດນັບ", systemImage: "square.and.pencil") { openEditor("edit", row: row) }.disabled(!writable)
            } else {
                Label("ເລືອກວັດຖຸດິບໃນຕາຕະລາງ ເພື່ອຮັບເຂົ້າ, ປັບຈຳນວນ ຫຼືແກ້ໄຂ", systemImage: "cursorarrow.click")
                    .font(Theme.font(12)).foregroundStyle(Theme.muted)
                Spacer(minLength: 0)
            }
        }.padding(.horizontal, 16).frame(minHeight: 56).background(Theme.surfaceSoft)
    }
    private var emptyState: some View {
        VStack(spacing: 12) {
            EmptyNotice(title: materials.isEmpty ? "ຍັງບໍ່ມີວັດຖຸດິບ" : "ບໍ່ພົບລາຍການທີ່ກົງກັນ", detail: materials.isEmpty ? "ເພີ່ມວັດຖຸດິບຈາກໜ້າຈັດການລະບົບ" : "ລອງປ່ຽນຄຳຄົ້ນຫາ, ປະເພດ ຫຼືສະຖານະສະຕັອກ", symbol: "archivebox")
            if !materials.isEmpty { Button("ສະແດງວັດຖຸດິບທັງໝົດ") { query = ""; category = "all"; stockFilter = "all" } }
        }
    }
    private func openEditor(_ action: String, row: JSONValue?) {
        guard writable else { return }
        selected = action == "edit" ? row.map(rawMaterial) : row
        editor = action
    }
    private func rawMaterial(_ row: JSONValue) -> JSONValue {
        state.data["rawMaterials"].array.first { $0.id == row.id } ?? row
    }
    @ViewBuilder private var inventoryEditor: some View {
        if editor == "receive" {
            NativeEditor(title: "ຮັບວັດຖຸດິບເຂົ້າສາງ", subtitle: "ສະຕັອກຈະເພີ່ມຂຶ້ນ ແລະຕົ້ນທຶນສະເລ່ຍຈະຄິດໄລ່ໃໝ່ຕາມລາຄາທີ່ຊື້.", fields: [
                EditorField(key: "rawMaterialId", label: "ວັດຖຸດິບ", kind: .choice(mgChoices(materials)), required: true),
                EditorField(key: "quantity", label: "ຈຳນວນທີ່ຮັບ", kind: .decimal, required: true, help: "ຕາມໜ່ວຍຂອງວັດຖຸດິບ").half(),
                EditorField(key: "unitPrice", label: "ລາຄາຕໍ່ໜ່ວຍ (LAK)", kind: .decimal, required: true).half(),
                EditorField(key: "supplierName", label: "ຜູ້ສະໜອງ", required: true).half(),
                EditorField(key: "purchaseDate", label: "ວັນທີຊື້", kind: .date, required: true).half(),
                EditorField(key: "note", label: "ໝາຍເຫດ", kind: .multiline)
            ], initial: ["purchaseDate": businessDateString(Date()), "rawMaterialId": selected?.id ?? ""], saveLabel: "ຮັບເຂົ້າສາງ", summary: { values in
                guard let quantity = Decimal(string: values["quantity", default: ""]), let price = Decimal(string: values["unitPrice", default: ""]), quantity > 0, price >= 0 else { return nil }
                return "ລວມ " + amountString(quantity * price)
            }) { values in
                var body = values
                body["quantity"] = try canonicalDecimal(values["quantity"] ?? "", scale: 6)
                body["unitPrice"] = try canonicalDecimal(values["unitPrice"] ?? "", scale: 4)
                let result = try await model.mutate("/api/inventory/receive", body: mgBody(body))
                model.showNotice("ຮັບເຂົ້າແລ້ວ · \(result.text("materialName")) · ຄົງເຫຼືອ \(result.text("newStock"))")
                await state.refresh()
            }
        } else if editor == "adjust", let row = selected {
            NativeEditor(title: "ປັບຈຳນວນ · \(row.text("name"))", subtitle: "ຄົງເຫຼືອຕອນນີ້ \(row.text("stock")) \(row.text("unit")). ໃສ່ຄ່າບວກເພື່ອເພີ່ມ ຫຼືຄ່າລົບເພື່ອຫັກອອກ.", fields: [
                EditorField(key: "quantityDelta", label: "ຈຳນວນປັບ (+ / −)", kind: .decimal, required: true, help: "ຕົວຢ່າງ: −2.5").half(),
                EditorField(key: "reason", label: "ເຫດຜົນ", kind: .choice([EditorChoice(id: "manual_correction", label: "ແກ້ຈຳນວນ"), EditorChoice(id: "damaged", label: "ເສຍຫາຍ"), EditorChoice(id: "expired", label: "ໝົດອາຍຸ"), EditorChoice(id: "other", label: "ອື່ນໆ")]), required: true).half(),
                EditorField(key: "note", label: "ລາຍລະອຽດ", kind: .multiline, required: true)
            ], saveLabel: "ບັນທຶກການປັບ") { values in
                var body = values; body["rawMaterialId"] = row.id
                body["quantityDelta"] = try canonicalDecimal(values["quantityDelta"] ?? "", scale: 6, allowNegative: true)
                let result = try await model.mutate("/api/inventory/adjust", body: mgBody(body))
                model.showNotice("ປັບແລ້ວ · \(result.text("before")) → \(result.text("after")) \(row.text("unit"))")
                await state.refresh()
            }
        } else if let row = selected {
            let stock = row.text("currentStock").isEmpty ? row.text("stock") : row.text("currentStock")
            let cost = row.text("avgCostPerUnit").isEmpty ? row.text("avgCost") : row.text("avgCostPerUnit")
            let minimum = row.text("minStockAlert").isEmpty ? row.text("minStock") : row.text("minStockAlert")
            NativeEditor(title: "ແກ້ໄຂ · \(row.text("name"))", subtitle: "ໃຊ້ເມື່ອນັບສະຕັອກຈິງແລ້ວບໍ່ກົງ ຫຼືຕ້ອງແກ້ຕົ້ນທຶນ / ຈຸດແຈ້ງເຕືອນ.", fields: [
                EditorField(key: "name", label: "ຊື່ວັດຖຸດິບ", required: true),
                EditorField(key: "stock", label: "ຈຳນວນທີ່ນັບໄດ້ (\(row.text("unit")))", kind: .decimal, required: true).half(),
                EditorField(key: "minStock", label: "ຈຸດແຈ້ງເຕືອນ", kind: .decimal, required: true, help: "ແຈ້ງເຕືອນເມື່ອຕ່ຳກວ່ານີ້").half(),
                EditorField(key: "avgCostPerUnit", label: "ຕົ້ນທຶນ / ໜ່ວຍ (LAK)", kind: .decimal, required: true).half(),
                EditorField(key: "stockReason", label: "ເຫດຜົນປ່ຽນຈຳນວນ", kind: .multiline, help: "ຕ້ອງໃສ່ເມື່ອຈຳນວນທີ່ນັບໄດ້ປ່ຽນ")
            ], initial: ["name": row.text("name"), "stock": stock, "minStock": minimum, "avgCostPerUnit": cost]) { values in
                let normalized: [String: JSONValue] = [
                    "name": .string(values["name", default: ""].trimmingCharacters(in: .whitespacesAndNewlines)),
                    "stock": .string(try canonicalDecimal(values["stock", default: ""], scale: 6)),
                    "minStock": .string(try canonicalDecimal(values["minStock", default: ""], scale: 3)),
                    "avgCostPerUnit": .string(try canonicalDecimal(values["avgCostPerUnit", default: ""], scale: 4))
                ]
                let original = JSONValue.object(["name": row["name"], "stock": .string(stock), "minStock": .string(minimum), "avgCostPerUnit": .string(cost)])
                var body = mgEditPatch(original: original, values: normalized, numeric: ["stock", "minStock", "avgCostPerUnit"])
                guard !body.isEmpty else { model.showNotice("ບໍ່ມີຄ່າທີ່ປ່ຽນ"); return }
                if body["stock"] != nil {
                    let reason = values["stockReason", default: ""].trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !reason.isEmpty else { throw mgError("ກະລຸນາໃສ່ເຫດຜົນປ່ຽນຈຳນວນ") }
                    body["expectedStock"] = .string(stock); body["stockReason"] = .string(reason)
                }
                body["action"] = .string("update_material"); body["rawMaterialId"] = .string(row.id)
                _ = try await model.mutate("/api/inventory/adjust", body: .object(body))
                model.showNotice("ບັນທຶກວັດຖຸດິບແລ້ວ"); await state.refresh()
            }
        }
    }
    private func export() {
        model.exportCSV(name: "inventory", headers: ["ລະຫັດ", "ວັດຖຸດິບ", "ໜ່ວຍ", "ຄົງເຫຼືອ", "ຈຸດເຕືອນ", "ຕົ້ນທຶນ"], rows: rows.map { row in ["code", "name", "unit", "stock", "minStock", "avgCost"].map { row.text($0) } })
    }
}

private struct ManagementSheet<Content: View>: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    let dirty: Bool
    let busy: Bool
    @ViewBuilder let content: Content
    @State private var confirmDiscard = false
    init(_ title: String, dirty: Bool, busy: Bool, @ViewBuilder content: () -> Content) {
        self.title = title; self.dirty = dirty; self.busy = busy; self.content = content()
    }
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(title).font(Theme.font(22, weight: .bold)).foregroundStyle(Theme.evergreen); Spacer()
                if busy { ProgressView().controlSize(.small).accessibilityLabel("ກຳລັງດຳເນີນການ") }
                Button("ປິດ") { if dirty { confirmDiscard = true } else { dismiss() } }.disabled(busy).keyboardShortcut(.cancelAction)
            }.padding(.horizontal, 24).padding(.top, 22).padding(.bottom, 16)
            Divider()
            // Labels above controls and one control height, as in the shared form.
            ScrollView { content.padding(20).labeledContentStyle(StackedLabeledContentStyle()).textFieldStyle(.roundedBorder).controlSize(.large) }
        }
        .frame(minWidth: 680, idealWidth: 760, minHeight: 520, idealHeight: 760)
        .font(Theme.font()).background(Theme.cream)
        .interactiveDismissDisabled(dirty || busy)
        .confirmationDialog("ປິດແບບຟອມທີ່ຍັງບໍ່ບັນທຶກ?", isPresented: $confirmDiscard, titleVisibility: .visible) {
            Button("ປິດແບບຟອມ", role: .destructive) { dismiss() }
            Button("ສືບຕໍ່ແກ້ໄຂ", role: .cancel) { }
        } message: { Text("ຮ່າງນີ້ຍັງບໍ່ມີຜົນຢືນຢັນການບັນທຶກ. ກວດລາຍການຄ້າງສົ່ງກ່ອນເຮັດລາຍການໃໝ່.") }
    }
}

struct ProductionView: View {
    @ObservedObject var model: AppModel
    @StateObject private var state = FeatureState()
    @State private var history = false
    @State private var page = 1
    @State private var query = ""
    @State private var planner = false
    @State private var waste = false
    private var batches: [JSONValue] { state.data["batches"].array.filter { mgContains($0, query, keys: ["batchNumber", "productName"]) } }
    private var writable: Bool { model.canWrite && state.source == "database" }
    var body: some View {
        Workspace(title: "ການຜະລິດ", subtitle: "ວາງແຜນວັດຖຸດິບ, ສ້າງລັອດ ແລະກວດອາຍຸສິນຄ້າ", domain: .refills) {
            Button("ບັນທຶກຂອງເສຍ", systemImage: "minus.circle") { waste = true }.disabled(!writable || state.data["adjustmentBatches"].array.isEmpty)
            Button("ວາງແຜນຜະລິດ", systemImage: "plus") { planner = true }.buttonStyle(.borderedProminent).disabled(!writable)
        } content: {
            ReadStateView(state: state) {
                HStack(spacing: 16) {
                    ManagementMetric(title: "ສະຕັອກກາງ", value: state.data["centralStockTotal"], currency: false, color: Theme.green)
                    ForEach(state.data["products"].array) { product in ManagementMetric(title: product.text("name"), value: product["centralStock"], currency: false) }
                }.padding(16).background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                HStack {
                    Picker("ລັອດ", selection: $history) { Text("ຍັງມີສິນຄ້າ").tag(false); Text("ປະຫວັດທັງໝົດ").tag(true) }.pickerStyle(.segmented).frame(width: 300)
                    TextField("ຄົ້ນຫາລັອດ / ສິນຄ້າ", text: $query).textFieldStyle(.roundedBorder)
                    Button("CSV") { export() }.disabled(batches.isEmpty)
                    Button("ໂຫຼດຄືນ", systemImage: "arrow.clockwise") { Task { await reload() } }
                }.controlSize(.large)
                if batches.isEmpty { EmptyNotice(title: history ? "ຍັງບໍ່ມີປະຫວັດລັອດ" : "ບໍ່ມີລັອດຄົງເຫຼືອ", detail: "ເປີດວາງແຜນຜະລິດເພື່ອກວດສູດ ແລະວັດຖຸດິບ", symbol: "cup.and.saucer") }
                else {
                    Table(batches) {
                        TableColumn("ລັອດ / ສິນຄ້າ") { row in VStack(alignment: .leading) { Text(row.text("batchNumber")); Text(row.text("productName")).foregroundStyle(Theme.muted) } }.width(min: 200)
                        TableColumn("ຜະລິດ / ເຫຼືອ") { row in Text("\(row.text("quantityProduced")) / \(row.text("quantityRemaining"))").monospacedDigit() }
                        TableColumn("ວັນຜະລິດ") { Text($0.text("mfgDate")) }
                        TableColumn("ໝົດອາຍຸ") { row in VStack(alignment: .leading) { Text(row.text("expDate")); if row["daysToExpiry"].decimal < 0 { StatusLabel("ໝົດອາຍຸ", tone: .danger) } else if row["daysToExpiry"].decimal <= 7 { StatusLabel("ໃກ້ໝົດອາຍຸ", tone: .warning) } } }
                        TableColumn("ຕົ້ນທຶນ / ຖ້ວຍ") { row in VStack(alignment: .leading) { MoneyText(row["unitCost"]); if !row["costKnown"].bool { Text("ບໍ່ຮູ້ຕົ້ນທຶນ").font(Theme.font(12)).foregroundStyle(Theme.muted) } } }
                    }.frame(minHeight: 320).tableSurface()
                }
                if history { ManagementPagination(page: page, pages: max(1, Int(state.data["pageCount"].double))) { page = $0; Task { await reload() } } }
            }
        }
        .task { await reload() }
        .onChange(of: history) { _, _ in page = 1; Task { await reload() } }
        .sheet(isPresented: $planner) { ProductionPlannerSheet(model: model, data: state.data) { await state.refresh() } }
        .sheet(isPresented: $waste) {
            let available = state.data["adjustmentBatches"].array.filter { $0["quantityRemaining"].decimal > 0 }
            NativeEditor(title: "ຫັກຂອງເສຍຈາກສາງກາງ", subtitle: "ສິນຄ້າຄົງເຫຼືອຈະຫຼຸດລົງ ແລະຕົ້ນທຶນຂອງເສຍຈະຖືກບັນທຶກໃນລາຍງານ.", fields: [
                EditorField(key: "batchId", label: "ລັອດຜະລິດ", kind: .choice(available.map { EditorChoice(id: $0.id, label: "\($0.text("batchNumber")) · \($0.text("productName")) · ເຫຼືອ \($0.text("quantityRemaining"))") }), required: true),
                EditorField(key: "quantity", label: "ຈຳນວນຫັກ (ຖ້ວຍ)", kind: .integer, required: true).half(),
                EditorField(key: "reason", label: "ເຫດຜົນ", kind: .choice([EditorChoice(id: "expired", label: "ໝົດອາຍຸ"), EditorChoice(id: "damaged", label: "ເສຍຫາຍ"), EditorChoice(id: "sample", label: "ຕົວຢ່າງ"), EditorChoice(id: "other", label: "ອື່ນໆ")]), required: true).half(),
                EditorField(key: "note", label: "ໝາຍເຫດ", kind: .multiline)
            ], saveLabel: "ຢືນຢັນຫັກສິນຄ້າ") { values in
                let count = try mgPositiveInteger(values["quantity"] ?? "")
                guard let batch = available.first(where: { $0.id == values["batchId"] }), Decimal(count) <= batch["quantityRemaining"].decimal else { throw mgError("ຈຳນວນເກີນສິນຄ້າຄົງເຫຼືອ") }
                var body = mgBody(values).object; body["quantity"] = .number(Decimal(count))
                let result = try await model.mutate("/api/finished-goods/adjust", body: .object(body))
                model.showNotice("ບັນທຶກຂອງເສຍແລ້ວ · \(result.id)"); await state.refresh()
            }
        }
    }
    private func reload() async {
        let requested = page
        await state.load(model, "production", query: history ? ["historyPage": String(requested)] : [:])
        if state.error == nil, history, state.data["historyPage"] != .null { page = max(1, Int(state.data["historyPage"].double)) }
    }
    private func export() {
        model.exportCSV(name: "production", headers: ["ລັອດ", "ສິນຄ້າ", "ຜະລິດ", "ຄົງເຫຼືອ", "ຜະລິດວັນທີ", "ໝົດອາຍຸ", "ຕົ້ນທຶນ/ຖ້ວຍ", "ຮູ້ຕົ້ນທຶນ"], rows: batches.map { row in ["batchNumber", "productName", "quantityProduced", "quantityRemaining", "mfgDate", "expDate", "unitCost", "costKnown"].map { row.text($0) } })
    }
}

private struct ProductionRequirement: Identifiable {
    let id: String
    let name: String
    let unit: String
    let required: Decimal
    let available: Decimal
    let cost: Decimal
    let active: Bool
    var shortage: Bool { !active || required <= 0 || required > available }
}
private struct ProductionPlannerSheet: View {
    @ObservedObject var model: AppModel
    let data: JSONValue
    let saved: () async -> Void
    @State private var productId = ""
    @State private var cups = "100"
    @State private var busy = false
    @State private var error: String?
    @State private var result: JSONValue?
    @State private var submissionReconciled = false
    @State private var baseline: [String: String] = [:]
    private var formFields: [String: String] { ["productId": productId, "cups": cups] }
    private var recipes: [JSONValue] { data["recipes"].array.filter { $0["isDefault"] == .null || $0["isDefault"].bool } }
    private var recipe: JSONValue? { recipes.first { $0.text("finishedProductId") == productId } }
    private var lines: [ProductionRequirement] {
        guard let recipe, recipe["baseCups"].decimal > 0, let count = Decimal(string: cups) else { return [] }
        return recipe["items"].array.map { item in
            let material = data["materials"].array.first { $0.id == item.text("rawMaterialId") } ?? item["rawMaterial"]
            var raw = item["quantityRequired"].decimal * count / recipe["baseCups"].decimal
            var required = Decimal(); NSDecimalRound(&required, &raw, 6, .plain)
            return ProductionRequirement(id: item.text("rawMaterialId"), name: material.text("name"), unit: material.text("unit"), required: required, available: material["currentStock"].decimal, cost: required * material["avgCostPerUnit"].decimal, active: material["isActive"].bool)
        }
    }
    private var total: Decimal { lines.reduce(0) { $0 + $1.cost } }
    private var valid: Bool { (try? mgPositiveInteger(cups)) != nil && !lines.isEmpty && !lines.contains(where: \.shortage) }
    var body: some View {
        ManagementSheet("ວາງແຜນຜະລິດ", dirty: !baseline.isEmpty && formFields != baseline && result == nil, busy: busy) {
            VStack(alignment: .leading, spacing: 24) {
                if recipes.isEmpty { EmptyNotice(title: "ຍັງບໍ່ມີສູດພ້ອມຜະລິດ", detail: "ສ້າງສູດຫຼັກໃນໜ້າຈັດການລະບົບກ່ອນ", symbol: "list.bullet.clipboard") }
                else {
                    HStack(alignment: .top, spacing: 16) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("ສິນຄ້າ / ສູດຫຼັກ")
                            Picker("ສິນຄ້າ / ສູດຫຼັກ", selection: $productId) { ForEach(recipes) { recipe in Text("\(recipe.text("name")) · V\(recipe.text("version"))").tag(recipe.text("finishedProductId")) } }.labelsHidden()
                        }.frame(maxWidth: .infinity, alignment: .leading)
                        VStack(alignment: .leading, spacing: 8) { Text("ຈຳນວນຖ້ວຍ"); TextField("1–100,000", text: $cups).textFieldStyle(.roundedBorder).accessibilityLabel("ຈຳນວນຖ້ວຍ"); Text("ຈຳນວນເຕັມ 1–100,000 ຖ້ວຍ").font(Theme.font(12)).foregroundStyle(Theme.muted) }.frame(width: 220)
                    }.controlSize(.large).disabled(busy || result != nil || submissionReconciled)
                    ManagementPanel("ວັດຖຸດິບທີ່ຕ້ອງໃຊ້", color: Theme.green) {
                        Grid(alignment: .leading, horizontalSpacing: 20, verticalSpacing: 12) {
                            GridRow { Text("ວັດຖຸດິບ"); Text("ຕ້ອງໃຊ້"); Text("ມີ"); Text("ຕົ້ນທຶນ") }.font(Theme.font(12, weight: .semibold)).foregroundStyle(Theme.muted)
                            ForEach(lines) { line in
                                GridRow { Text(line.name); Text("\(mgDecimalText(line.required)) \(line.unit)"); Text("\(mgDecimalText(line.available)) \(line.unit)").foregroundStyle(line.shortage ? Theme.danger : Theme.ink); AmountText(line.cost) }
                            }
                        }.monospacedDigit()
                        if lines.contains(where: \.shortage) { Label("ວັດຖຸດິບບໍ່ພໍ ຫຼືຈຳນວນນ້ອຍເກີນໄປ", systemImage: "exclamationmark.triangle").foregroundStyle(Theme.danger) }
                    }
                    HStack { VStack(alignment: .leading, spacing: 8) { Text("ຕົ້ນທຶນຄາດຄະເນ").foregroundStyle(Theme.muted); AmountText(total).font(Theme.font(22, weight: .semibold)); Text("ຕົ້ນທຶນຈິງຈະຖືກຄຳນວນເມື່ອບັນທຶກລັອດ").font(Theme.font(12)).foregroundStyle(Theme.muted) }; Spacer(); Button("ສ້າງລັອດ ແລະຫັກວັດຖຸດິບ") { Task { await create() } }.buttonStyle(.borderedProminent).controlSize(.large).disabled(!valid || busy || result != nil || submissionReconciled) }
                }
                ManagementFeedback(error: error, success: nil)
                if let result {
                    ManagementPanel("ສ້າງລັອດຜະລິດແລ້ວ", color: Theme.green) {
                        LabeledContent("ລັອດ", value: result.text("batchNumber")); LabeledContent("ສິນຄ້າ", value: result.text("productName")); LabeledContent("ຜະລິດ", value: "\(result.text("quantityProduced")) ຖ້ວຍ")
                        LabeledContent("ຕົ້ນທຶນຈິງ") { MoneyText(result["totalMaterialCost"]) }
                        LabeledContent("ໝົດອາຍຸ", value: result.text("expDate"))
                    }
                }
                if submissionReconciled { Text("ລາຍການເດີມຖືກກວດກາແລ້ວ. ເບິ່ງປະຫວັດລັອດເພື່ອກວດຜົນ.") }
                if result != nil || submissionReconciled { Button("ເລີ່ມລັອດໃໝ່") { Task { do { try await model.removeDraft(key: "production.planner", startNewIntent: true); result = nil; submissionReconciled = false; error = nil } catch { self.error = error.localizedDescription } } }.disabled(busy) }
            }
        }
        .task {
            productId = recipes.first?.text("finishedProductId") ?? ""; baseline = formFields
            do {
                if let draft = try await model.loadDraft(key: "production.planner") {
                    productId = draft.text("productId"); cups = draft.text("cups")
                    if draft["persistedResult"] != .null { result = draft["persistedResult"] }
                    submissionReconciled = draft.text("nativeOutcome") == "reconciled"
                    error = "ກູ້ຄືນຮ່າງການຜະລິດແລ້ວ. ກວດສູດ ແລະວັດຖຸດິບລ່າສຸດກ່ອນບັນທຶກ."
                }
            } catch { self.error = error.localizedDescription }
        }
        .onChange(of: formFields) { _, _ in Task { await persistDraft() } }
    }
    private func persistDraft() async {
        guard !baseline.isEmpty, result == nil, !submissionReconciled else { return }
        do { if formFields == baseline { try await model.removeDraft(key: "production.planner") } else { try await model.saveDraft(key: "production.planner", body: mgBody(formFields)) } }
        catch { self.error = "ບັນທຶກຮ່າງບໍ່ໄດ້ · \(error.localizedDescription)" }
    }
    private func create() async {
        guard valid, !busy, result == nil, !submissionReconciled else { return }; busy = true; error = nil
        defer { busy = false }
        do {
            try await model.saveDraft(key: "production.planner", body: mgBody(formFields))
            result = try await model.mutate("/api/production-batches", body: .object(["productId": .string(productId), "cups": .number(Decimal(try mgPositiveInteger(cups)))]), draftKey: "production.planner")
            baseline = formFields
            do {
                var draft = mgBody(formFields).object; draft["persistedResult"] = result
                try await model.saveDraft(key: "production.planner", body: .object(draft)); try await model.removeDraft(key: "production.planner")
            } catch { self.error = "ລັອດບັນທຶກແລ້ວ ແຕ່ລ້າງຮ່າງບໍ່ໄດ້ · \(error.localizedDescription)" }
            await saved()
        } catch { self.error = error.localizedDescription }
    }
}

struct ExpensesView: View {
    @ObservedObject var model: AppModel
    @StateObject private var state = FeatureState()
    @State private var query = ""
    @State private var filter = "all"
    @State private var page = 1
    @State private var expenseId: String?
    @State private var editor = false
    @State private var categoryEditor = false
    @State private var voidExpense: JSONValue?
    @State private var exporting = false
    private var rows: [JSONValue] { state.data["expenses"].array }
    private var writable: Bool { model.canWrite && state.source == "database" && model.session?.role == "admin" }
    var body: some View {
        Workspace(title: "ລາຍຈ່າຍ", subtitle: "ລາຍຈ່າຍຮ້ານ ແລະລາຍຈ່າຍກາງ · LAK", domain: .finance) {
            Button(exporting ? "ກຳລັງສົ່ງອອກ…" : "ສົ່ງອອກ CSV", systemImage: "square.and.arrow.up") { Task { await export() } }.disabled(rows.isEmpty || exporting)
            Button("ປະເພດໃໝ່") { categoryEditor = true }.disabled(!writable)
            Button("ບັນທຶກລາຍຈ່າຍ", systemImage: "plus") { expenseId = nil; editor = true }.buttonStyle(.borderedProminent).disabled(!writable)
        } content: {
            ReadStateView(state: state) {
                HStack {
                    ManagementMetric(title: "ລວມຕາມຕົວກອງ", value: state.data["totalAmount"], color: Theme.mango)
                    Text("\(state.data.text("total")) ລາຍການ").foregroundStyle(Theme.muted)
                }.padding(16).background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                HStack {
                    TextField("ຄົ້ນຫາປະເພດ, ຮ້ານ ຫຼືໝາຍເຫດ", text: $query).textFieldStyle(.roundedBorder).onSubmit { page = 1; Task { await reload() } }
                    Picker("ຕົວກອງ", selection: $filter) {
                        Text("ທັງໝົດ").tag("all"); Text("ເດືອນນີ້").tag("month"); Text("ຄ່າໄຟ").tag("electricity"); Text("ຂົນສົ່ງ").tag("transport"); Text("ສ້ອມແປງ").tag("maintenance")
                    }.frame(width: 180)
                    Button("ຄົ້ນຫາ", systemImage: "magnifyingglass") { page = 1; Task { await reload() } }
                    Button("ໂຫຼດຄືນ", systemImage: "arrow.clockwise") { Task { await state.refresh() } }
                }.controlSize(.large)
                if rows.isEmpty { EmptyNotice(title: "ບໍ່ພົບລາຍຈ່າຍ", detail: "ປ່ຽນຕົວກອງ ຫຼືບັນທຶກລາຍຈ່າຍໃໝ່", symbol: "receipt") }
                else {
                    Table(rows) {
                        TableColumn("ລາຍຈ່າຍ") { row in VStack(alignment: .leading, spacing: 3) { Text(row.text("category")); if !row.text("note").isEmpty { Text(row.text("note")).font(Theme.font(12)).foregroundStyle(Theme.muted).lineLimit(2) } } }.width(min: 160)
                        TableColumn("ວັນທີ") { Text($0.text("incurredAt")) }
                        TableColumn("ຮ້ານ") { row in Text(row.text("storeName").isEmpty ? "ລາຍຈ່າຍກາງ" : row.text("storeName")) }
                        TableColumn("ຈຳນວນເງິນ") { MoneyText($0["amount"]) }
                        TableColumn("ຫຼັກຖານ") { row in
                            if !row.text("receiptUrl").isEmpty { Button("ເບິ່ງໃບເສັດ", systemImage: "doc") { Task { do { try await model.openReceipt(row.text("receiptUrl")) } catch { model.showNotice(error.localizedDescription) } } } }
                            else { Text("—").foregroundStyle(Theme.muted) }
                        }
                        TableColumn("ຈັດການ") { row in Menu("ຈັດການ") { Button("ແກ້ໄຂ") { expenseId = row.id; editor = true }; Button("ຍົກເລີກລາຍຈ່າຍ", role: .destructive) { voidExpense = row } }.disabled(!writable) }.width(110)
                    }.frame(minHeight: 340).tableSurface()
                }
                ManagementPagination(page: page, pages: max(1, Int(state.data["server"]["pageCount"].double))) { page = $0; Task { await reload() } }
            }
        }
        .task { await reload() }
        .onChange(of: filter) { _, _ in page = 1; Task { await reload() } }
        .sheet(isPresented: $editor) { ExpenseEditorSheet(model: model, expenseId: expenseId) { await state.refresh() } }
        .sheet(isPresented: $categoryEditor) {
            NativeEditor(title: "ປະເພດລາຍຈ່າຍໃໝ່", subtitle: "ປະເພດໃໝ່ຈະໃຊ້ໄດ້ທັນທີໃນແບບຟອມລາຍຈ່າຍ.", fields: [EditorField(key: "name", label: "ຊື່ປະເພດ", required: true, help: "ຕົວຢ່າງ: ຄ່ານ້ຳມັນ, ຄ່າແຮງງານ")], saveLabel: "ເພີ່ມປະເພດ") { values in
                let result = try await model.mutate("/api/expense-categories", body: mgBody(values), durable: false)
                model.showNotice("ເພີ່ມປະເພດແລ້ວ · \(result.text("category"))")
            }
        }
        .sheet(item: $voidExpense) { row in
            NativeEditor(title: "ຍົກເລີກລາຍຈ່າຍ · \(row.text("category"))", subtitle: "ຈຳນວນ \(row.text("amount")) LAK ຈະຖືກຕັດອອກຈາກລາຍງານ. ປະຫວັດການຍົກເລີກຍັງຄົງຢູ່.", fields: [EditorField(key: "reason", label: "ເຫດຜົນທີ່ຍົກເລີກ", kind: .multiline, required: true)], saveLabel: "ຢືນຢັນຍົກເລີກລາຍຈ່າຍ") { values in
                _ = try await model.mutate("/api/expenses/\(row.id)", body: mgBody(values), method: "DELETE")
                model.showNotice("ຍົກເລີກລາຍຈ່າຍແລ້ວ"); await state.refresh()
            }
        }
    }
    private func reload() async {
        await state.load(model, "expenses", query: ["query": query, "filter": filter, "page": String(page)])
        if state.error == nil, state.data["server"]["page"] != .null { page = max(1, Int(state.data["server"]["page"].double)) }
    }
    private func export() async {
        exporting = true; defer { exporting = false }
        do {
            var all: [JSONValue] = []; var next = 1
            repeat {
                let response = try await model.read("expenses", query: ["query": query, "filter": filter, "page": String(next)])
                guard response.source == "database" else { throw mgError("ການສົ່ງອອກຕ້ອງເຊື່ອມຕໍ່ຖານຂໍ້ມູນ") }
                all.append(contentsOf: response.data["expenses"].array)
                if next >= max(1, Int(response.data["server"]["pageCount"].double)) { break }; next += 1
            } while next <= 10000
            guard next <= 10000 else { throw mgError("ລາຍການຫຼາຍເກີນການສົ່ງອອກຄັ້ງດຽວ. ກະລຸນາຈຳກັດຕົວກອງ") }
            model.exportCSV(name: "expenses", headers: ["ID", "ປະເພດ", "ວັນທີ", "ຮ້ານ", "LAK", "ໝາຍເຫດ", "ໃບເສັດ"], rows: all.map { row in ["id", "category", "incurredAtIso", "storeName", "amount", "note", "receiptUrl"].map { row.text($0) } })
        } catch { model.showNotice(error.localizedDescription) }
    }
}

private struct ExpenseEditorSheet: View {
    @ObservedObject var model: AppModel
    let expenseId: String?
    let saved: () async -> Void
    @State private var stores: [JSONValue] = []
    @State private var categories: [JSONValue] = []
    @State private var original: JSONValue = .null
    @State private var fields = ["category": "ອື່ນໆ", "amount": "", "incurredAt": businessDateString(Date()), "storeId": "", "note": "", "receiptUrl": ""]
    @State private var baseline: [String: String] = [:]
    @State private var loading = true
    @State private var busy = false
    @State private var review = false
    @State private var persistedId: String?
    @State private var submissionReconciled = false
    @State private var error: String?
    @State private var attachment: URL?
    @State private var uploadedAttachment: URL?
    @State private var importing = false
    @State private var confirmReload = false
    @FocusState private var focusedField: String?
    @State private var showValidation = false
    @State private var typingCategory = false
    private var draftKey: String { "expense.\(expenseId ?? "new")" }
    private var dirty: Bool { persistedId == nil && !submissionReconciled && (!baseline.isEmpty && fields != baseline || attachment != nil) }
    private func binding(_ key: String) -> Binding<String> { Binding(get: { fields[key, default: ""] }, set: { fields[key] = $0 }) }
    var body: some View {
        ManagementSheet(expenseId == nil ? "ບັນທຶກລາຍຈ່າຍ" : "ແກ້ໄຂລາຍຈ່າຍ", dirty: dirty, busy: busy) {
            VStack(alignment: .leading, spacing: 24) {
                if loading { ProgressView("ກຳລັງໂຫຼດຂໍ້ມູນ…").frame(maxWidth: .infinity) }
                else if let persistedId {
                    ManagementPanel("ບັນທຶກລາຍຈ່າຍແລ້ວ", color: Theme.green) {
                        LabeledContent("ລະຫັດລາຍຈ່າຍ", value: persistedId)
                        ManagementFeedback(error: error, success: nil)
                        LabeledContent("ປະເພດ", value: fields["category", default: ""])
                        LabeledContent("ຈຳນວນເງິນ") { AmountText(Decimal(string: fields["amount", default: ""]) ?? 0) }
                        LabeledContent("ວັນທີ", value: fields["incurredAt", default: ""])
                        if !fields["receiptUrl", default: ""].isEmpty { Button("ເບິ່ງຫຼັກຖານ") { Task { await openReceipt() } } }
                        Button(expenseId == nil ? "ເລີ່ມລາຍຈ່າຍໃໝ່" : "ໂຫຼດລາຍຈ່າຍເພື່ອແກ້ໄຂໃໝ່") { Task { await beginNewIntent() } }
                    }
                } else if submissionReconciled {
                    Text("ລາຍການເດີມຖືກກວດກາແລ້ວ. ເບິ່ງປະຫວັດລາຍຈ່າຍເພື່ອກວດຜົນ.")
                    Button(expenseId == nil ? "ເລີ່ມລາຍຈ່າຍໃໝ່" : "ໂຫຼດລາຍຈ່າຍເພື່ອແກ້ໄຂໃໝ່") { Task { await beginNewIntent() } }
                } else if !baseline.isEmpty {
                    if review { reviewContent } else { editContent }
                    ManagementFeedback(error: error, success: nil)
                    HStack {
                        if review { Button("ກັບໄປແກ້ໄຂ") { review = false }.disabled(busy) }; if expenseId != nil { Button("ໂຫຼດລາຍຈ່າຍລ່າສຸດ") { confirmReload = true }.disabled(busy) }
                        Spacer()
                        Button(busy ? "ກຳລັງບັນທຶກ…" : review ? "ຢືນຢັນບັນທຶກ" : "ກວດກ່ອນບັນທຶກ") { Task { if review { await save() } else { validate() } } }.buttonStyle(.borderedProminent).controlSize(.large).disabled(busy)
                    }
                } else {
                    ManagementFeedback(error: error, success: nil)
                    Button("ລອງໂຫຼດອີກຄັ້ງ") { Task { await load() } }
                }
            }
        }
        .task { await load() }
        .onChange(of: fields) { _, _ in Task { await persistDraft() } }
        .onChange(of: attachment) { _, _ in Task { await persistDraft() } }
        .confirmationDialog("ໂຫຼດລາຍຈ່າຍລ່າສຸດ ແລະລ້າງຮ່າງ?", isPresented: $confirmReload, titleVisibility: .visible) {
            Button("ໂຫຼດລາຍຈ່າຍລ່າສຸດ", role: .destructive) { Task { await load(ignoreDraft: true) } }
            Button("ສືບຕໍ່ແກ້ໄຂ", role: .cancel) { }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.jpeg, .png, .webP, .pdf]) { result in
            do { attachment = try result.get(); uploadedAttachment = nil } catch { self.error = error.localizedDescription }
        }
    }
    private static let typedCategory = "__typed__"
    private var categoryNames: [String] { categories.map { $0.text("name") } }
    /// One menu for the category: known categories, or "type a new one", which reveals a text field.
    private var categorySelection: Binding<String> {
        Binding(get: {
            let current = fields["category", default: ""]
            return typingCategory || !categoryNames.contains(current) ? Self.typedCategory : current
        }, set: { value in
            if value == Self.typedCategory { typingCategory = true; if categoryNames.contains(fields["category", default: ""]) { fields["category"] = "" } }
            else { typingCategory = false; fields["category"] = value }
        })
    }
    private var editContent: some View {
        VStack(alignment: .leading, spacing: 14) {
            FormCard("ລາຍຈ່າຍ") {
                HStack(alignment: .top, spacing: 14) {
                    expenseField("ປະເພດ", required: true, error: showValidation && fields["category", default: ""].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "ກະລຸນາເລືອກ ຫຼືພິມປະເພດ" : nil) {
                        Picker("ປະເພດລາຍຈ່າຍ", selection: categorySelection) {
                            ForEach(categoryNames, id: \.self) { Text($0).tag($0) }
                            Divider()
                            Text("ພິມປະເພດໃໝ່…").tag(Self.typedCategory)
                        }.labelsHidden().pickerStyle(.menu).frame(maxWidth: .infinity, alignment: .leading)
                        if categorySelection.wrappedValue == Self.typedCategory {
                            TextField("ພິມຊື່ປະເພດໃໝ່", text: binding("category")).accessibilityLabel("ປະເພດລາຍຈ່າຍໃໝ່").focused($focusedField, equals: "category")
                        }
                    }
                    expenseField("ຈຳນວນເງິນ (LAK)", required: true, help: "ທົດສະນິຍົມໄດ້ 2 ຕຳແໜ່ງ",
                                 error: showValidation && ((try? canonicalDecimal(fields["amount", default: ""])) == nil || (Decimal(string: fields["amount", default: ""]) ?? 0) <= 0) ? "ຈຳນວນເງິນຕ້ອງຫຼາຍກວ່າ 0 ແລະລະອຽດບໍ່ເກີນ 2 ຕຳແໜ່ງ" : nil) {
                        TextField("0.00", text: binding("amount")).accessibilityLabel("ຈຳນວນເງິນ LAK").focused($focusedField, equals: "amount")
                    }
                }
                HStack(alignment: .top, spacing: 14) {
                    expenseField("ວັນທີ", required: true, error: showValidation && !mgValidDate(fields["incurredAt", default: ""]) ? "ວັນທີບໍ່ຖືກຕ້ອງ" : nil) {
                        DateOnlyPicker(label: "ວັນທີລາຍຈ່າຍ", text: binding("incurredAt"))
                    }
                    expenseField("ຮ້ານ", help: "ເລືອກ “ລາຍຈ່າຍກາງ” ຖ້າບໍ່ແມ່ນຂອງຮ້ານໃດ") {
                        Picker("ຮ້ານ", selection: binding("storeId")) { Text("ລາຍຈ່າຍກາງ").tag(""); if let id = fields["storeId"], !id.isEmpty, !stores.contains(where: { $0.id == id }) { Text(original.text("storeName") + " · ຮ້ານເດີມ").tag(id) }; ForEach(stores) { Text($0.text("name")).tag($0.id) } }
                            .labelsHidden().pickerStyle(.menu).frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            FormCard("ໝາຍເຫດ ແລະຫຼັກຖານ") {
                TextEditor(text: binding("note")).accessibilityLabel("ໝາຍເຫດ").font(Theme.font()).scrollContentBackground(.hidden).frame(height: 80).padding(6)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 6)).overlay(RoundedRectangle(cornerRadius: 6).stroke(Theme.border))
                HStack {
                    Button("ແນບໃບເສັດ / ຫຼັກຖານ", systemImage: "paperclip") { importing = true }
                    if let attachment { Label(attachment.lastPathComponent, systemImage: "doc").lineLimit(1); Button("ເອົາອອກ") { self.attachment = nil; uploadedAttachment = nil } }
                    else if !fields["receiptUrl", default: ""].isEmpty { Button("ເບິ່ງຫຼັກຖານເດີມ") { Task { await openReceipt() } } }
                }
                Text("JPEG, PNG, WebP ຫຼື PDF · ໃບເສັດຈະຖືກອັບໂຫຼດເມື່ອຢືນຢັນບັນທຶກ").font(Theme.font(12)).foregroundStyle(Theme.muted)
            }
        }.disabled(busy)
    }
    private func expenseField<Content: View>(_ label: String, required: Bool = false, help: String = "", error: String? = nil, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 3) {
                Text(label).font(Theme.font(13, weight: .semibold)).foregroundStyle(error == nil ? Theme.ink : Theme.danger)
                if required { Text("*").font(Theme.font(13, weight: .bold)).foregroundStyle(Theme.danger).accessibilityHidden(true) }
            }
            content()
            if let error { Text(error).font(Theme.font(12)).foregroundStyle(Theme.danger) }
            else if !help.isEmpty { Text(help).font(Theme.font(12)).foregroundStyle(Theme.muted) }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private var reviewContent: some View {
        ManagementPanel("ກວດລາຍຈ່າຍກ່ອນບັນທຶກ", color: Theme.mango) {
            LabeledContent("ປະເພດ", value: fields["category", default: ""])
            LabeledContent("ຈຳນວນເງິນ") { AmountText(Decimal(string: fields["amount", default: ""]) ?? 0) }
            LabeledContent("ວັນທີ", value: fields["incurredAt", default: ""])
            LabeledContent("ຮ້ານ", value: stores.first { $0.id == fields["storeId"] }?.text("name") ?? (fields["storeId", default: ""].isEmpty ? "ລາຍຈ່າຍກາງ" : original.text("storeName")))
            LabeledContent("ໝາຍເຫດ", value: fields["note", default: ""])
            LabeledContent("ຫຼັກຖານ", value: attachment?.lastPathComponent ?? (fields["receiptUrl", default: ""].isEmpty ? "ບໍ່ມີ" : "ຫຼັກຖານເດີມ"))
            if expenseId != nil { Text("ລະບົບຈະກວດກັບຂໍ້ມູນເດີມກ່ອນແກ້ໄຂ. ຖ້າມີຜູ້ອື່ນແກ້ແລ້ວ ຕ້ອງໂຫຼດຄືນ.").font(Theme.font(12)).foregroundStyle(Theme.muted) }
        }
    }
    private func load(ignoreDraft: Bool = false) async {
        loading = true; error = nil; review = false; defer { loading = false }
        do {
            let catalog = try await model.read("catalog")
            guard catalog.source == "database" else { throw mgError("ເຊື່ອມຕໍ່ຖານຂໍ້ມູນກ່ອນບັນທຶກ") }
            stores = catalog.data["stores"].array; categories = catalog.data["categories"].array
            if let expenseId {
                let response = try await model.read("expense", query: ["id": expenseId])
                guard response.source == "database" else { throw mgError("ບໍ່ສາມາດໂຫຼດລາຍຈ່າຍເດີມໄດ້") }
                original = response.data["expense"]
                guard !original.id.isEmpty, original["expectedExpenseSnapshot"] != .null else { throw mgError("ຂໍ້ມູນສຳລັບແກ້ໄຂບໍ່ຄົບ. ກະລຸນາໂຫຼດຄືນ") }
                for key in fields.keys { fields[key] = original.text(key) }
            }
            baseline = fields
            if ignoreDraft { try await model.removeDraft(key: draftKey, startNewIntent: true); attachment = nil; uploadedAttachment = nil; persistedId = nil; submissionReconciled = false }
            else if let draft = try await model.loadDraft(key: draftKey) {
                if let id = draft.object["persistedId"], !id.text.isEmpty { persistedId = id.text }
                submissionReconciled = draft.text("nativeOutcome") == "reconciled"
                let restored = draft["fields"].object.mapValues(\.text)
                if !restored.isEmpty {
                    fields = restored
                    if expenseId != nil { original = draft["original"] }
                    if !draft.text("attachmentPath").isEmpty { attachment = URL(fileURLWithPath: draft.text("attachmentPath")) }
                    if !draft.text("uploadedAttachmentPath").isEmpty { uploadedAttachment = URL(fileURLWithPath: draft.text("uploadedAttachmentPath")) }
                    error = "ກູ້ຄືນຮ່າງລາຍຈ່າຍແລ້ວ. ກວດຄ່າ ແລະຫຼັກຖານກ່ອນຢືນຢັນ."
                }
            }
        } catch { self.error = error.localizedDescription }
    }
    private func persistDraft() async {
        guard !loading, !baseline.isEmpty, persistedId == nil, !submissionReconciled else { return }
        do { if dirty { try await model.saveDraft(key: draftKey, body: .object(["fields": mgBody(fields), "original": original, "attachmentPath": .string(attachment?.path ?? ""), "uploadedAttachmentPath": .string(uploadedAttachment?.path ?? "")])) } else { try await model.removeDraft(key: draftKey) } }
        catch { self.error = "ບັນທຶກຮ່າງບໍ່ໄດ້ · \(error.localizedDescription)" }
    }
    private func validate() {
        showValidation = true
        do {
            focusedField = "amount"
            let amount = try canonicalDecimal(fields["amount", default: ""])
            guard (Decimal(string: amount) ?? 0) > 0 else { throw mgError("ຈຳນວນເງິນຕ້ອງຫຼາຍກວ່າ 0") }
            focusedField = "category"
            guard !fields["category", default: ""].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw mgError("ກະລຸນາໃສ່ປະເພດ") }
            focusedField = "incurredAt"
            guard mgValidDate(fields["incurredAt", default: ""]) else { throw mgError("ວັນທີບໍ່ຖືກຕ້ອງ · ໃຊ້ YYYY-MM-DD") }
            fields["amount"] = amount; error = nil; focusedField = nil; review = true
        } catch { self.error = error.localizedDescription }
    }
    private func save() async {
        guard !busy, persistedId == nil, !submissionReconciled else { return }; busy = true; error = nil; defer { busy = false }
        do {
            if let attachment, uploadedAttachment != attachment {
                let scoped = attachment.startAccessingSecurityScopedResource(); defer { if scoped { attachment.stopAccessingSecurityScopedResource() } }
                fields["receiptUrl"] = try await model.uploadReceipt(attachment); uploadedAttachment = attachment
            }
            var body = mgBody(fields).object
            if expenseId != nil { body["expectedExpenseSnapshot"] = original["expectedExpenseSnapshot"] }
            try await model.saveDraft(key: draftKey, body: .object(["fields": mgBody(fields), "original": original, "attachmentPath": .string(attachment?.path ?? ""), "uploadedAttachmentPath": .string(uploadedAttachment?.path ?? "")]))
            let result = try await model.mutate(expenseId.map { "/api/expenses/\($0)" } ?? "/api/expenses", body: .object(body), method: expenseId == nil ? "POST" : "PATCH", draftKey: draftKey)
            persistedId = result.id
            do {
                try await model.saveDraft(key: draftKey, body: .object(["fields": mgBody(fields), "original": original, "persistedId": .string(result.id)]))
                try await model.removeDraft(key: draftKey)
            } catch { self.error = "ລາຍຈ່າຍບັນທຶກແລ້ວ ແຕ່ລ້າງຮ່າງບໍ່ໄດ້ · \(error.localizedDescription)" }
            await saved()
        } catch { self.error = error.localizedDescription }
    }
    private func beginNewIntent() async {
        do {
            try await model.removeDraft(key: draftKey, startNewIntent: true)
            persistedId = nil; submissionReconciled = false; review = false; error = nil
            if expenseId != nil { await load(ignoreDraft: true) }
        } catch { self.error = error.localizedDescription }
    }
    private func openReceipt() async { do { try await model.openReceipt(fields["receiptUrl", default: ""]) } catch { self.error = error.localizedDescription } }
}
private func mgValidDate(_ text: String) -> Bool {
    let format = DateFormatter(); format.calendar = Calendar(identifier: .gregorian); format.locale = Locale(identifier: "en_US_POSIX"); format.timeZone = TimeZone(identifier: "Asia/Vientiane"); format.dateFormat = "yyyy-MM-dd"; format.isLenient = false
    guard let date = format.date(from: text) else { return false }; return format.string(from: date) == text
}

struct ReportsView: View {
    @ObservedObject var model: AppModel
    @StateObject private var state = FeatureState()
    @State private var period = "month"
    @State private var dataPeriod = "month"
    private var periodLabel: String { dataPeriod == "today" ? "ມື້ນີ້" : dataPeriod == "week" ? "7 ມື້ຫຼ້າສຸດ" : "ເດືອນນີ້" }
    var body: some View {
        Workspace(title: "ລາຍງານທຸລະກິດ", subtitle: "ຍອດຂາຍ, ຕົ້ນທຶນ ແລະກຳໄລຈາກລາຍການທີ່ບັນທຶກ", domain: .finance) {
            Picker("ໄລຍະເວລາ", selection: $period) { Text("ມື້ນີ້").tag("today"); Text("7 ມື້ຫຼ້າສຸດ").tag("week"); Text("ເດືອນນີ້").tag("month") }.pickerStyle(.segmented).labelsHidden().frame(width: 300)
            Button("ສົ່ງອອກ CSV", systemImage: "square.and.arrow.up") { export() }.fixedSize().disabled(state.data == .null)
            Button("ໂຫຼດຄືນ", systemImage: "arrow.clockwise") { Task { await state.refresh() } }
        } content: {
            ReadStateView(state: state) {
                HStack {
                    Text("ຂໍ້ມູນທີ່ໂຫຼດ: \(periodLabel)").foregroundStyle(Theme.muted)
                    Spacer()
                    if state.data["range"] != .null { Text("\(mgDateTime(state.data["range"].text("from"))) ຫາກ່ອນ \(mgDateTime(state.data["range"].text("to")))").font(Theme.font(12)).foregroundStyle(Theme.muted) }
                }
                HStack(spacing: 16) {
                    ManagementMetric(title: "ຍອດຂາຍ", value: state.data["monthGross"], color: Theme.mango)
                    ManagementMetric(title: "ສ່ວນແບ່ງຮ້ານ", value: state.data["storeShare"])
                    ManagementMetric(title: "ລາຍຈ່າຍ", value: state.data["expenses"])
                    ManagementMetric(title: "ກຳໄລສຸດທິ", value: state.data["netProfit"], color: state.data["netProfit"].decimal < 0 ? Theme.danger : Theme.green)
                }.padding(16).background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                ManagementPanel("ທີ່ມາຂອງຕົ້ນທຶນ", color: Theme.mango) {
                    StatusLabel(state.data.text("costMode") == "actual" ? "ຕົ້ນທຶນຈິງ" : "ມີຕົ້ນທຶນຄາດຄະເນ", tone: state.data.text("costMode") == "actual" ? .success : .warning)
                    Text(state.data.text("costMode") == "actual" ? "ຄຳນວນຈາກຕົ້ນທຶນລັອດທີ່ບັນທຶກຕອນຜະລິດ." : "ລາຍການທີ່ບໍ່ຮູ້ຕົ້ນທຶນໃຊ້ 28% ຂອງລາຄາຂາຍ. ກຳໄລອາດປ່ຽນເມື່ອຂໍ້ມູນຕົ້ນທຶນຄົບ.").foregroundStyle(Theme.muted)
                    HStack { ManagementMetric(title: "ຕົ້ນທຶນສິນຄ້າຂາຍ", value: state.data["productCost"]); ManagementMetric(title: "ຂອງເສຍໃນຮ້ານ", value: state.data["storeWasteCost"]); ManagementMetric(title: "ຂອງເສຍສາງກາງ", value: state.data["centralWasteCost"]); ManagementMetric(title: "ລາຍຈ່າຍກາງ", value: state.data["unallocatedExpenses"]) }
                }
                ManagementPanel("ຜົນລັບແຍກຕາມຮ້ານ", color: Theme.mango) {
                    if state.data["storeRows"].array.isEmpty { EmptyNotice(title: "ບໍ່ມີຜົນລັບໃນໄລຍະນີ້", detail: "ເລືອກໄລຍະເວລາອື່ນ", symbol: "chart.bar") }
                    else { storeTable }
                    Text("ລາຍຈ່າຍກາງບໍ່ໄດ້ແຈກໃຫ້ແຕ່ລະຮ້ານ · ງົບຄ່າໄຟແມ່ນງົບປະມານ ລາຍຈ່າຍຈິງຄິດຈາກລາຍການລາຍຈ່າຍ.").font(Theme.font(12)).foregroundStyle(Theme.muted)
                }
                ManagementPanel("ຈຳນວນຂາຍຕາມສິນຄ້າ", color: Theme.mango) {
                    if state.data["productSales"].array.isEmpty { Text("ຍັງບໍ່ມີຍອດຂາຍໃນໄລຍະນີ້").foregroundStyle(Theme.muted) }
                    ForEach(mgIdentified(state.data["productSales"].array, key: "productId")) { product in HStack { Text(product.text("name")); Text(product.text("code")).foregroundStyle(Theme.muted); Spacer(); Text("\(product.text("unitsSold")) ຖ້ວຍ").monospacedDigit() } }
                }
            }
        }.task { await reload() }.onChange(of: period) { _, _ in Task { await reload() } }
    }
    private var storeTable: some View {
        Table(mgIdentified(state.data["storeRows"].array, key: "storeId")) {
            TableColumn("ຮ້ານ") { Text($0.text("storeName")) }.width(min: 150)
            TableColumn("ຂາຍ") { MoneyText($0["gross"]) }
            TableColumn("ສ່ວນແບ່ງ") { MoneyText($0["storeShare"]) }
            TableColumn("ຕົ້ນທຶນ") { MoneyText($0["productCost"]) }
            TableColumn("ຂອງເສຍ") { MoneyText($0["wasteCost"]) }
            TableColumn("ລາຍຈ່າຍ") { MoneyText($0["expenseTotal"]) }
            TableColumn("ກຳໄລ") { row in MoneyText(row["profit"]).foregroundStyle(row["profit"].decimal < 0 ? Theme.danger : Theme.ink) }
        }.frame(minHeight: 260).tableSurface()
    }
    private func reload() async {
        let requested = period
        // Cached results are keyed to this period too, including when refresh fails.
        dataPeriod = requested
        await state.load(model, "reports", query: ["period": requested])
    }
    private func export() {
        let keys = ["storeName", "gross", "storeShare", "productCost", "wasteCost", "electricity", "transport", "otherExpenses", "expenseTotal", "profit", "electricityBudget"]
        var rows = state.data["storeRows"].array.map { row in keys.map { row.text($0) } }
        rows.append(["ລາຍຈ່າຍກາງ", "", "", "", "", "", "", "", state.data.text("unallocatedExpenses"), "", ""])
        rows.append(["ລວມ", state.data.text("monthGross"), state.data.text("storeShare"), state.data.text("productCost"), state.data.text("wasteCost"), "", "", "", state.data.text("expenses"), state.data.text("netProfit"), state.data.text("electricityBudget")])
        rows.append(["ທີ່ມາຕົ້ນທຶນ", state.data.text("costMode")])
        rows.append(["ໄລຍະເວລາ", dataPeriod, state.data["range"].text("from"), state.data["range"].text("to"), "Asia/Vientiane"])
        rows.append(["ທີ່ມາຂໍ້ມູນ", state.source, state.generatedAt])
        rows.append(["ສິນຄ້າ", "ລະຫັດ", "ຈຳນວນຂາຍ"])
        rows.append(contentsOf: state.data["productSales"].array.map { [$0.text("name"), $0.text("code"), $0.text("unitsSold")] })
        model.exportCSV(name: "reports-\(dataPeriod)-\(state.source)", headers: ["ຮ້ານ", "ຂາຍ", "ສ່ວນແບ່ງ", "ຕົ້ນທຶນຂາຍ", "ຂອງເສຍ", "ຄ່າໄຟ", "ຂົນສົ່ງ", "ອື່ນໆ", "ລາຍຈ່າຍ", "ກຳໄລ", "ງົບຄ່າໄຟ"], rows: rows)
    }
}

struct OperationsView: View {
    @ObservedObject var model: AppModel
    @StateObject private var state = FeatureState()
    @State private var tab = "products"
    @State private var editor: String?
    @State private var selected: JSONValue?
    @State private var recipeEditor = false
    @State private var closingEditor = false
    private var writable: Bool { model.canWrite && state.source == "database" }
    private var admin: Bool { model.session?.role == "admin" }
    var body: some View {
        Workspace(title: "ຈັດການລະບົບ", subtitle: "ສິນຄ້າ, ວັດຖຸດິບ, ສະບັບສູດ ແລະປິດຍອດ", domain: .operations) {
            Button("ປິດຍອດປະຈຳວັນ", systemImage: "calendar.badge.checkmark") { closingEditor = true }.disabled(!writable || !admin)
            if tab == "products" || tab == "materials" {
                Button(tab == "products" ? "ສ້າງສິນຄ້າ" : "ສ້າງວັດຖຸດິບ", systemImage: "plus") { selected = nil; editor = tab }.buttonStyle(.borderedProminent).disabled(!writable || !admin)
            } else if tab == "recipes" {
                Button("ສ້າງສູດ", systemImage: "plus") { selected = nil; recipeEditor = true }.buttonStyle(.borderedProminent).disabled(!writable)
            }
        } content: {
            ReadStateView(state: state) {
                HStack {
                    Picker("ຈັດການ", selection: $tab) { Text("ສິນຄ້າ").tag("products"); Text("ວັດຖຸດິບ").tag("materials"); Text("ສະບັບສູດ").tag("recipes"); if admin { Text("ສຳຮອງຂໍ້ມູນ").tag("backup") } }.pickerStyle(.segmented).frame(maxWidth: 640)
                    Spacer()
                    // The web operations page links these admin tools; the sidebar does not list them.
                    if admin { ForEach([Destination.fridges, .audit]) { destination in Button(destination.title, systemImage: destination.symbol) { model.navigate(destination) } } }
                    Button("ໂຫຼດຄືນ", systemImage: "arrow.clockwise") { Task { await state.refresh() } }
                }.controlSize(.large)
                if tab == "products" { productsTable }
                else if tab == "materials" { materialsTable }
                else if tab == "recipes" { recipesTable }
                else { backupContent }
            }
        }
        .task { await state.load(model, "operations") }
        .sheet(isPresented: Binding(get: { editor != nil }, set: { if !$0 { editor = nil; selected = nil } })) { catalogEditor }
        .sheet(isPresented: $recipeEditor) { RecipeEditorSheet(model: model, data: state.data, original: selected) { await state.refresh() } }
        .sheet(isPresented: $closingEditor) { DailyClosingSheet(model: model) }
    }
    @ViewBuilder private var productsTable: some View {
        if state.data["products"].array.isEmpty { EmptyNotice(title: "ຍັງບໍ່ມີສິນຄ້າ", detail: "ສ້າງສິນຄ້າ ແລ້ວສ້າງສູດເພື່ອຜະລິດ", symbol: "cup.and.saucer") }
        else {
            Table(state.data["products"].array) {
                TableColumn("ສິນຄ້າ") { row in VStack(alignment: .leading) { Text(row.text("name")); Text(row.text("code")).font(Theme.font(12)).foregroundStyle(Theme.muted) } }.width(min: 180)
                TableColumn("ຂະໜາດ") { Text($0.text("sizeDescription")) }
                TableColumn("ລາຄາຂາຍ") { MoneyText($0["retailPrice"]) }
                TableColumn("ອາຍຸ") { Text("\($0.text("shelfLifeDays")) ມື້") }
                TableColumn("ສະຖານະ") { row in StatusLabel(row["isActive"].bool ? "ເປີດໃຊ້" : "ປິດໃຊ້", tone: row["isActive"].bool ? .success : .neutral) }
                TableColumn("ຈັດການ") { row in Button("ແກ້ໄຂ") { selected = row; editor = "products" }.disabled(!writable || !admin) }.width(100)
            }.frame(minHeight: 380).tableSurface()
        }
    }
    @ViewBuilder private var materialsTable: some View {
        if state.data["materials"].array.isEmpty { EmptyNotice(title: "ຍັງບໍ່ມີວັດຖຸດິບ", detail: "ສ້າງວັດຖຸດິບ ແລ້ວຮັບເຂົ້າໃນໜ້າສະຕັອກ", symbol: "shippingbox") }
        else {
            Table(state.data["materials"].array) {
                TableColumn("ວັດຖຸດິບ") { row in VStack(alignment: .leading) { Text(row.text("name")); Text(row.text("code")).font(Theme.font(12)).foregroundStyle(Theme.muted) } }.width(min: 170)
                TableColumn("ປະເພດ") { Text($0.text("category") == "packaging" ? "ບັນຈຸພັນ" : "ສ່ວນປະກອບ") }
                TableColumn("ຄົງເຫຼືອ") { Text("\($0.text("currentStock")) \($0.text("unit"))").monospacedDigit() }
                TableColumn("ຕົ້ນທຶນ / ໜ່ວຍ") { MoneyText($0["avgCostPerUnit"]) }
                TableColumn("ສະຖານະ") { row in StatusLabel(row["isActive"].bool ? "ເປີດໃຊ້" : "ປິດໃຊ້", tone: row["isActive"].bool ? .success : .neutral) }
                TableColumn("ຈັດການ") { row in Button("ແກ້ໄຂ") { selected = row; editor = "materials" }.disabled(!writable || !admin) }.width(100)
            }.frame(minHeight: 380).tableSurface()
        }
    }
    @ViewBuilder private var recipesTable: some View {
        if state.data["recipes"].array.isEmpty { EmptyNotice(title: "ຍັງບໍ່ມີສູດ", detail: "ເລືອກສິນຄ້າ ແລະໃສ່ວັດຖຸດິບເພື່ອສ້າງສູດ", symbol: "list.bullet.clipboard") }
        else {
            Table(state.data["recipes"].array) {
                TableColumn("ສູດ") { row in VStack(alignment: .leading) { Text(row.text("name")); Text(row["finishedProduct"].text("name")).font(Theme.font(12)).foregroundStyle(Theme.muted) } }.width(min: 200)
                TableColumn("ສະບັບ") { row in HStack { Text("V\(row.text("version"))"); if row["isDefault"].bool { StatusLabel("ສູດຫຼັກ", tone: .success) } } }
                TableColumn("ຖ້ວຍພື້ນຖານ") { Text($0.text("baseCups")) }
                TableColumn("ວັດຖຸດິບ") { Text("\($0["items"].array.count) ລາຍການ") }
                TableColumn("ຈັດການ") { row in Button("ສ້າງສະບັບໃໝ່") { selected = row; recipeEditor = true }.disabled(!writable) }.width(150)
            }.frame(minHeight: 380).tableSurface()
        }
    }
    private var backupContent: some View {
        ManagementPanel("ຄວາມພ້ອມຂອງຂໍ້ມູນສຳຮອງ") {
            let backup = state.data["backup"]
            StatusLabel(backup["ok"].bool ? "ພ້ອມ" : "ຕ້ອງກວດກາ", tone: backup["ok"].bool ? .success : .warning)
            LabeledContent("ອາຍຸຂໍ້ມູນສຳຮອງ", value: backup["ageHours"] == .null ? "ບໍ່ພົບຫຼັກຖານ" : "\(backup.text("ageHours")) ຊົ່ວໂມງ")
            LabeledContent("ກວດກາກູ້ຄືນ", value: backup["restoreVerified"].bool ? "ຜ່ານການກວດ" : "ຍັງບໍ່ຢືນຢັນ")
            ForEach(Array(backup["reasons"].array.enumerated()), id: \.offset) { _, reason in Label(mgBackupReason(reason.text), systemImage: "exclamationmark.triangle").foregroundStyle(Theme.muted) }
            Text("ສະຖານະອ້າງອີງຈາກຫຼັກຖານສຳຮອງຂອງລະບົບ. ການເປີດໜ້ານີ້ບໍ່ໄດ້ສ້າງ ຫຼືກູ້ຄືນຖານຂໍ້ມູນ.").font(Theme.font(12)).foregroundStyle(Theme.muted)
        }
    }
    @ViewBuilder private var catalogEditor: some View {
        if editor == "products" {
            let row = selected
            let fields = productFields(editing: row != nil)
            NativeEditor(title: row == nil ? "ສ້າງສິນຄ້າ" : "ແກ້ໄຂສິນຄ້າ", fields: fields, initial: row.map { item in Dictionary(uniqueKeysWithValues: ["code", "name", "sizeDescription", "retailPrice", "shelfLifeDays", "isActive"].map { ($0, item.text($0)) }) } ?? ["shelfLifeDays": "21"]) { values in
                var body = mgBody(values).object; body["retailPrice"] = .string(try canonicalDecimal(values["retailPrice", default: ""]))
                body["shelfLifeDays"] = .number(Decimal(try mgPositiveInteger(values["shelfLifeDays", default: ""], maximum: 3650)))
                if let row {
                    body["isActive"] = .bool(values["isActive"] == "true")
                    body = mgEditPatch(original: row, values: body, numeric: ["retailPrice", "shelfLifeDays"], nullable: ["sizeDescription"])
                    guard !body.isEmpty else { model.showNotice("ບໍ່ມີຄ່າທີ່ປ່ຽນ"); return }
                } else if values["sizeDescription", default: ""].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { body["sizeDescription"] = .null }
                _ = try await model.mutate(row.map { "/api/products/\($0.id)" } ?? "/api/products", body: .object(body), method: row == nil ? "POST" : "PATCH")
                model.showNotice("ບັນທຶກສິນຄ້າແລ້ວ"); await state.refresh()
            }
        } else {
            let row = selected
            let fields = materialFields(editing: row != nil)
            let initial = row.map { item in ["code": item.text("code"), "name": item.text("name"), "category": item.text("category"), "unit": item.text("unit"), "minStock": item.text("minStockAlert"), "avgCostPerUnit": item.text("avgCostPerUnit"), "isActive": item.text("isActive")] } ?? ["category": "ingredient", "minStock": "0", "avgCostPerUnit": "0"]
            NativeEditor(title: row == nil ? "ສ້າງວັດຖຸດິບ" : "ແກ້ໄຂວັດຖຸດິບ", fields: fields, initial: initial) { values in
                var body = mgBody(values).object; body["minStock"] = .string(try canonicalDecimal(values["minStock", default: ""], scale: 3)); body["avgCostPerUnit"] = .string(try canonicalDecimal(values["avgCostPerUnit", default: ""], scale: 4))
                if let row {
                    body["isActive"] = .bool(values["isActive"] == "true")
                    var original = row.object; original["minStock"] = row["minStockAlert"]
                    body = mgEditPatch(original: .object(original), values: body, numeric: ["minStock", "avgCostPerUnit"])
                    guard !body.isEmpty else { model.showNotice("ບໍ່ມີຄ່າທີ່ປ່ຽນ"); return }
                }
                _ = try await model.mutate(row.map { "/api/materials/\($0.id)" } ?? "/api/materials", body: .object(body), method: row == nil ? "POST" : "PATCH")
                model.showNotice("ບັນທຶກວັດຖຸດິບແລ້ວ"); await state.refresh()
            }
        }
    }
}

private func managementActiveField() -> EditorField {
    EditorField(key: "isActive", label: "ສະຖານະ", kind: .choice([EditorChoice(id: "true", label: "ເປີດໃຊ້"), EditorChoice(id: "false", label: "ປິດໃຊ້")]), required: true)
}
private func productFields(editing: Bool) -> [EditorField] {
    let fields = [EditorField(key: "name", label: "ຊື່ສິນຄ້າ", required: true), EditorField(key: "code", label: "ລະຫັດ", required: true, help: "ຕົວຢ່າງ: YG-CHS-74").half(), EditorField(key: "sizeDescription", label: "ຂະໜາດ", help: "ຕົວຢ່າງ: 74 ml").half(), EditorField(key: "retailPrice", label: "ລາຄາຂາຍ (LAK)", kind: .money, required: true).half(), EditorField(key: "shelfLifeDays", label: "ອາຍຸສິນຄ້າ (ມື້)", kind: .integer, required: true).half()]
    return fields + (editing ? [managementActiveField().half()] : [])
}
private func materialFields(editing: Bool) -> [EditorField] {
    let fields = [EditorField(key: "name", label: "ຊື່ວັດຖຸດິບ", required: true), EditorField(key: "code", label: "ລະຫັດ", required: true, help: "ຕົວຢ່າງ: RM-SUGAR").half(), EditorField(key: "category", label: "ປະເພດ", kind: .choice([EditorChoice(id: "ingredient", label: "ສ່ວນປະກອບ"), EditorChoice(id: "packaging", label: "ບັນຈຸພັນ")]), required: true).half(), EditorField(key: "unit", label: "ໜ່ວຍ", required: true, help: "ປ່ຽນໄດ້ສະເພາະເມື່ອຍັງບໍ່ມີສະຕັອກ").half(), EditorField(key: "minStock", label: "ຈຸດແຈ້ງເຕືອນ", kind: .decimal, required: true).half(), EditorField(key: "avgCostPerUnit", label: "ຕົ້ນທຶນ / ໜ່ວຍ (LAK)", kind: .decimal, required: true).half()]
    return fields + (editing ? [managementActiveField().half()] : [])
}

private struct RecipeEditorSheet: View {
    @ObservedObject var model: AppModel
    let data: JSONValue
    let original: JSONValue?
    let saved: () async -> Void
    @State private var productId = ""
    @State private var name = ""
    @State private var baseCups = "100"
    @State private var quantities: [String: String] = [:]
    @State private var baseline: JSONValue = .null
    @State private var busy = false
    @State private var error: String?
    @State private var result: JSONValue?
    @State private var submissionReconciled = false
    private var materials: [JSONValue] { data["materials"].array.filter { $0["isActive"].bool || quantities[$0.id] != nil } }
    private var products: [JSONValue] { data["products"].array.filter { $0["isActive"].bool } }
    private var draftKey: String { "recipe.\(original?.id ?? "new")" }
    private var form: JSONValue { .object(["productId": .string(productId), "name": .string(name), "baseCups": .string(baseCups), "quantities": mgBody(quantities)]) }
    var body: some View {
        ManagementSheet(original == nil ? "ສ້າງສູດ" : "ສ້າງສະບັບສູດໃໝ່", dirty: baseline != .null && form != baseline && result == nil, busy: busy) {
            VStack(alignment: .leading, spacing: 24) {
                if products.isEmpty || materials.isEmpty { EmptyNotice(title: "ຂໍ້ມູນສຳລັບສູດຍັງບໍ່ຄົບ", detail: "ສ້າງສິນຄ້າ ແລະວັດຖຸດິບກ່ອນ", symbol: "list.bullet.clipboard") }
                else {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("ສິນຄ້າ")
                        Picker("ສິນຄ້າ", selection: $productId) { ForEach(products) { Text($0.text("name")).tag($0.id) } }.labelsHidden().disabled(original != nil)
                        LabeledContent("ຊື່ສູດ") { TextField("ຊື່ສູດ", text: $name).textFieldStyle(.roundedBorder) }
                        LabeledContent("ຖ້ວຍພື້ນຖານ") { TextField("100", text: $baseCups).textFieldStyle(.roundedBorder).accessibilityLabel("ຖ້ວຍພື້ນຖານ") }
                    }.controlSize(.large).disabled(busy || result != nil || submissionReconciled)
                    ManagementPanel("ວັດຖຸດິບໃນສູດ", color: Theme.purple) {
                        Text("ເລືອກວັດຖຸດິບ ແລະໃສ່ຈຳນວນສຳລັບຖ້ວຍພື້ນຖານ · ທົດສະນິຍົມ 4 ຕຳແໜ່ງ").font(Theme.font(12)).foregroundStyle(Theme.muted)
                        ForEach(materials) { material in
                            HStack(spacing: 16) {
                                Toggle(material.text("name") + (material["isActive"].bool ? "" : " · ປິດໃຊ້"), isOn: Binding(get: { quantities[material.id] != nil }, set: { if $0 { quantities[material.id] = "1" } else { quantities.removeValue(forKey: material.id) } })).frame(maxWidth: .infinity, alignment: .leading)
                                if quantities[material.id] != nil { TextField("ຈຳນວນ", text: Binding(get: { quantities[material.id, default: ""] }, set: { quantities[material.id] = $0 })).textFieldStyle(.roundedBorder).accessibilityLabel("ຈຳນວນ \(material.text("name"))").frame(width: 150); Text(material.text("unit")).frame(width: 70, alignment: .leading) }
                            }.controlSize(.large).disabled(busy || result != nil || submissionReconciled)
                            // A checkbox keeps its name beside it, not stacked like the form labels.
                            .toggleStyle(.checkbox).labeledContentStyle(.automatic)
                        }
                    }
                    Text("ການບັນທຶກຈະສ້າງສະບັບໃໝ່ ແລະຕັ້ງເປັນສູດຫຼັກສຳລັບການຜະລິດຕໍ່ໄປ. ລັອດເກົ່າຍັງໃຊ້ສູດເກົ່າ.").foregroundStyle(Theme.muted)
                    ManagementFeedback(error: error, success: result.map { "ສ້າງສູດສະບັບ \($0.text("version")) ແລ້ວ · \($0.id)" })
                    HStack { Spacer(); Button("ສ້າງສະບັບ ແລະຕັ້ງເປັນສູດຫຼັກ") { Task { await save() } }.buttonStyle(.borderedProminent).controlSize(.large).disabled(busy || quantities.isEmpty || result != nil || submissionReconciled) }
                    if submissionReconciled { Text("ລາຍການເດີມຖືກກວດກາແລ້ວ. ໂຫຼດສູດລ່າສຸດເພື່ອກວດຜົນ.") }
                    if result != nil || submissionReconciled { Button("ເລີ່ມສະບັບສູດໃໝ່") { Task { do { try await model.removeDraft(key: draftKey, startNewIntent: true); result = nil; submissionReconciled = false; error = nil } catch { self.error = error.localizedDescription } } }.disabled(busy) }
                }
            }
        }
        .task {
            productId = original?.text("finishedProductId") ?? products.first?.id ?? ""; name = original?.text("name") ?? ""; baseCups = original?.text("baseCups") ?? "100"
            if let original { quantities = Dictionary(uniqueKeysWithValues: original["items"].array.map { ($0.text("rawMaterialId"), $0.text("quantityRequired")) }) }
            baseline = form
            do {
                if let draft = try await model.loadDraft(key: draftKey) {
                    productId = draft.text("productId"); name = draft.text("name"); baseCups = draft.text("baseCups")
                    quantities = draft["quantities"].object.mapValues(\.text)
                    if draft["persistedResult"] != .null { result = draft["persistedResult"] }
                    submissionReconciled = draft.text("nativeOutcome") == "reconciled"
                    error = "ກູ້ຄືນຮ່າງສູດແລ້ວ. ກວດຈຳນວນກ່ອນສ້າງສະບັບໃໝ່."
                }
            } catch { self.error = error.localizedDescription }
        }
        .onChange(of: form) { _, _ in Task { await persistDraft() } }
    }
    private func persistDraft() async {
        guard baseline != .null, result == nil, !submissionReconciled else { return }
        do { if form == baseline { try await model.removeDraft(key: draftKey) } else { try await model.saveDraft(key: draftKey, body: form) } }
        catch { self.error = "ບັນທຶກຮ່າງບໍ່ໄດ້ · \(error.localizedDescription)" }
    }
    private func save() async {
        guard result == nil, !submissionReconciled, !busy else { return }
        busy = true; error = nil; defer { busy = false }
        do {
            let count = try mgPositiveInteger(baseCups)
            let items = try quantities.keys.sorted().map { id -> JSONValue in
                guard data["materials"].array.contains(where: { $0.id == id && $0["isActive"].bool }) else { throw mgError("ກະລຸນາເອົາວັດຖຸດິບທີ່ປິດໃຊ້ອອກຈາກສູດ") }
                let amount = try canonicalDecimal(quantities[id, default: ""], scale: 4)
                guard (Decimal(string: amount) ?? 0) > 0 else { throw mgError("ຈຳນວນວັດຖຸດິບທຸກລາຍການຕ້ອງຫຼາຍກວ່າ 0") }
                return .object(["rawMaterialId": .string(id), "quantityRequired": .string(amount)])
            }
            var body: [String: JSONValue] = ["finishedProductId": .string(productId), "name": .string(name), "baseCups": .number(Decimal(count)), "items": .array(items)]
            if let original { body["recipeId"] = .string(original.id) }
            try await model.saveDraft(key: draftKey, body: form)
            result = try await model.mutate("/api/recipes", body: .object(body), draftKey: draftKey)
            do {
                var draft = form.object; draft["persistedResult"] = result
                try await model.saveDraft(key: draftKey, body: .object(draft)); try await model.removeDraft(key: draftKey)
            } catch { self.error = "ສູດບັນທຶກແລ້ວ ແຕ່ລ້າງຮ່າງບໍ່ໄດ້ · \(error.localizedDescription)" }
            await saved()
        } catch { self.error = error.localizedDescription }
    }
}

private struct DailyClosingSheet: View {
    @ObservedObject var model: AppModel
    @State private var date = Date()
    @State private var pendingDate: Date?
    @State private var fields = ["cashAmount": "0.00", "bankAmount": "0.00", "expenseAmount": "0.00", "note": ""]
    @State private var baseline: [String: String] = [:]
    @State private var snapshot: JSONValue = .null
    @State private var loadedDate = ""
    @State private var loading = false
    @State private var busy = false
    @State private var error: String?
    @State private var result: JSONValue?
    @State private var submissionReconciled = false
    @State private var confirmReload = false
    private var dirty: Bool { !baseline.isEmpty && fields != baseline && result == nil }
    private var dateString: String { businessDateString(date) }
    private func binding(_ key: String) -> Binding<String> { Binding(get: { fields[key, default: ""] }, set: { fields[key] = $0 }) }
    var body: some View {
        ManagementSheet("ປິດຍອດປະຈຳວັນ", dirty: dirty, busy: busy || loading) {
            VStack(alignment: .leading, spacing: 24) {
                HStack {
                    DatePicker("ວັນທີປິດຍອດ", selection: Binding(get: { date }, set: { next in if dirty { pendingDate = next; confirmReload = true } else { date = next; Task { await load() } } }), displayedComponents: .date).environment(\.timeZone, TimeZone(identifier: "Asia/Vientiane")!)
                    Spacer(); Button("ໂຫຼດຍອດລ່າສຸດ", systemImage: "arrow.clockwise") { pendingDate = nil; confirmReload = true }
                }.controlSize(.large).disabled(busy || loading)
                if loading { ProgressView("ກຳລັງໂຫຼດຍອດຂອງວັນທີ \(dateString)…") }
                if loadedDate == dateString {
                    ManagementPanel("ຍອດຂອງວັນທີ \(loadedDate)", color: Theme.mango) {
                        StatusLabel(snapshot == .null ? "ຍັງບໍ່ມີຍອດປິດ" : "ໂຫຼດຍອດເດີມແລ້ວ", tone: .info)
                        LabeledContent("ເງິນສົດ (LAK)") { TextField("0.00", text: binding("cashAmount")).accessibilityLabel("ເງິນສົດ LAK") }
                        LabeledContent("ເງິນໂອນ (LAK)") { TextField("0.00", text: binding("bankAmount")).accessibilityLabel("ເງິນໂອນ LAK") }
                        LabeledContent("ລາຍຈ່າຍ (LAK)") { TextField("0.00", text: binding("expenseAmount")).accessibilityLabel("ລາຍຈ່າຍ LAK") }
                        VStack(alignment: .leading, spacing: 8) { Text("ໝາຍເຫດ"); TextEditor(text: binding("note")).accessibilityLabel("ໝາຍເຫດ").frame(height: 90).padding(8).overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.border)) }
                    }.textFieldStyle(.roundedBorder).controlSize(.large).disabled(busy || loading || result != nil || submissionReconciled)
                    Text("ຕ້ອງໂຫຼດຍອດຂອງວັນທີນັ້ນກ່ອນບັນທຶກ. ຖ້າຍອດຖືກປ່ຽນໂດຍຜູ້ອື່ນ ລະບົບຈະຂໍໃຫ້ໂຫຼດ ແລະກວດຄືນ.").foregroundStyle(Theme.muted)
                    HStack {
                        Text("ລວມເງິນຮັບ"); AmountText((Decimal(string: fields["cashAmount", default: ""]) ?? 0) + (Decimal(string: fields["bankAmount", default: ""]) ?? 0)).font(Theme.font(20, weight: .semibold))
                        Spacer(); Button("ຢືນຢັນປິດຍອດ") { Task { await save() } }.buttonStyle(.borderedProminent).controlSize(.large).disabled(busy || loading || result != nil || submissionReconciled || !model.canWrite)
                    }
                }
                ManagementFeedback(error: error, success: result.map { "ປິດຍອດ \(loadedDate) ແລ້ວ · \($0.id)" })
                if submissionReconciled { Text("ລາຍການເດີມຖືກກວດກາແລ້ວ. ໂຫຼດຍອດລ່າສຸດກ່ອນແກ້ໄຂໃໝ່.") }
                if let result { ManagementPanel("ຍອດທີ່ບັນທຶກແລ້ວ", color: Theme.green) { LabeledContent("ເງິນສົດ") { MoneyText(result["snapshot"]["cashAmount"]) }; LabeledContent("ເງິນໂອນ") { MoneyText(result["snapshot"]["bankAmount"]) }; LabeledContent("ລາຍຈ່າຍ") { MoneyText(result["snapshot"]["expenseAmount"]) } } }
            }
        }
        .task { await load() }
        .confirmationDialog("ໂຫຼດຍອດແລະລ້າງຄ່າທີ່ແກ້ໄຂ?", isPresented: $confirmReload, titleVisibility: .visible) {
            Button("ໂຫຼດຍອດລ່າສຸດ", role: .destructive) { if let pendingDate { date = pendingDate }; pendingDate = nil; Task { await load(ignoreDraft: true) } }
            Button("ສືບຕໍ່ແກ້ໄຂ", role: .cancel) { pendingDate = nil }
        } message: { Text("ກວດຄ່າທີ່ຍັງບໍ່ໄດ້ບັນທຶກກ່ອນໂຫຼດຄືນ") }
        .onChange(of: fields) { _, _ in Task { await persistDraft() } }
    }
    private func load(ignoreDraft: Bool = false) async {
        let requested = dateString; loading = true; error = nil; result = nil; submissionReconciled = false
        defer { loading = false }
        do {
            let response = try await model.read("closing", query: ["date": requested])
            guard response.source == "database", response.data.text("closingDate") == requested else { throw mgError("ໂຫຼດຍອດເກົ່າບໍ່ໄດ້. ລອງໃໝ່ກ່ອນບັນທຶກ") }
            guard requested == dateString else { return }
            snapshot = response.data["snapshot"]; loadedDate = requested
            for key in ["cashAmount", "bankAmount", "expenseAmount"] { fields[key] = snapshot == .null ? "0.00" : snapshot.text(key) }
            fields["note"] = snapshot.text("note"); baseline = fields
            if ignoreDraft { try await model.removeDraft(key: "closing.\(requested)", startNewIntent: true) }
            else if let draft = try await model.loadDraft(key: "closing.\(requested)") {
                if draft["persistedResult"] != .null { result = draft["persistedResult"] }
                submissionReconciled = draft.text("nativeOutcome") == "reconciled"
                snapshot = draft["snapshot"]
                let restored = draft["fields"].object.mapValues(\.text)
                if !restored.isEmpty { fields = restored; error = "ກູ້ຄືນຮ່າງທີ່ຍັງບໍ່ບັນທຶກແລ້ວ. ກວດຄ່າກ່ອນຢືນຢັນ." }
            }
        } catch { self.error = error.localizedDescription }
    }
    private func persistDraft() async {
        guard !loading, loadedDate == dateString, result == nil, !submissionReconciled else { return }
        do { if dirty { try await model.saveDraft(key: "closing.\(loadedDate)", body: .object(["snapshot": snapshot, "fields": mgBody(fields)])) } else { try await model.removeDraft(key: "closing.\(loadedDate)") } }
        catch { self.error = "ບັນທຶກຮ່າງໃນເຄື່ອງບໍ່ໄດ້ · \(error.localizedDescription)" }
    }
    private func save() async {
        guard loadedDate == dateString, !loading, !busy, result == nil, !submissionReconciled else { return }; busy = true; error = nil; defer { busy = false }
        do {
            var body = mgBody(fields).object
            for key in ["cashAmount", "bankAmount", "expenseAmount"] { body[key] = .string(try canonicalDecimal(fields[key, default: ""])) }
            body["closingDate"] = .string(loadedDate); body["expectedSnapshot"] = snapshot
            try await model.saveDraft(key: "closing.\(loadedDate)", body: .object(["snapshot": snapshot, "fields": mgBody(fields)]))
            result = try await model.mutate("/api/daily-closing", body: .object(body), draftKey: "closing.\(loadedDate)")
            baseline = fields; try await model.removeDraft(key: "closing.\(loadedDate)")
        } catch { self.error = error.localizedDescription }
    }
}

struct FridgesView: View {
    @ObservedObject var model: AppModel
    @StateObject private var state = FeatureState()
    @State private var query = ""
    @State private var filter = "all"
    @State private var selected: JSONValue?
    private var rows: [JSONValue] { state.data["fridges"].array.filter { mgContains($0, query, keys: ["assetCode", "serialNo", "model", "storeName"]) && (filter == "all" || (filter == "unassigned" ? $0.text("storeId").isEmpty : $0.text("status") == filter)) } }
    var body: some View {
        Workspace(title: "ຕູ້ແຊ່", subtitle: "ຊັບສິນ, ຮ້ານທີ່ຕິດຕັ້ງ ແລະບຳລຸງຮັກສາ", domain: .stores) {
            Button("CSV") { model.exportCSV(name: "fridges", headers: ["ລະຫັດ", "ຮຸ່ນ", "Serial", "ຄວາມຈຸ", "ຮ້ານ", "ສະຕັອກ", "ສະຖານະ"], rows: rows.map { row in ["assetCode", "model", "serialNo", "capacityCups", "storeName", "stockTotal", "status"].map { row.text($0) } }) }.disabled(rows.isEmpty)
            Button("ໂຫຼດຄືນ", systemImage: "arrow.clockwise") { Task { await state.refresh() } }
        } content: {
            ReadStateView(state: state) {
                HStack {
                    TextField("ຄົ້ນຫາຕູ້ / ຮ້ານ / Serial", text: $query).textFieldStyle(.roundedBorder)
                    Picker("ສະຖານະ", selection: $filter) { Text("ທັງໝົດ").tag("all"); Text("ປົກກະຕິ").tag("active"); Text("ບຳລຸງຮັກສາ").tag("maintenance"); Text("ຍັງບໍ່ຜູກຮ້ານ").tag("unassigned") }.frame(width: 240)
                }.controlSize(.large)
                if rows.isEmpty { EmptyNotice(title: "ບໍ່ພົບຕູ້ແຊ່", detail: "ປ່ຽນຄຳຄົ້ນຫາ ຫຼືຕົວກອງ", symbol: "refrigerator") }
                else {
                    Table(rows) {
                        TableColumn("ຕູ້") { row in VStack(alignment: .leading) { Text(row.text("assetCode")); Text("\(row.text("model")) · \(row.text("serialNo"))").font(Theme.font(12)).foregroundStyle(Theme.muted) } }.width(min: 180)
                        TableColumn("ຮ້ານ") { row in Text(row.text("storeName").isEmpty ? "ຍັງບໍ່ຜູກຮ້ານ" : row.text("storeName")) }
                        TableColumn("ຄົງເຫຼືອ / ຄວາມຈຸ") { Text("\($0.text("stockTotal")) / \($0.text("capacityCups")) ຖ້ວຍ").monospacedDigit() }
                        TableColumn("ສະຖານະ") { row in StatusLabel(row.text("status") == "maintenance" ? "ບຳລຸງຮັກສາ" : "ປົກກະຕິ", tone: row.text("status") == "maintenance" ? .warning : .success) }
                        TableColumn("ຈັດການ") { row in Button("ຈັດການ") { selected = row }.disabled(!model.canWrite || state.source != "database" || model.session?.role != "admin") }.width(100)
                    }.frame(minHeight: 380).tableSurface()
                }
            }
        }.task { await state.load(model, "fridges") }
        .sheet(item: $selected) { row in FridgeEditorSheet(model: model, fridge: row, stores: state.data["stores"].array) { await state.refresh() } }
    }
}
private struct FridgeEditorSheet: View {
    @ObservedObject var model: AppModel
    let fridge: JSONValue
    let stores: [JSONValue]
    let saved: () async -> Void
    @State private var fields: [String: String] = [:]
    @State private var baseline: [String: String] = [:]
    @State private var busy = false
    @State private var error: String?
    @State private var result: JSONValue?
    @State private var requiresReconciliation = false
    private var draftKey: String { "fridge.\(fridge.id)" }
    private var blocked: Bool {
        fridge["stockTotal"].decimal > 0 && (fields["currentStoreId", default: ""] != fridge.text("storeId") || (fields["status"] == "maintenance" && fridge.text("status") != "maintenance"))
    }
    private func binding(_ key: String) -> Binding<String> { Binding(get: { fields[key, default: ""] }, set: { fields[key] = $0 }) }
    var body: some View {
        ManagementSheet("ຈັດການ \(fridge.text("assetCode"))", dirty: fields != baseline && result == nil, busy: busy) {
            VStack(alignment: .leading, spacing: 24) {
                if fridge["stockTotal"].decimal > 0 { Label("ມີສິນຄ້າ \(fridge.text("stockTotal")) ຖ້ວຍ · ຕ້ອງໃຫ້ເຫຼືອ 0 ກ່ອນຍ້າຍ ຫຼືເຂົ້າບຳລຸງ", systemImage: "exclamationmark.triangle").foregroundStyle(Theme.muted) }
                ManagementPanel("ຂໍ້ມູນຕູ້") {
                    LabeledContent("ລະຫັດຕູ້ *") { TextField("ລະຫັດຕູ້", text: binding("assetCode")) }
                    LabeledContent("Serial") { TextField("Serial", text: binding("serialNo")) }
                    LabeledContent("ຮຸ່ນ") { TextField("ຮຸ່ນ", text: binding("model")) }
                    LabeledContent("ຄວາມຈຸ (ຖ້ວຍ) *") { TextField("ຄວາມຈຸ", text: binding("capacityCups")) }
                    Picker("ສະຖານະ", selection: binding("status")) { Text("ປົກກະຕິ").tag("active"); Text("ບຳລຸງຮັກສາ").tag("maintenance") }
                    Picker("ຮ້ານທີ່ຕິດຕັ້ງ", selection: binding("currentStoreId")) { Text("ບໍ່ຜູກຮ້ານ").tag(""); ForEach(stores) { Text($0.text("name")).tag($0.id) } }
                }.textFieldStyle(.roundedBorder).controlSize(.large).disabled(busy || result != nil || requiresReconciliation)
                Text("ບໍ່ສາມາດຫຼຸດຄວາມຈຸຕ່ຳກວ່າສະຕັອກ. ຮ້ານເດີມຕ້ອງຊຳລະຍອດຄ້າງກ່ອນຍ້າຍຕູ້ ແລະຮ້ານປາຍທາງຕ້ອງຍັງບໍ່ມີຕູ້.").font(Theme.font(12)).foregroundStyle(Theme.muted)
                if blocked { Label("ຍັງຍ້າຍຕູ້ ຫຼືເຂົ້າບຳລຸງບໍ່ໄດ້: ມີສິນຄ້າຄົງເຫຼືອ", systemImage: "exclamationmark.triangle").foregroundStyle(Theme.danger) }
                ManagementFeedback(error: error, success: result.map { $0["reconciled"].bool ? "ກວດຂໍ້ມູນຕູ້ \($0.text("assetCode")) ລ່າສຸດແລ້ວ" : "ບັນທຶກຕູ້ \($0.text("assetCode")) ແລ້ວ" })
                if result != nil || requiresReconciliation { Button("ໂຫຼດຕູ້ລ່າສຸດເພື່ອແກ້ໄຂໃໝ່") { Task { await beginNewIntent() } }.disabled(busy) }
                if requiresReconciliation {
                    Text("ການແກ້ໄຂຕູ້ບໍ່ຮອງຮັບການສົ່ງຊ້ຳອັດຕະໂນມັດ. ກວດຂໍ້ມູນລ່າສຸດກ່ອນເຮັດຕໍ່.").foregroundStyle(Theme.muted)
                    Button("ກວດຜົນການບັນທຶກ", systemImage: "arrow.clockwise") { Task { await reconcile() } }.disabled(busy)
                } else {
                    HStack { Spacer(); Button("ບັນທຶກຕູ້ແຊ່") { Task { await save() } }.buttonStyle(.borderedProminent).controlSize(.large).disabled(busy || blocked || result != nil || fields == baseline) }
                }
            }
        }.task {
            fields = initial(fridge); baseline = fields
            do {
                if let draft = try await model.loadDraft(key: draftKey) {
                    let restored = draft["fields"].object.mapValues(\.text)
                    if draft["persistedResult"] != .null { result = draft["persistedResult"] }
                    if !restored.isEmpty { fields = restored; requiresReconciliation = result == nil && draft["uncertain"].bool; error = "ກູ້ຄືນຮ່າງຕູ້ແຊ່ແລ້ວ. ກວດຮ້ານ, ສະຕັອກ ແລະສະຖານະກ່ອນບັນທຶກ." }
                }
            } catch { self.error = error.localizedDescription }
        }
        .onChange(of: fields) { _, _ in Task { await persistDraft() } }
    }
    private func persistDraft() async {
        guard !baseline.isEmpty, !busy, result == nil else { return }
        do {
            if fields == baseline && !requiresReconciliation { try await model.removeDraft(key: draftKey) }
            else { try await model.saveDraft(key: draftKey, body: .object(["fields": mgBody(fields), "uncertain": .bool(requiresReconciliation)])) }
        } catch { self.error = "ບັນທຶກຮ່າງບໍ່ໄດ້ · \(error.localizedDescription)" }
    }
    private func initial(_ row: JSONValue) -> [String: String] {
        ["assetCode": row.text("assetCode"), "serialNo": row.text("serialNo") == "—" ? "" : row.text("serialNo"), "model": row.text("model") == "—" ? "" : row.text("model"), "capacityCups": row.text("capacityCups"), "status": row.text("status"), "currentStoreId": row.text("storeId")]
    }
    private func save() async {
        busy = true; error = nil; defer { busy = false }
        do {
            guard !fields["assetCode", default: ""].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw mgError("ກະລຸນາໃສ່ລະຫັດຕູ້") }
            let capacity = try mgPositiveInteger(fields["capacityCups", default: ""], maximum: 1000000)
            guard Decimal(capacity) >= fridge["stockTotal"].decimal else { throw mgError("ຄວາມຈຸຕ່ຳກວ່າສະຕັອກ") }
            var body = mgBody(fields).object; body["capacityCups"] = .number(Decimal(capacity))
            try await model.saveDraft(key: draftKey, body: .object(["fields": mgBody(fields), "uncertain": .bool(true)]))
            do { result = try await model.mutate("/api/fridges/\(fridge.id)", body: .object(body), method: "PATCH", durable: false, draftKey: draftKey) }
            catch { requiresReconciliation = true; throw error }
            baseline = fields
            do { try await model.removeDraft(key: draftKey) } catch { self.error = "ຕູ້ບັນທຶກແລ້ວ ແຕ່ລ້າງຮ່າງບໍ່ໄດ້ · \(error.localizedDescription)" }
            await saved()
        } catch { self.error = error.localizedDescription }
    }
    private func normalized(_ values: [String: String]) -> [String: String] {
        var result = values.mapValues { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        if let capacity = Int(result["capacityCups", default: ""]) { result["capacityCups"] = String(capacity) }
        return result
    }
    private func beginNewIntent() async {
        busy = true; defer { busy = false }
        do {
            let response = try await model.read("fridges")
            guard response.source == "database", let latest = response.data["fridges"].array.first(where: { $0.id == fridge.id }) else { throw mgError("ໂຫຼດຂໍ້ມູນຕູ້ລ່າສຸດບໍ່ໄດ້") }
            try await model.removeDraft(key: draftKey, startNewIntent: true)
            fields = initial(latest); baseline = fields; result = nil; requiresReconciliation = false; error = nil
            await saved()
        } catch { self.error = error.localizedDescription }
    }
    private func reconcile() async {
        busy = true; defer { busy = false }
        do {
            let response = try await model.read("fridges")
            guard response.source == "database", let latest = response.data["fridges"].array.first(where: { $0.id == fridge.id }) else { throw mgError("ຍັງກວດຜົນບໍ່ໄດ້. ລອງໃໝ່") }
            if normalized(initial(latest)) == normalized(fields) {
                if let command = model.pendingCommands.first(where: { $0.path == "/api/fridges/\(fridge.id)" && $0.method == "PATCH" && !$0.durable }) {
                    let submitted = try JSONDecoder().decode(JSONValue.self, from: command.body)
                    let submittedFields = Dictionary(uniqueKeysWithValues: fields.keys.map { ($0, submitted.text($0)) })
                    guard normalized(submittedFields) == normalized(fields) else { throw mgError("ມີລາຍການຕູ້ນີ້ຄ້າງຢູ່ທີ່ໃຊ້ຄ່າຕ່າງກັນ. ເປີດລາຍການຄ້າງເພື່ອກວດກາ") }
                    try await model.confirmReconciled(command)
                }
                result = .object(["assetCode": latest["assetCode"], "reconciled": .bool(true)])
                baseline = fields; requiresReconciliation = false; error = nil
                try await model.removeDraft(key: draftKey, startNewIntent: true); await saved()
            } else { error = "ຂໍ້ມູນລ່າສຸດຍັງບໍ່ກົງກັບທີ່ສົ່ງ. ປິດແບບຟອມ, ໂຫຼດລາຍການຄືນ ແລະກວດກ່ອນແກ້ໄຂອີກຄັ້ງ."; await saved() }
        } catch { self.error = error.localizedDescription }
    }
}

struct NotificationsView: View {
    @ObservedObject var model: AppModel
    @StateObject private var state = FeatureState()
    @State private var filter = "all"
    private var alerts: [JSONValue] { state.data["alerts"].array.filter { filter == "all" || $0.text("type") == filter } }
    var body: some View {
        Workspace(title: "ແຈ້ງເຕືອນ", subtitle: "ລາຍການທີ່ຕ້ອງຈັດການຕາມສິດຂອງທ່ານ", domain: .operations) {
            Button("ໂຫຼດຄືນ", systemImage: "arrow.clockwise") { Task { await state.refresh() } }
        } content: {
            ReadStateView(state: state) {
                Picker("ຄວາມສຳຄັນ", selection: $filter) { Text("ທັງໝົດ").tag("all"); Text("ດ່ວນ").tag("urgent"); Text("ຄວນກວດກາ").tag("warning"); Text("ຂໍ້ມູນ").tag("info") }.pickerStyle(.segmented).frame(maxWidth: 560).controlSize(.large)
                if alerts.isEmpty { EmptyNotice(title: "ບໍ່ມີແຈ້ງເຕືອນໃນກຸ່ມນີ້", detail: "ເລືອກທັງໝົດເພື່ອເບິ່ງລາຍການອື່ນ", symbol: "checkmark.circle") }
                ForEach(alerts) { alert in
                    HStack(alignment: .top, spacing: 16) {
                        Image(systemName: alert.id == "all-clear" ? "checkmark.circle" : alert.text("type") == "urgent" ? "exclamationmark.circle" : alert.text("type") == "warning" ? "exclamationmark.triangle" : "info.circle").font(.system(size: 22)).foregroundStyle(alert.text("type") == "urgent" ? Theme.danger : alert.text("type") == "warning" ? Theme.mango : Theme.blue).accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 8) {
                            HStack { Text(alert.text("title")).font(Theme.font(16, weight: .semibold)); if alert.id != "all-clear" { StatusLabel(alert.text("type") == "urgent" ? "ດ່ວນ" : alert.text("type") == "warning" ? "ຄວນກວດກາ" : "ຂໍ້ມູນ", tone: alert.text("type") == "urgent" ? .danger : alert.text("type") == "warning" ? .warning : .info) } }
                            Text(alert.text("detail")).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true)
                        }.frame(maxWidth: .infinity, alignment: .leading)
                        if let target = target(alert), target.destination.isAllowed(role: model.session?.role ?? "") {
                            Button("ເປີດ\(target.destination.title)", systemImage: "arrow.right") { model.navigate(target.destination, storeId: target.storeId) }.controlSize(.large)
                        }
                    }.padding(16).background(Theme.surface, in: RoundedRectangle(cornerRadius: 10)).overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.border))
                }
            }
        }.task { await state.load(model, "notifications") }
    }
    private func target(_ alert: JSONValue) -> (destination: Destination, storeId: String?)? {
        let path = alert.text("href").split(separator: "?").first.map(String.init) ?? ""
        let parts = path.split(separator: "/").map(String.init)
        if parts.isEmpty { return (.overview, nil) }
        if parts.first == "driver" { return (.driver, parts.count > 2 && parts[1] == "restock" ? parts[2] : nil) }
        if parts.first == "stores" { return (.stores, parts.count > 1 ? parts[1] : nil) }
        if parts.first == "audit-log" { return (.audit, nil) }
        guard let destination = Destination(rawValue: parts[0]) else { return nil }
        return (destination, nil)
    }
}

private struct AuditChange: Identifiable {
    let field: String
    let before: String
    let after: String
    var id: String { field }
}
private let auditFieldLabels: [String: String] = [
    "name": "ຊື່", "code": "ລະຫັດ", "category": "ປະເພດ", "amount": "ຈຳນວນເງິນ", "incurredAt": "ວັນທີລາຍຈ່າຍ", "storeId": "ຮ້ານ", "note": "ໝາຍເຫດ", "receiptUrl": "ຫຼັກຖານ", "stock": "ຄົງເຫຼືອ", "currentStock": "ຄົງເຫຼືອ", "minStock": "ຈຸດເຕືອນ", "cost": "ຕົ້ນທຶນ", "avgCostPerUnit": "ຕົ້ນທຶນ / ໜ່ວຍ", "unit": "ໜ່ວຍ", "retailPrice": "ລາຄາຂາຍ", "shelfLifeDays": "ອາຍຸສິນຄ້າ", "isActive": "ເປີດໃຊ້", "status": "ສະຖານະ", "assetCode": "ລະຫັດຕູ້", "capacityCups": "ຄວາມຈຸ", "currentStoreId": "ຮ້ານທີ່ຕິດຕັ້ງ", "cashAmount": "ເງິນສົດ", "bankAmount": "ເງິນໂອນ", "expenseAmount": "ລາຍຈ່າຍ", "closingDate": "ວັນປິດຍອດ", "closingBalance": "ຍອດຄ້າງ", "paidAmount": "ເງິນຮັບ", "commissionRate": "ອັດຕາສ່ວນແບ່ງ", "monthlyElectricity": "ງົບຄ່າໄຟ", "address": "ທີ່ຢູ່", "phone": "ໂທ", "contactName": "ຜູ້ຕິດຕໍ່", "voidedAt": "ວັນຍົກເລີກ", "voidReason": "ເຫດຜົນຍົກເລີກ", "quantity": "ຈຳນວນ", "reason": "ເຫດຜົນ", "delta": "ຈຳນວນປັບ", "beforeStock": "ຄົງເຫຼືອກ່ອນ", "afterStock": "ຄົງເຫຼືອຫຼັງ", "batchNumber": "ລັອດ", "unitCost": "ຕົ້ນທຶນ / ຖ້ວຍ", "costKnown": "ຮູ້ຕົ້ນທຶນ", "role": "ສິດ", "fullName": "ຊື່ຜູ້ໃຊ້"
]
private func mgAuditValue(_ value: JSONValue) -> String {
    switch value {
    case .null: return "—"
    case .bool(let value): return value ? "ແມ່ນ" : "ບໍ່"
    case .array(let values): return "\(values.count) ລາຍການ"
    case .object(let object): return object["name"]?.text ?? object["fullName"]?.text ?? "\(object.count) ລາຍລະອຽດ"
    default: return value.text.isEmpty ? "—" : value.text
    }
}
private func mgAuditChanges(_ metadata: JSONValue) -> [AuditChange] {
    let before = metadata["before"], after = metadata["after"]
    if !before.object.isEmpty || !after.object.isEmpty {
        return Set(before.object.keys).union(after.object.keys).sorted().compactMap { key in
            before[key] == after[key] ? nil : AuditChange(field: key, before: mgAuditValue(before[key]), after: mgAuditValue(after[key]))
        }
    }
    if metadata["beforeStock"] != .null || metadata["afterStock"] != .null { return [AuditChange(field: "stock", before: mgAuditValue(metadata["beforeStock"]), after: mgAuditValue(metadata["afterStock"]))] }
    if before != .null || after != .null { return [AuditChange(field: "stock", before: mgAuditValue(before), after: mgAuditValue(after))] }
    return []
}
private func mgAuditAction(_ action: String) -> String {
    ["create": "ສ້າງ", "update": "ແກ້ໄຂ", "adjust": "ປັບຈຳນວນ", "receive": "ຮັບເຂົ້າ", "void": "ຍົກເລີກ", "waste": "ຂອງເສຍ", "recipe_version": "ສະບັບສູດ", "close_day": "ປິດຍອດ", "pay": "ຮັບເງິນ", "archive": "ປິດໃຊ້", "complete": "ສຳເລັດ"][action] ?? action
}

struct AuditView: View {
    @ObservedObject var model: AppModel
    @StateObject private var state = FeatureState()
    @State private var query = ""
    @State private var filter = "all"
    @State private var page = 1
    @State private var detail: JSONValue?
    @State private var exporting = false
    private var logs: [JSONValue] { state.data["logs"].array }
    var body: some View {
        Workspace(title: "ປະຫວັດການປ່ຽນແປງ", subtitle: "ຜູ້ດຳເນີນການ, ລາຍການ ແລະຄ່າກ່ອນ / ຫຼັງ", domain: .operations) {
            Button(exporting ? "ກຳລັງສົ່ງອອກ…" : "ສົ່ງອອກ CSV", systemImage: "square.and.arrow.up") { Task { await export() } }.disabled(logs.isEmpty || exporting)
            Button("ໂຫຼດຄືນ", systemImage: "arrow.clockwise") { Task { await state.refresh() } }
        } content: {
            ReadStateView(state: state) {
                HStack {
                    TextField("ຄົ້ນຫາຮ້ານ, ຜູ້ໃຊ້ ຫຼືລາຍການ", text: $query).textFieldStyle(.roundedBorder).onSubmit { page = 1; Task { await reload() } }
                    Picker("ຕົວກອງ", selection: $filter) { Text("ທັງໝົດ").tag("all"); Text("ແກ້ໄຂ").tag("update"); Text("ປັບຈຳນວນ").tag("adjust"); Text("ລາຍຈ່າຍ").tag("expense"); Text("ຜູ້ໃຊ້").tag("user") }.frame(width: 200)
                    Button("ຄົ້ນຫາ", systemImage: "magnifyingglass") { page = 1; Task { await reload() } }
                }.controlSize(.large)
                Text("\(state.data.text("total")) ລາຍການ").foregroundStyle(Theme.muted)
                if logs.isEmpty { EmptyNotice(title: "ບໍ່ພົບປະຫວັດທີ່ກົງກັນ", detail: "ປ່ຽນຄຳຄົ້ນຫາ ຫຼືຕົວກອງ", symbol: "clock.arrow.circlepath") }
                else {
                    Table(logs) {
                        TableColumn("ການປ່ຽນແປງ") { row in VStack(alignment: .leading, spacing: 4) { Text(row.text("summary")).lineLimit(2); Text("\(mgAuditAction(row.text("action"))) · \(row.text("entityType"))").font(Theme.font(12)).foregroundStyle(Theme.muted) } }.width(min: 300)
                        TableColumn("ຮ້ານ") { Text($0["store"].text("name")) }
                        TableColumn("ຜູ້ດຳເນີນການ") { row in VStack(alignment: .leading) { Text(row["user"].text("fullName")); Text(row["user"].text("role")).font(Theme.font(12)).foregroundStyle(Theme.muted) } }
                        TableColumn("ເວລາ") { Text(mgDateTime($0.text("createdAt"))).monospacedDigit() }
                        TableColumn("ລາຍລະອຽດ") { row in Button("ກວດການປ່ຽນ") { detail = row } }.width(130)
                    }.frame(minHeight: 350).tableSurface()
                }
                ManagementPagination(page: page, pages: max(1, Int(state.data["totalPages"].double))) { page = $0; Task { await reload() } }
            }
        }.task { await reload() }.onChange(of: filter) { _, _ in page = 1; Task { await reload() } }
        .sheet(item: $detail) { row in
            ManagementSheet("ລາຍລະອຽດການປ່ຽນແປງ", dirty: false, busy: false) {
                VStack(alignment: .leading, spacing: 24) {
                    Text(row.text("summary")).font(Theme.font(19, weight: .semibold)).textSelection(.enabled)
                    HStack { StatusLabel(mgAuditAction(row.text("action"))); Spacer(); Text(mgDateTime(row.text("createdAt"))).foregroundStyle(Theme.muted) }
                    LabeledContent("ຜູ້ດຳເນີນການ", value: row["user"].text("fullName")); LabeledContent("ຮ້ານ", value: row["store"].text("name")); LabeledContent("ລະຫັດລາຍການ", value: row.text("entityId"))
                    let changes = mgAuditChanges(row["metadata"])
                    if changes.isEmpty { Text("ລາຍການນີ້ບໍ່ມີຄ່າກ່ອນ / ຫຼັງທີ່ບັນທຶກໄວ້").foregroundStyle(Theme.muted) }
                    else {
                        ManagementPanel("ຄ່າທີ່ປ່ຽນ") {
                            Grid(alignment: .leading, horizontalSpacing: 20, verticalSpacing: 12) {
                                GridRow { Text("ຂໍ້ມູນ"); Text("ກ່ອນ"); Text("ຫຼັງ") }.font(Theme.font(12, weight: .semibold)).foregroundStyle(Theme.muted)
                                ForEach(changes) { change in GridRow { Text(auditFieldLabels[change.field] ?? change.field); Text(change.before).foregroundStyle(Theme.muted); Text(change.after) } }
                            }.textSelection(.enabled)
                        }
                    }
                    let notes = row["metadata"].object.keys.filter { !["before", "after", "beforeStock", "afterStock"].contains($0) && auditFieldLabels[$0] != nil }.sorted()
                    if !notes.isEmpty { ManagementPanel("ບໍລິບົດລາຍການ") { ForEach(notes, id: \.self) { key in LabeledContent(auditFieldLabels[key] ?? key, value: mgAuditValue(row["metadata"][key])) } } }
                }
            }
        }
    }
    private func reload() async {
        await state.load(model, "audit", query: ["query": query, "filter": filter, "page": String(page)])
        if state.error == nil, state.data["page"] != .null { page = max(1, Int(state.data["page"].double)) }
    }
    private func export() async {
        exporting = true; defer { exporting = false }
        do {
            var all: [JSONValue] = []; var next = 1
            repeat {
                let response = try await model.read("audit", query: ["query": query, "filter": filter, "page": String(next)])
                guard response.source == "database" else { throw mgError("ເຊື່ອມຕໍ່ຖານຂໍ້ມູນກ່ອນສົ່ງອອກ") }
                all.append(contentsOf: response.data["logs"].array)
                if next >= max(1, Int(response.data["totalPages"].double)) { break }; next += 1
            } while next <= 10000
            guard next <= 10000 else { throw mgError("ລາຍການຫຼາຍເກີນການສົ່ງອອກຄັ້ງດຽວ. ກະລຸນາຈຳກັດຕົວກອງ") }
            let rows: [[String]] = all.flatMap { row in
                let common = [row.id, row.text("createdAt"), row["user"].text("fullName"), mgAuditAction(row.text("action")), row.text("entityType"), row.text("entityId"), row["store"].text("name"), row.text("summary")]
                let changes = mgAuditChanges(row["metadata"])
                return changes.isEmpty ? [common + ["", "", ""]] : changes.map { common + [auditFieldLabels[$0.field] ?? $0.field, $0.before, $0.after] }
            }
            model.exportCSV(name: "audit", headers: ["ID", "ເວລາ", "ຜູ້ດຳເນີນການ", "ການປ່ຽນ", "ປະເພດ", "ລະຫັດລາຍການ", "ຮ້ານ", "ລາຍລະອຽດ", "ຂໍ້ມູນ", "ກ່ອນ", "ຫຼັງ"], rows: rows)
        } catch { model.showNotice(error.localizedDescription) }
    }
}
private func mgDateTime(_ text: String) -> String {
    let parser = ISO8601DateFormatter(); parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = parser.date(from: text) else { return text }
    let formatter = DateFormatter(); formatter.locale = Locale(identifier: "lo_LA"); formatter.timeZone = TimeZone(identifier: "Asia/Vientiane"); formatter.dateStyle = .medium; formatter.timeStyle = .short
    return formatter.string(from: date)
}

private func mgBackupReason(_ key: String) -> String {
    ["invalid-target": "ກວດຖານຂໍ້ມູນປາຍທາງບໍ່ໄດ້", "missing-backup": "ຍັງບໍ່ພົບຫຼັກຖານສຳຮອງທີ່ຄົບ", "wrong-target": "ຂໍ້ມູນສຳຮອງບໍ່ກົງກັບຖານຂໍ້ມູນປັດຈຸບັນ", "invalid-timestamp": "ກວດວັນເວລາສຳຮອງບໍ່ໄດ້", "stale": "ຂໍ້ມູນສຳຮອງເກົ່າກວ່າ 36 ຊົ່ວໂມງ", "attempt-unverified": "ຍັງບໍ່ຢືນຢັນການສຳຮອງຄັ້ງລ່າສຸດ", "latest-attempt-failed": "ການສຳຮອງຄັ້ງລ່າສຸດບໍ່ສຳເລັດ", "restore-unverified": "ຍັງບໍ່ຢືນຢັນການກູ້ຄືນຈາກຂໍ້ມູນສຳຮອງນີ້"][key] ?? key
}
