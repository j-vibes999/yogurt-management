import SwiftUI
import MapKit

struct MapWorkspaceView: View {
    @ObservedObject var model: AppModel
    @StateObject private var state = FeatureState()
    @State private var query = ""
    @State private var filter = "all"
    @State private var selection: String?
    @State private var listOnly = false
    @State private var camera = StreetMapDefaults.region(around: [])
    @State private var cameraID = 0
    @AppStorage("mapTileStyle") private var style: MapTileStyle = .street
    @State private var detail: JSONValue?
    /// Every store, so stores without coordinates (absent from the map data) can be placed.
    @StateObject private var directory = FeatureState()
    @State private var placing: JSONValue?
    @State private var placeError: String?
    private var rows: [JSONValue] {
        state.data["stores"].array.filter { row in
            (query.isEmpty || [row.text("name"), row.text("address"), row.text("phone"), row.text("assetCode")].joined(separator: " ").localizedCaseInsensitiveContains(query)) &&
            (filter == "all" || (filter == "due" && row["due"].bool) || (filter == "low" && row["lowStock"].bool) || (filter == "refill" && row["refillStatus"] != .null) || (filter == "balance" && row["outstanding"].decimal > 0))
        }
    }
    private var selected: JSONValue? { rows.first { $0.id == selection } }
    private var pins: [StreetMapPin] {
        rows.map { StreetMapPin(id: $0.id, title: $0.text("name"), latitude: $0["latitude"].double, longitude: $0["longitude"].double, warning: $0["lowStock"].bool || $0["due"].bool) }
    }
    private var unplaced: [JSONValue] { directory.data["stores"].array.filter { $0["latitude"] == .null || $0["longitude"] == .null } }
    private func showAll() { camera = StreetMapDefaults.region(around: pins); cameraID += 1 }
    var body: some View {
        Workspace(title: "ແຜນທີ່ຮ້ານ", subtitle: "ເລືອກຮ້ານເພື່ອເບິ່ງສິນຄ້າ ແລະວຽກທີ່ຕ້ອງເຮັດ", domain: Destination.map.domain) {
            OperationsReadActions(state: state)
            Toggle("ລາຍການຢ່າງດຽວ", isOn: $listOnly).toggleStyle(.button)
            Button("ສະແດງທຸກຮ້ານ") { showAll(); selection = nil }.disabled(listOnly)
        } content: {
            ReadStateView(state: state) {
                VStack(spacing: 16) {
                    if !unplaced.isEmpty { unplacedPanel }
                    HStack {
                        TextField("ຄົ້ນຫາຮ້ານ ຫຼືລະຫັດຕູ້…", text: $query).textFieldStyle(.roundedBorder)
                        Picker("ຕົວກອງ", selection: $filter) {
                            Text("ທັງໝົດ").tag("all"); Text("ເຖິງຮອບກວດ").tag("due"); Text("ສິນຄ້າຕ່ຳ").tag("low")
                            Text("ມີຄຳຂໍເຕີມ").tag("refill"); Text("ມີຍອດຄ້າງ").tag("balance")
                        }.frame(width: 190)
                    }
                    if rows.isEmpty && !(query.isEmpty && filter == "all") {
                        EmptyNotice(title: "ບໍ່ພົບຮ້ານ", detail: "ລອງປ່ຽນຄຳຄົ້ນຫາ ຫຼືຕົວກອງ", symbol: "map")
                    } else {
                        HSplitView {
                            VStack(alignment: .leading, spacing: 12) {
                                Text(rows.isEmpty ? "ຍັງບໍ່ມີຮ້ານທີ່ປັກໝຸດໃນແຜນທີ່" : "\(rows.count) ຮ້ານ").foregroundStyle(Theme.muted)
                                List(rows, selection: $selection) { row in
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text(row.text("name")).font(Theme.font(14, weight: .semibold))
                                        Text(row.text("assetCode") + " · " + row["stock"].text + "/" + row["capacity"].text + " ຖ້ວຍ").font(Theme.font(12))
                                        if row["due"].bool { StatusLabel("ເຖິງຮອບກວດ", tone: .warning) }
                                    }.padding(.vertical, 6).tag(row.id)
                                }.listStyle(.inset)
                                if let selected { selectedStore(selected) }
                            }.frame(minWidth: 280, idealWidth: listOnly ? 700 : 320, maxWidth: listOnly ? .infinity : 420)
                            if !listOnly {
                                StreetMapView(pins: pins, selection: $selection, camera: camera, cameraID: cameraID, style: style)
                                    .overlay(alignment: .bottomLeading) { StreetMapAttribution(style: style) }
                                    .overlay(alignment: .topTrailing) { MapStyleSwitch(style: $style) }
                                    .frame(minWidth: 330, minHeight: 430).clipShape(RoundedRectangle(cornerRadius: 10))
                                    .accessibilityLabel("ແຜນທີ່ຮ້ານ. ໃຊ້ລາຍການຮ້ານຄຽງຂ້າງໄດ້.")
                            }
                        }.frame(height: 560)
                    }
                }
            }
        }
        .task {
            async let stores: Void = directory.load(model, "stores")
            await state.load(model, "map"); await stores
            if let id = model.contextStoreId { selection = id } else { showAll() }
        }
        .onChange(of: model.contextStoreId) { _, id in selection = id }
        .onChange(of: selection) { _, id in
            if let row = rows.first(where: { $0.id == id }) {
                camera = MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: row["latitude"].double, longitude: row["longitude"].double), span: MKCoordinateSpan(latitudeDelta: 0.015, longitudeDelta: 0.015)); cameraID += 1
            }
        }
        .sheet(item: $detail) { row in StoreDetailView(model: model, storeId: row.id, showsClose: true).frame(minWidth: 880, minHeight: 650) }
        .sheet(item: $placing) { row in
            StoreLocationPicker(latitude: "", longitude: "") { latitude, longitude in Task { await place(row, latitude: latitude, longitude: longitude) } }
        }
    }
    private var unplacedPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("\(unplaced.count) ຮ້ານຍັງບໍ່ມີຕຳແໜ່ງໃນແຜນທີ່", systemImage: "mappin.slash").font(Theme.font(15, weight: .semibold)).foregroundStyle(Theme.mango)
            Text(model.session?.role == "admin" ? "ກົດຊື່ຮ້ານເພື່ອປັກໝຸດຕຳແໜ່ງ. ຮ້ານຈະສະແດງໃນແຜນທີ່ທັນທີ." : "ໃຫ້ຜູ້ຈັດການປັກໝຸດຕຳແໜ່ງຮ້ານເຫຼົ່ານີ້.").font(Theme.font(13)).foregroundStyle(Theme.muted)
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(unplaced) { row in
                        Button { placing = row } label: { Label(row.text("name"), systemImage: "mappin.and.ellipse") }
                            .disabled(model.session?.role != "admin" || !model.canWrite)
                    }
                }.padding(.bottom, 2)
            }.scrollIndicators(.never)
            if let placeError { Label(placeError, systemImage: "exclamationmark.triangle").foregroundStyle(Theme.danger) }
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface).tableSurface()
    }
    /// Saves only the position; the store's other fields stay as they are.
    private func place(_ row: JSONValue, latitude: String, longitude: String) async {
        placeError = nil
        do {
            _ = try await model.mutate("/api/stores/" + operationsPath(row.id), body: .object(["name": .string(row.text("name")), "latitude": .string(latitude), "longitude": .string(longitude)]), method: "PATCH", durable: false)
            await directory.refresh(); await state.refresh()
            selection = row.id
        } catch { placeError = error.localizedDescription }
    }
    private func selectedStore(_ row: JSONValue) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Divider()
            Text(row.text("name")).font(Theme.font(18, weight: .semibold))
            Text(row.text("address")).foregroundStyle(Theme.muted)
            LabeledContent("ຍອດຄ້າງ") { MoneyText(row["outstanding"]) }
            ForEach(Array(row["yogurt"].array.enumerated()), id: \.offset) { _, item in LabeledContent(item.text("name"), value: item["quantity"].text + " ຖ້ວຍ") }
            HStack {
                Button("ຂໍ້ມູນຮ້ານ") { detail = row }
                Button { openDirections(row) } label: { Label("ເສັ້ນທາງ", systemImage: "arrow.triangle.turn.up.right.diamond") }
            }
        }.padding(12)
    }
    private func openDirections(_ row: JSONValue) {
        let item = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: row["latitude"].double, longitude: row["longitude"].double)))
        item.name = row.text("name")
        item.openInMaps(launchOptions: [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDriving])
    }
}

