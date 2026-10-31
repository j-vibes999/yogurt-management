import SwiftUI

struct SettlementsView: View {
    @ObservedObject var model: AppModel
    @StateObject private var state = FeatureState()
    @State private var query = ""
    @State private var filter = "pending"
    @State private var page = 1
    @State private var selection: String?
    @State private var payment: JSONValue?
    @State private var receipt: JSONValue?
    @State private var initialLoad = false
    private var rows: [JSONValue] { state.data["settlements"].array }
    private var server: JSONValue { state.data["server"] }
    private var pageCount: Int { max(1, Int(server["pageCount"].double)) }
    private var readKey: String { "\(filter)|\(page)|\(query)" }
    var body: some View {
        Workspace(title: "ຮັບເງິນ / ບັນຊີຮ້ານ", subtitle: filter == "all" ? "ປະຫວັດທຸກຮອບ · ຮ້ານດຽວອາດມີຫຼາຍລາຍການ" : "ຮອບລ່າສຸດຕໍ່ຮ້ານ ຕາມສະຖານະທີ່ເລືອກ", domain: Destination.settlements.domain) {
            OperationsReadActions(state: state)
            Button { export() } label: { Label("ສົ່ງອອກໜ້ານີ້", systemImage: "square.and.arrow.up") }.disabled(rows.isEmpty)
        } content: {
            ReadStateView(state: state) {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(spacing: 32) {
                        LabeledContent("ຍອດຄ້າງປັດຈຸບັນ") { MoneyText(state.data["currentOutstanding"]) }
                        LabeledContent("ຮັບແລ້ວທັງໝົດ") { MoneyText(state.data["collected"]) }
                        Text(state.data["pendingStores"].text + " ຮ້ານຄ້າງຮັບ").foregroundStyle(Theme.muted)
                    }.padding(.vertical, 12)
                    HStack {
                        TextField("ຄົ້ນຫາຮ້ານ, ເລກບິນ, ວັນທີ YYYY-MM-DD…", text: $query).textFieldStyle(.roundedBorder)
                        Picker("ສະຖານະ", selection: $filter) {
                            Text("ຄ້າງຮັບ").tag("pending"); Text("ບາງສ່ວນ").tag("partial"); Text("ຈ່າຍແລ້ວ").tag("paid"); Text("ປະຫວັດທັງໝົດ").tag("all")
                        }.frame(width: 200)
                    }
                    Text("\(Int(server["total"].double)) ລາຍການ").foregroundStyle(Theme.muted)
                    if rows.isEmpty { EmptyNotice(title: "ບໍ່ພົບລາຍການຮັບເງິນ", detail: "ລອງປ່ຽນຄຳຄົ້ນຫາ ຫຼືສະຖານະ", symbol: "banknote") }
                    else {
                        Table(rows, selection: $selection) {
                            TableColumn("ຮ້ານ / ບິນ") { row in
                                Button { receipt = row } label: {
                                    VStack(alignment: .leading, spacing: 4) { Text(row.text("storeName")).font(Theme.font(14, weight: .semibold)); Text(row.text("receiptNumber").isEmpty ? row.id : row.text("receiptNumber")).font(Theme.font(11)).foregroundStyle(Theme.muted) }
                                }.buttonStyle(.plain).foregroundStyle(Theme.blue)
                            }.width(min: 180, ideal: 230)
                            TableColumn("ຮອບ") { row in Text(row.text("periodLabel")) }.width(min: 90, ideal: 110)
                            TableColumn("ຍອດຂາຍ") { row in MoneyText(row["gross"]) }.width(min: 105, ideal: 120)
                            TableColumn("ສ່ວນເຮົາ") { row in MoneyText(row["net"]) }.width(min: 105, ideal: 120)
                            TableColumn("ຮັບແລ້ວ") { row in MoneyText(row["paid"]) }.width(min: 105, ideal: 120)
                            TableColumn("ຄົງຄ້າງ") { row in MoneyText(row["closingBalance"]).foregroundStyle(row["closingBalance"].decimal > 0 ? Theme.danger : Theme.green) }.width(min: 105, ideal: 120)
                            TableColumn("ສະຖານະ") { row in StatusLabel(operationsStatus(row.text("status")), tone: operationsTone(row.text("status"))) }.width(min: 115, ideal: 135)
                        }.frame(minHeight: 350)
                        .contextMenu(forSelectionType: String.self) { ids in
                            if let id = ids.first, let row = rows.first(where: { $0.id == id }) {
                                Button("ເບິ່ງໃບເສັດ") { receipt = row }
                                Button("ຮັບເງິນຄ້າງ") { payment = row }.disabled(!canPay(row))
                                Button("ຂໍ້ມູນຮ້ານ") { model.navigate(.stores, storeId: row.text("storeId")) }
                            }
                        } primaryAction: { ids in if let id = ids.first { receipt = rows.first { $0.id == id } } }
                        HStack {
                            if let selected = rows.first(where: { $0.id == selection }) {
                                Button("ເບິ່ງໃບເສັດ") { receipt = selected }
                                Button("ຮັບເງິນຄ້າງ") { payment = selected }.buttonStyle(.borderedProminent).disabled(!canPay(selected))
                            }
                            Spacer()
                            Button("ກ່ອນໜ້າ") { page -= 1 }.disabled(page <= 1 || state.loading)
                            Text("ໜ້າ \(page)/\(pageCount)").monospacedDigit()
                            Button("ຖັດໄປ") { page += 1 }.disabled(page >= pageCount || state.loading)
                        }
                    }
                }
            }
        }
        .task {
            if let id = model.contextStoreId {
                do { let response = try await model.read("store", query: ["id": id]); query = response.data["store"].text("name") }
                catch { model.showNotice(error.localizedDescription) }
            }
            initialLoad = true; await load()
        }
        .task(id: readKey) {
            guard initialLoad else { return }
            do { try await Task.sleep(for: .milliseconds(250)); try Task.checkCancellation(); await load() } catch { }
        }
        .onChange(of: filter) { _, _ in page = 1 }
        .onChange(of: query) { _, _ in page = 1 }
        .sheet(item: $payment, onDismiss: { Task { await load() } }) { row in OperationsAuditView(model: model, storeId: row.text("storeId"), paymentOnly: true) }
        .sheet(item: $receipt) { row in OperationsReceiptView(model: model, row: row, storeName: row.text("storeName")) }
    }
    private func load() async { await state.load(model, "settlements", query: ["query": query, "filter": filter, "page": String(page)]); if server["page"].double >= 1 { page = Int(server["page"].double) } }
    private func canPay(_ row: JSONValue) -> Bool { model.canWrite && state.source == "database" && row["closingBalance"].decimal > 0 && ["admin", "driver"].contains(model.session?.role ?? "") }
    private func export() {
        model.exportCSV(name: "settlements-\(businessDateString(Date()))-\(page)", headers: ["ຮ້ານ", "ເລກບິນ", "ຮອບ", "ຍອດຂາຍ", "ສ່ວນແບ່ງຮ້ານ", "ສ່ວນເຮົາ", "ຮັບແລ້ວ", "ຄົງຄ້າງ", "ສະຖານະ"], rows: rows.map { [$0.text("storeName"), $0.text("receiptNumber"), $0.text("periodLabel"), $0["gross"].text, $0["commission"].text, $0["net"].text, $0["paid"].text, $0["closingBalance"].text, operationsStatus($0.text("status"))] })
    }
}

