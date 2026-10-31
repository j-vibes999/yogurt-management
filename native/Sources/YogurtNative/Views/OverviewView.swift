import SwiftUI

struct OverviewView: View {
    @ObservedObject var model: AppModel
    @StateObject private var state = FeatureState()
    private var dashboard: JSONValue { state.data["dashboard"] }
    var body: some View {
        Workspace(title: "ພາບລວມວຽກມື້ນີ້", subtitle: "ກວດວຽກທີ່ຕ້ອງເຮັດ ແລະເລືອກເລີ່ມຈາກລາຍການດ້ານລຸ່ມ", domain: .overview) {
            Button("ໂຫຼດຄືນ", systemImage: "arrow.clockwise") { Task { await state.refresh() } }.keyboardShortcut("r", modifiers: .command).disabled(state.loading)
        } content: {
            ReadStateView(state: state) {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 200), spacing: 16)], spacing: 16) {
                    metric("ຮ້ານຄ້າ", value: .integer(dashboard["stores"].array.count), detail: "ຮ້ານທີ່ກຳລັງໃຊ້ງານ", destination: .stores)
                    metric("ຮ້ານຄົບກຳນົດກວດ", value: dashboard["dueStores"], detail: "ກວດຈຳນວນ / ປິດຮອບ", destination: .driver)
                    metric("ແຜນເຕີມສິນຄ້າ", value: .integer(dashboard["refills"].array.count), detail: "ລາຍການທີ່ຍັງບໍ່ສຳເລັດ", destination: .refills)
                    if Destination.settlements.isAllowed(role: model.session?.role ?? "") { metric("ຍອດຄ້າງຮັບ", value: dashboard["outstanding"], detail: "ຍອດລ່າສຸດຂອງແຕ່ລະຮ້ານ", destination: .settlements, money: true) }
                }
                if model.session?.role == "admin" {
                    HStack(spacing: 30) {
                        VStack(alignment: .leading, spacing: 6) { Text("ຍອດຂາຍ 7 ມື້").foregroundStyle(Theme.muted); MoneyText(dashboard["weeklyGross"]).font(Theme.font(24, weight: .bold)) }
                        VStack(alignment: .leading, spacing: 6) { Text("ສ່ວນແບ່ງເຈົ້າຂອງ").foregroundStyle(Theme.muted); MoneyText(dashboard["ownerNet"]).font(Theme.font(24, weight: .bold)) }
                        Spacer(); Button("ເບິ່ງລາຍງານ", systemImage: "arrow.right") { model.navigate(.reports) }
                    }.padding(20).background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
                }
                let alerts = state.data["notifications"]["alerts"].array
                VStack(alignment: .leading, spacing: 14) {
                    HStack { Text("ວຽກທີ່ຕ້ອງຕິດຕາມ").font(Theme.font(19, weight: .bold)); Spacer(); Button("ເບິ່ງທັງໝົດ") { model.navigate(.notifications) } }
                    if alerts.isEmpty { EmptyNotice(title: "ບໍ່ມີວຽກແຈ້ງເຕືອນ", detail: "ໂຫຼດຄືນເພື່ອກວດສະຖານະລ່າສຸດ", symbol: "checkmark.circle") }
                    else { ForEach(Array(alerts.prefix(5))) { alert in HStack(alignment: .top, spacing: 14) { StatusLabel(alert.text("type") == "urgent" ? "ດ່ວນ" : "ຕິດຕາມ", tone: alert.text("type") == "urgent" ? .danger : .warning); VStack(alignment: .leading, spacing: 4) { Text(alert.text("title")).font(Theme.font(14, weight: .semibold)); Text(alert.text("detail")).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true) }; Spacer() }.padding(.vertical, 8); Divider() } }
                }.padding(20).background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
                Text("ສິນຄ້າໃນຮ້ານ \(dashboard.text("cupsInStores")) ຖ້ວຍ · ຄວາມຈຸລວມ \(dashboard.text("totalCapacity")) ຖ້ວຍ").foregroundStyle(Theme.muted)
            }
        }.task { await state.load(model, "overview") }
    }
    private func metric(_ title: String, value: JSONValue, detail: String, destination: Destination, money: Bool = false) -> some View {
        Button { model.navigate(destination) } label: {
            VStack(alignment: .leading, spacing: 10) { Label(title, systemImage: destination.symbol).foregroundStyle(destination.domain.color); AmountText(value.decimal, currency: money).font(Theme.font(26, weight: .bold)).foregroundStyle(Theme.ink); Text(detail).font(Theme.font(12)).foregroundStyle(Theme.muted) }.frame(maxWidth: .infinity, minHeight: 110, alignment: .leading).padding(20).background(Theme.surface, in: RoundedRectangle(cornerRadius: 10)).overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.border))
        }.buttonStyle(.plain).disabled(!destination.isAllowed(role: model.session?.role ?? ""))
    }
}