struct RefillsView: View {
    @ObservedObject var model: AppModel
    @StateObject private var state = FeatureState()
    @State private var query = ""
    @State private var filter = "active"
    @State private var selection: String?
    @State private var create = false
    @State private var detail: JSONValue?
    private var rows: [JSONValue] {
        state.data["refills"].array.filter { row in
            (query.isEmpty || [row.text("storeName"), row.text("address"), row.text("note"), row.id].joined(separator: " ").localizedCaseInsensitiveContains(query)) &&
            (filter == "all" || filter == row.text("status") || (filter == "active" && !["completed", "cancelled"].contains(row.text("status"))))
        }
    }
    var body: some View {
        Workspace(title: "ເຕີມສິນຄ້າ", subtitle: "ຄຳຂໍ → ກຽມສິນຄ້າ → ສົ່ງ → ສຳເລັດ", domain: Destination.refills.domain) {
            OperationsReadActions(state: state)
            if ["admin", "driver"].contains(model.session?.role ?? "") {
                Button { create = true } label: { Label("ສ້າງຄຳຂໍ", systemImage: "plus") }.buttonStyle(.borderedProminent).disabled(!model.canWrite || state.source != "database")
            }
        } content: {
            ReadStateView(state: state) {
                VStack(alignment: .leading, spacing: 16) {
                    HStack {
                        TextField("ຄົ້ນຫາຮ້ານ ຫຼືຄຳຂໍ…", text: $query).textFieldStyle(.roundedBorder)
                        Picker("ສະຖານະ", selection: $filter) {
                            Text("ກຳລັງດຳເນີນ").tag("active")
                            ForEach(["waiting", "preparing", "delivering"], id: \.self) { Text(operationsStatus($0)).tag($0) }
                        }.frame(width: 195)
                        Text("\(rows.count) ຄຳຂໍ").foregroundStyle(Theme.muted)
                    }
                    if rows.isEmpty { EmptyNotice(title: "ບໍ່ມີຄຳຂໍທີ່ກົງກັນ", detail: "ປ່ຽນຕົວກອງ ຫຼືສ້າງຄຳຂໍເຕີມໃໝ່", symbol: "shippingbox") }
                    else {
                        Table(rows, selection: $selection) {
                            TableColumn("ຮ້ານ") { row in Button(row.text("storeName")) { detail = row }.buttonStyle(.plain).foregroundStyle(Theme.blue) }.width(min: 180, ideal: 260)
                            TableColumn("ສະຖານະ") { row in StatusLabel(operationsStatus(row.text("status")), tone: operationsTone(row.text("status"))) }.width(min: 120, ideal: 145)
                            TableColumn("ສິນຄ້າ") { row in Text(row["items"].array.map { $0.text("name") + " × " + $0["quantity"].text }.joined(separator: ", ")) }.width(min: 220, ideal: 300)
                            TableColumn("ວັນທີຮ້ອງຂໍ") { row in Text(operationsDate(row.text("requestedAt"))) }.width(min: 130, ideal: 150)
                        }.frame(minHeight: 370).tableSurface()
                        .contextMenu(forSelectionType: String.self) { ids in
                            if let id = ids.first { Button("ເປີດຄຳຂໍ") { detail = rows.first { $0.id == id } } }
                        } primaryAction: { ids in if let id = ids.first { detail = rows.first { $0.id == id } } }
                    }
                }
            }
        }
        .task { await state.load(model, "refills"); if let id = model.contextStoreId, let row = state.data["refills"].array.first(where: { $0.text("storeId") == id }) { query = row.text("storeName") } }
        .sheet(isPresented: $create, onDismiss: { Task { await state.refresh() } }) { OperationsRefillEditor(model: model, storeId: model.contextStoreId) }
        .sheet(item: $detail, onDismiss: { Task { await state.refresh() } }) { row in OperationsRefillDetail(model: model, row: row, source: state.source) }
    }
}