struct OperationsReceiptView: View {
    @ObservedObject var model: AppModel
    let row: JSONValue
    let storeName: String
    @Environment(\.dismiss) private var dismiss
    @State private var error: String?
    private func amount(_ raw: String, _ display: String) -> JSONValue { row[raw] == .null ? row[display] : row[raw] }
    private var status: String { row.text("paymentStatus").isEmpty ? row.text("status") : row.text("paymentStatus") }
    private var date: String { row.text("settlementDate").isEmpty ? row.text("periodLabel") : row.text("settlementDate") }
    private var receiptNumber: String { row.text("receiptNumber").isEmpty ? row.id : row.text("receiptNumber") }
    private var closing: JSONValue { row["closingBalanceExact"] == .null ? row["closingBalance"] : row["closingBalanceExact"] }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack { Text("ໃບເສັດຮັບເງິນ").font(Theme.font(24, weight: .bold)); Spacer(); Button("ປິດ") { dismiss() }.keyboardShortcut(.cancelAction) }
            Text(storeName).font(Theme.font(18, weight: .semibold)).foregroundStyle(Theme.blue)
            Text(receiptNumber).font(Theme.font(16, weight: .semibold)).textSelection(.enabled)
            Text(operationsDate(date)).foregroundStyle(Theme.muted)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    LabeledContent("ຍອດຂາຍ") { MoneyText(amount("grossAmount", "gross")) }
                    LabeledContent("ສ່ວນແບ່ງຮ້ານ") { MoneyText(amount("storeCommissionAmount", "commission")) }
                    LabeledContent("ສ່ວນເຮົາ") { MoneyText(amount("netPayableAmount", "net")) }
                    LabeledContent("ຍອດຄ້າງເດີມ") { MoneyText(row["previousBalance"]) }
                    LabeledContent("ຮັບເງິນແລ້ວ") { MoneyText(amount("paidAmount", "paid")) }
                    LabeledContent("ຄົງຄ້າງ") { MoneyText(closing).font(Theme.font(20, weight: .semibold)) }
                    LabeledContent("ວິທີຮັບເງິນ", value: row.text("paymentMethod") == "bank" ? "ໂອນທະນາຄານ" : row.text("paymentMethod") == "cash" ? "ເງິນສົດ" : "—")
                    StatusLabel(operationsStatus(status), tone: operationsTone(status))
                    if !row["productSales"].array.isEmpty {
                        Divider()
                        ForEach(Array(row["productSales"].array.enumerated()), id: \.offset) { _, item in LabeledContent(item.text("name"), value: item["unitsSold"].text + " ຖ້ວຍ") }
                    }
                }
            }
            Text("ຂໍ້ມູນຈາກລາຍການທີ່ບັນທຶກແລ້ວ").font(Theme.font(12)).foregroundStyle(Theme.muted)
            if let error { OperationsIssue(text: error) }
            HStack {
                if !row.text("receiptPath").isEmpty && model.session?.role == "admin" {
                    Button("ເປີດເອກະສານແນບ") { Task { do { try await model.openReceipt(row.text("receiptPath")) } catch { self.error = error.localizedDescription } } }
                }
                Spacer()
                Button { export() } label: { Label("ບັນທຶກໃບເສັດ CSV", systemImage: "square.and.arrow.down") }.buttonStyle(.borderedProminent)
            }
        }.padding(24).frame(width: 620, height: 690).font(Theme.font()).textSelection(.enabled)
    }
    private func export() {
        model.exportCSV(name: receiptNumber, headers: ["ລາຍການ", "ຂໍ້ມູນ"], rows: [["ຮ້ານ", storeName], ["ເລກບິນ", receiptNumber], ["ວັນທີ", date], ["ຍອດຂາຍ", amount("grossAmount", "gross").text], ["ສ່ວນແບ່ງຮ້ານ", amount("storeCommissionAmount", "commission").text], ["ສ່ວນເຮົາ", amount("netPayableAmount", "net").text], ["ຍອດຄ້າງເດີມ", row["previousBalance"].text], ["ຮັບເງິນແລ້ວ", amount("paidAmount", "paid").text], ["ຄົງຄ້າງ", closing.text], ["ສະຖານະ", operationsStatus(status)]])
    }
}