struct PendingRecoveryView: View {
    @ObservedObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var busy: String?
    @State private var error: String?
    @State private var resolved: String?
    @State private var reconcile: PendingCommand?
    @State private var importingReview = false
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack { Text("ກວດກາລາຍການຄ້າງ").font(Theme.font(24, weight: .bold)); Spacer(); Button("ປິດ") { dismiss() }.keyboardShortcut(.cancelAction).disabled(busy != nil) }
            Text("ຄຳຂໍທີ່ຍັງບໍ່ຮູ້ຜົນຈະຖືກເກັບໃນເຄື່ອງ ແລະແຍກຕາມບັນຊີ. ລອງລາຍການເດີມເພື່ອກວດຜົນກ່ອນສ້າງໃໝ່.").foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true)
            if !model.legacyReviewed { Label("ກ່ອນໃຊ້ງານ ຕ້ອງກວດສະບັບຮ່າງ/ລາຍການຄ້າງຈາກ Yogurt Manager ຕົວເດີມ. ຂໍ້ມູນເດີມຍັງຖືກເກັບໄວ້.", systemImage: "exclamationmark.triangle").foregroundStyle(Theme.mango).fixedSize(horizontal: false, vertical: true) }
            if !model.legacyReviewed { Button("ນຳເຂົ້າຜົນກວດກາຈາກແອັບເດີມ…") { importingReview = true } }
            if let failure = model.recoveryError { Text(failure).foregroundStyle(Theme.danger) }
            if let error { Text(error).foregroundStyle(Theme.danger).textSelection(.enabled) }
            if let resolved { Label(resolved, systemImage: "checkmark.circle").foregroundStyle(Theme.green) }
            if model.pendingCommands.isEmpty { EmptyNotice(title: "ບໍ່ມີຄຳຂໍຄ້າງໃນບັນຊີນີ້", detail: "ສະບັບຮ່າງຂອງແຕ່ລະວຽກຈະປາກົດເມື່ອເປີດແບບຟອມນັ້ນ", symbol: "checkmark.circle") }
            else {
                ScrollView { VStack(alignment: .leading, spacing: 18) { ForEach(model.pendingCommands) { command in
                    VStack(alignment: .leading, spacing: 12) {
                        HStack { Text(title(command.path)).font(Theme.font(17, weight: .semibold)); Spacer(); Text(command.createdAt, style: .date).foregroundStyle(Theme.muted) }
                        Text(command.id).font(.system(size: 11, design: .monospaced)).foregroundStyle(Theme.muted).textSelection(.enabled)
                        if let payload = try? JSONDecoder().decode(JSONValue.self, from: command.body) {
                            let labels = ["storeId": "ຮ້ານ", "amount": "ຈຳນວນເງິນ", "paidAmount": "ເງິນຮັບ", "quantity": "ຈຳນວນ", "note": "ໝາຍເຫດ", "name": "ຊື່"]
                            ForEach(labels.keys.sorted(), id: \.self) { key in if !payload.text(key).isEmpty { LabeledContent(labels[key]!, value: payload.text(key)) } }
                        }
                        HStack {
                            if command.durable { Button("ລອງລາຍການເດີມ") { Task { await retry(command) } }.buttonStyle(.borderedProminent) }
                            else { StatusLabel("ຕ້ອງກວດຜົນຈາກລາຍການລ່າສຸດ", tone: .warning) }
                            Button("ກວດຜົນແລ້ວ…") { reconcile = command }
                            if busy == command.id { ProgressView().controlSize(.small) }
                        }.disabled(busy != nil || !model.canWrite)
                    }.padding(16).background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
                } } }
            }
        }.padding(24).frame(width: 750, height: 620).font(Theme.font()).background(Theme.cream).interactiveDismissDisabled(busy != nil)
        .task { await model.refreshPending() }
        .fileImporter(isPresented: $importingReview, allowedContentTypes: [.json]) { result in Task { do { try await model.importLegacyReview(result.get()); resolved = "ກວດກາແອັບເດີມແລ້ວ · ພ້ອມບັນທຶກລາຍການ" } catch { self.error = error.localizedDescription } } }
        .confirmationDialog("ຢືນຢັນວ່າກວດຜົນລາຍການແລ້ວ?", isPresented: Binding(get: { reconcile != nil }, set: { if !$0 { reconcile = nil } })) {
            Button("ກວດຜົນແລ້ວ · ນຳອອກຈາກລາຍການຄ້າງ") { if let command = reconcile { Task { do { try await model.confirmReconciled(command); resolved = "ລ້າງລາຍການຄ້າງທີ່ກວດແລ້ວ" } catch { self.error = error.localizedDescription }; reconcile = nil } } }
            Button("ຍົກເລີກ", role: .cancel) { reconcile = nil }
        } message: { Text("ກວດລາຍການລ່າສຸດໃນຮ້ານ/ສະຕັອກ/ການເງິນແລ້ວກ່ອນ. ການນຳອອກບໍ່ໄດ້ຍົກເລີກຫຼືສ້າງລາຍການໃນຖານຂໍ້ມູນ.") }
    }
    private func title(_ path: String) -> String {
        if path.contains("settlements") { return "ຮັບເງິນ" }; if path.contains("restock") { return "ກວດຮ້ານ / ປິດຮອບ" }; if path.contains("expense") { return "ລາຍຈ່າຍ" }; if path.contains("production") { return "ການຜະລິດ" }; if path.contains("inventory") { return "ວັດຖຸດິບ" }; if path.contains("refill") { return "ເຕີມສິນຄ້າ" }; if path.contains("store") { return "ຮ້ານຄ້າ" }; return "ຈັດການລະບົບ"
    }
    private func retry(_ command: PendingCommand) async { busy = command.id; error = nil; defer { busy = nil }; do { _ = try await model.retry(command); resolved = "ຢືນຢັນລາຍການເດີມສຳເລັດ. ໂຫຼດໜ້າວຽກຄືນເພື່ອເບິ່ງຜົນ" } catch { self.error = error.localizedDescription } }
}