struct OperationsRefillEditor: View {
    @ObservedObject var model: AppModel
    let storeId: String?
    @Environment(\.dismiss) private var dismiss
    @StateObject private var catalog = FeatureState()
    @State private var selectedStore = ""
    @State private var quantities: [String: String] = [:]
    @State private var note = ""
    @State private var error: String?
    @State private var busy = false
    @State private var discard = false
    @State private var submitted: JSONValue?
    private var products: [JSONValue] { catalog.data["products"].array }
    private var stores: [JSONValue] { catalog.data["stores"].array.filter { $0["fridgeId"] != .null } }
    private var dirty: Bool { !note.isEmpty || quantities.values.contains { !$0.isEmpty && $0 != "0" } }
    private var totalCups: Int { products.reduce(0) { $0 + (Int(quantities[$1.id] ?? "") ?? 0) } }
    private func quantity(_ product: JSONValue) -> Binding<Int> {
        Binding(get: { Int(quantities[product.id] ?? "") ?? 0 }, set: { quantities[product.id] = String(max(0, min($0, 100000))) })
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text("ສ້າງຄຳຂໍເຕີມສິນຄ້າ").font(Theme.font(22, weight: .bold)).foregroundStyle(Theme.evergreen)
                Text("ເລືອກຮ້ານ ແລະໃສ່ຈຳນວນຖ້ວຍທີ່ຈະສົ່ງ. ສິນຄ້າຈະເຂົ້າຕູ້ເມື່ອກົດ “ສົ່ງແລ້ວ” ໃນລາຍການເຕີມ.").font(Theme.font(13)).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true)
            }.padding(.horizontal, 24).padding(.top, 22).padding(.bottom, 16)
            Divider()
            ScrollView {
                ReadStateView(state: catalog, showsFreshness: false) {
                    VStack(alignment: .leading, spacing: 14) {
                        FormCard("ຮ້ານ") {
                            Picker("ຮ້ານທີ່ຈະເຕີມ", selection: $selectedStore) {
                                Text("ເລືອກຮ້ານ…").tag("")
                                ForEach(stores) { row in Text(row.text("name")).tag(row.id) }
                            }.labelsHidden().pickerStyle(.menu).frame(maxWidth: .infinity, alignment: .leading)
                            if stores.isEmpty { Text("ຍັງບໍ່ມີຮ້ານທີ່ມີຕູ້ແຊ່").font(Theme.font(12)).foregroundStyle(Theme.muted) }
                        }
                        FormCard("ຈຳນວນທີ່ຈະສົ່ງ") {
                            ForEach(products) { product in
                                HStack(spacing: 12) {
                                    Text(product.text("name")).font(Theme.font(14, weight: .medium))
                                    Spacer()
                                    TextField("0", value: quantity(product), format: .number).multilineTextAlignment(.trailing).frame(width: 90).accessibilityLabel(product.text("name") + " ຖ້ວຍ")
                                    Stepper("", value: quantity(product), in: 0...100000, step: 1).labelsHidden()
                                    Text("ຖ້ວຍ").foregroundStyle(Theme.muted)
                                }
                                if product.id != products.last?.id { Divider() }
                            }
                            HStack { Text("ລວມ").font(Theme.font(14, weight: .bold)); Spacer(); Text("\(totalCups) ຖ້ວຍ").font(Theme.font(15, weight: .bold)).monospacedDigit() }.padding(.top, 4)
                        }
                        FormCard("ໝາຍເຫດ") {
                            TextEditor(text: $note).font(Theme.font()).scrollContentBackground(.hidden).frame(height: 64).padding(6)
                                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 6)).overlay(RoundedRectangle(cornerRadius: 6).stroke(Theme.border))
                        }
                    }
                }.padding(20).disabled(busy || submitted != nil)
            }.textFieldStyle(.roundedBorder).controlSize(.large)
            Divider()
            VStack(alignment: .leading, spacing: 10) {
                if let error { OperationsIssue(text: error) }
                if submitted != nil { Text("ຄຳຂໍຖືກເກັບໄວ້ແລ້ວ. ລອງຄຳຂໍເດີມເພື່ອຢືນຢັນຜົນ.").foregroundStyle(Theme.muted) }
                HStack {
                    Button("ຍົກເລີກ", role: .cancel) { if dirty || submitted != nil { discard = true } else { dismiss() } }.disabled(busy)
                    Spacer()
                    if busy { ProgressView().controlSize(.small) }
                    Button(submitted == nil ? "ສ້າງຄຳຂໍ" : "ລອງຄຳຂໍເດີມ") { Task { await save() } }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                        .disabled(busy || !model.canWrite || catalog.source != "database" || selectedStore.isEmpty || (submitted == nil && totalCups == 0))
                }.controlSize(.large)
            }.padding(.horizontal, 24).padding(.vertical, 16)
        }.frame(width: 620, height: 640).font(Theme.font()).background(Theme.cream)
        .interactiveDismissDisabled(dirty || busy || submitted != nil)
        .task { await catalog.load(model, "catalog"); selectedStore = storeId ?? "" }
        .confirmationDialog("ປິດຄຳຂໍນີ້?", isPresented: $discard, titleVisibility: .visible) {
            Button(submitted == nil ? "ປະຖິ້ມການແກ້ໄຂ" : "ປິດ · ເກັບຄຳຂໍທີ່ລໍຜົນໄວ້", role: .destructive) { dismiss() }
            Button("ເຮັດຕໍ່", role: .cancel) {}
        } message: { Text(submitted == nil ? "ຂໍ້ມູນທີ່ຍັງບໍ່ບັນທຶກຈະຖືກປະຖິ້ມ." : "ຄຳຂໍທີ່ສົ່ງແລ້ວຈະຍັງເກັບໄວ້ ຈົນຢືນຢັນຜົນ.") }
    }
    private func save() async {
        error = nil; busy = true
        defer { busy = false }
        do {
            if submitted == nil {
                var items: [JSONValue] = []
                for product in products {
                    let text = quantities[product.id] ?? "0"
                    guard text.range(of: "^[0-9]+$", options: .regularExpression) != nil, let count = Int(text), count <= 100000 else { throw OperationsError(message: "ຈຳນວນຕ້ອງເປັນ 0–100000 ຖ້ວຍ") }
                    if count > 0 { items.append(.object(["finishedProductId": .string(product.id), "quantity": .number(Decimal(count))])) }
                }
                guard !items.isEmpty else { throw OperationsError(message: "ໃສ່ຈຳນວນຢ່າງໜ້ອຍ 1 ສິນຄ້າ") }
                guard note.count <= 1000 else { throw OperationsError(message: "ໝາຍເຫດຍາວເກີນ 1000 ຕົວອັກສອນ") }
                submitted = .object(["storeId": .string(selectedStore), "note": .string(note), "items": .array(items)])
            }
            _ = try await model.mutate("/api/refills", body: submitted!)
            model.showNotice("ສ້າງຄຳຂໍເຕີມແລ້ວ"); dismiss()
        } catch {
            self.error = error.localizedDescription
            if !(await model.hasPendingCommand(path: "/api/refills")) { submitted = nil }
        }
    }
}

struct OperationsRefillDetail: View {
    @ObservedObject var model: AppModel
    @State var row: JSONValue
    let source: String
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var error: String?
    @State private var confirmStatus: String?
    @State private var needsRefresh = false
    private var next: [String] {
        switch row.text("status") {
        case "waiting": return ["preparing", "delivering", "cancelled"]
        case "preparing": return ["delivering", "cancelled"]
        case "delivering": return ["completed", "cancelled"]
        default: return []
        }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack { Text(row.text("storeName")).font(Theme.font(24, weight: .bold)); Spacer(); Button("ປິດ") { dismiss() }.keyboardShortcut(.cancelAction) }
            StatusLabel(operationsStatus(row.text("status")), tone: operationsTone(row.text("status")))
            LabeledContent("ຄຳຂໍ", value: row.id)
            LabeledContent("ວັນທີ", value: operationsDate(row.text("requestedAt")))
            LabeledContent("ເບີໂທ", value: row.text("phone"))
            Text(row.text("address")).foregroundStyle(Theme.muted)
            OperationsSection(title: "ສິນຄ້າທີ່ຂໍ") {
                ForEach(Array(row["items"].array.enumerated()), id: \.offset) { _, item in HStack { Text(item.text("name")); Spacer(); Text(item["quantity"].text + " ຖ້ວຍ").monospacedDigit() } }
            }
            if !row.text("note").isEmpty { Text(row.text("note")).textSelection(.enabled) }
            if let error { OperationsIssue(text: error) }
            if needsRefresh { Button("ກວດສະຖານະລ່າສຸດ") { Task { await reconcile() } } }
            Spacer(minLength: 8)
            HStack {
                Button("ຂໍ້ມູນຮ້ານ") { model.navigate(.stores, storeId: row.text("storeId")); dismiss() }
                Spacer()
                if ["admin", "driver"].contains(model.session?.role ?? "") {
                    ForEach(next, id: \.self) { status in
                        Button(operationsStatus(status), role: status == "cancelled" ? .destructive : nil) { confirmStatus = status }.disabled(busy || needsRefresh || !model.canWrite || source != "database")
                    }
                }
                if busy { ProgressView().controlSize(.small) }
            }
        }.padding(24).frame(width: 650, height: 570).font(Theme.font()).interactiveDismissDisabled(busy)
        .confirmationDialog(confirmStatus == "completed" ? "ຢືນຢັນວ່າສົ່ງຮອດຮ້ານແລ້ວ?" : "ປ່ຽນສະຖານະຄຳຂໍ?", isPresented: Binding(get: { confirmStatus != nil }, set: { if !$0 { confirmStatus = nil } }), titleVisibility: .visible) {
            if let status = confirmStatus { Button(operationsStatus(status), role: status == "cancelled" ? .destructive : nil) { Task { await change(status) } } }
            Button("ຍົກເລີກ", role: .cancel) { confirmStatus = nil }
        } message: { Text(confirmStatus == "completed" ? "ລະບົບຈະຫັກສິນຄ້າຈາກສາງຕາມລັອດວັນໝົດອາຍຸ ແລະເພີ່ມເຂົ້າຕູ້ຮ້ານ." : "ກວດສະຖານະກ່ອນຢືນຢັນ.") }
    }
    private func change(_ status: String) async {
        busy = true; error = nil; confirmStatus = nil
        do {
            _ = try await model.mutate("/api/refills/" + operationsPath(row.id), body: .object(["status": .string(status)]), method: "PATCH", durable: false)
            var object = row.object; object["status"] = .string(status); row = .object(object)
            model.showNotice("ປ່ຽນສະຖານະແລ້ວ")
        } catch { self.error = error.localizedDescription; needsRefresh = true; await reconcile() }
        busy = false
    }
    private func reconcile() async {
        do {
            let read = try await model.read("refills", query: ["id": row.id])
            guard let fresh = read.data["refills"].array.first(where: { $0.id == row.id }) else { needsRefresh = true; return }
            row = fresh; needsRefresh = false
        } catch { self.error = error.localizedDescription; needsRefresh = true }
    }
}

struct DriverView: View {
    @ObservedObject var model: AppModel
    @StateObject private var state = FeatureState()
    @State private var query = ""
    @State private var filter = "due"
    @State private var auditStore: JSONValue?
    @State private var detail: JSONValue?
    private var stores: [JSONValue] { state.data["stores"].array }
    private var rows: [JSONValue] { stores.filter { (query.isEmpty || [$0.text("name"), $0.text("address"), $0["fridge"].text("assetCode")].joined(separator: " ").localizedCaseInsensitiveContains(query)) && (filter == "all" || (filter == "due" && $0["due"].bool) || (filter == "done" && !$0["due"].bool)) } }
    var body: some View {
        Workspace(title: "ກວດຮ້ານ", subtitle: "ນັບສິນຄ້າ, ຮັບເງິນ ແລະປິດຮອບກວດ", domain: Destination.driver.domain) {
            OperationsReadActions(state: state)
        } content: {
            ReadStateView(state: state) {
                VStack(alignment: .leading, spacing: 16) {
                    HStack { Text("ເຫຼືອ \(stores.filter { $0["due"].bool }.count) ຮ້ານທີ່ຕ້ອງກວດ").font(Theme.font(17, weight: .semibold)); Spacer(); Text("ກວດແລ້ວ \(stores.filter { !$0["due"].bool }.count)/\(stores.count)").foregroundStyle(Theme.muted) }
                    HStack {
                        TextField("ຄົ້ນຫາຮ້ານ…", text: $query).textFieldStyle(.roundedBorder)
                        Picker("ຮອບກວດ", selection: $filter) { Text("ເຖິງຮອບ").tag("due"); Text("ກວດແລ້ວ").tag("done"); Text("ທັງໝົດ").tag("all") }.pickerStyle(.segmented).frame(width: 350)
                    }
                    if rows.isEmpty { EmptyNotice(title: filter == "due" ? "ກວດຮ້ານຄົບແລ້ວ" : "ບໍ່ພົບຮ້ານ", detail: query.isEmpty ? "ເລືອກທັງໝົດເພື່ອເບິ່ງຮ້ານ" : "ລອງປ່ຽນຄຳຄົ້ນຫາ", symbol: "checkmark.circle") }
                    if !rows.isEmpty { LazyVStack(spacing: 0) {
                            ForEach(rows) { row in
                                HStack(spacing: 20) {
                                    VStack(alignment: .leading, spacing: 6) {
                                        Button(row.text("name")) { detail = row }.buttonStyle(.plain).font(Theme.font(16, weight: .semibold)).foregroundStyle(Theme.blue)
                                        Text(row.text("address")).foregroundStyle(Theme.muted)
                                        Text(row["fridge"].text("assetCode") + " · " + row["stock"].text + " ຖ້ວຍ").font(Theme.font(12))
                                    }
                                    Spacer()
                                    StatusLabel(row["due"].bool ? "ເຖິງຮອບກວດ" : "ກວດແລ້ວ", tone: row["due"].bool ? .warning : .success)
                                    Button("ເລີ່ມກວດ") { auditStore = row }.buttonStyle(.borderedProminent).disabled(!model.canWrite || state.source != "database" || row["fridge"] == .null)
                                }.padding(.vertical, 14).padding(.horizontal, 16)
                                if row.id != rows.last?.id { Divider().padding(.leading, 16) }
                            }
                    }.background(Theme.surface).tableSurface() }
                }
            }
        }
        .task { await state.load(model, "stores"); if let id = model.contextStoreId { auditStore = stores.first { $0.id == id } } }
        .sheet(item: $auditStore, onDismiss: { Task { await state.refresh() } }) { row in OperationsAuditView(model: model, storeId: row.id, paymentOnly: false) }
        .sheet(item: $detail) { row in StoreDetailView(model: model, storeId: row.id, showsClose: true).frame(minWidth: 880, minHeight: 650) }
    }
}
