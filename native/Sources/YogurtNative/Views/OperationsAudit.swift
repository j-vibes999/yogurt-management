import SwiftUI

struct OperationsCountEntry: Equatable {
    var remaining: String
    var expired: String
}

/// A protected three-stage task. Monetary values below are a preview; the transaction is authoritative.
struct OperationsAuditView: View {
    @ObservedObject var model: AppModel
    let storeId: String
    let paymentOnly: Bool
    @Environment(\.dismiss) private var dismiss
    @StateObject private var storeState = FeatureState()
    @StateObject private var auditState = FeatureState()
    @State private var snapshot: JSONValue = .null
    @State private var entries: [String: OperationsCountEntry] = [:]
    @State private var paid = "0"
    @State private var method = "cash"
    @State private var stage = 1
    @State private var ready = false
    @State private var busy = false
    @State private var dirty = false
    @State private var saved = false
    @State private var saveError: String?
    @State private var error: String?
    @State private var close = false
    @State private var staleDraft: JSONValue?
    @State private var reconcileDraft = false
    @State private var rejected = false
    @State private var submitted: JSONValue?
    @State private var completion: JSONValue?
    @State private var receipt: JSONValue?
    @State private var ownerId = ""
    private var key: String { "operations.\(paymentOnly ? "payment" : "audit").\(storeId)" }
    private var lines: [JSONValue] { snapshot["lines"].array }
    private var userId: String { ownerId }
    private var previousBalance: Decimal { snapshot["previousBalance"].decimal }
    private var paidAmount: Decimal? { (try? canonicalDecimal(paid, scale: 2)).flatMap { Decimal(string: $0) } }
    private var canWrite: Bool { model.canWrite && model.session?.userId == ownerId && storeState.source == "database" && (paymentOnly || auditState.source == "database") }
    private var gross: Decimal {
        lines.reduce(Decimal.zero) { total, line in
            total + Decimal(sold(line) ?? 0) * line["retailPrice"].decimal
        }
    }
    private var commission: Decimal { rounded(gross * snapshot["store"]["commissionRate"].decimal) }
    private var due: Decimal { paymentOnly ? previousBalance : previousBalance + gross - commission }
    private var validCounts: Bool { !lines.isEmpty && lines.allSatisfy { sold($0) != nil } }
    private var validPayment: Bool { paidAmount != nil && paidAmount! <= due && (!paymentOnly || paidAmount! > 0) }
    private var draft: JSONValue {
        .object([
            "version": .number(1), "userId": .string(userId), "storeId": .string(storeId),
            "paymentOnly": .bool(paymentOnly), "snapshot": snapshot,
            "entries": .object(entries.mapValues { .object(["remaining": .string($0.remaining), "expired": .string($0.expired)]) }),
            "paidAmount": .string(paid), "paymentMethod": .string(method), "stage": .number(Decimal(stage)),
            "submitted": submitted ?? .null, "completion": completion ?? .null
        ])
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(paymentOnly ? "ຮັບເງິນຄ້າງ" : "ກວດຮ້ານ / ປິດຮອບ").font(Theme.font(24, weight: .bold))
                    Text(snapshot["store"].text("name")).font(Theme.font(16, weight: .semibold)).foregroundStyle(Theme.blue)
                }
                Spacer()
                Button("ປິດ") { requestClose() }.keyboardShortcut(.cancelAction).disabled(busy)
            }
            if storeState.loading && !ready { ProgressView("ກຳລັງໂຫຼດຮ້ານ…").frame(maxWidth: .infinity, maxHeight: .infinity) }
            else if !ready {
                VStack(alignment: .leading, spacing: 16) {
                    OperationsIssue(text: error ?? storeState.error ?? auditState.error ?? "ບໍ່ພົບຮ້ານ ຫຼືຕູ້ແຊ່ສຳລັບຮອບກວດ")
                    Button("ໂຫຼດຄືນ") { Task { await load() } }
                }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            } else if let completion {
                completionView(completion)
            } else {
                if !canWrite { StatusLabel("ອ່ານຢ່າງດຽວ · ຕ້ອງເຊື່ອມຕໍ່ຖານຂໍ້ມູນກ່ອນບັນທຶກ", tone: .warning) }
                if !paymentOnly { stages }
                if staleDraft != nil { staleDraftView }
                if let saveError { OperationsIssue(text: saveError) }
                if submitted != nil {
                    Label("ມີຄຳຂໍທີ່ຍັງລໍຜົນ. ລອງຄຳຂໍເດີມເພື່ອຢືນຢັນຜົນ.", systemImage: "clock.arrow.circlepath").foregroundStyle(Theme.muted)
                }
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        if paymentOnly || stage == 2 { paymentFields }
                        else if stage == 1 { countFields }
                        else { review }
                    }.padding(.vertical, 4)
                }.disabled(busy || submitted != nil || staleDraft != nil)
                if let error { OperationsIssue(text: error) }
                if rejected { Button("ໂຫຼດຂໍ້ມູນລ່າສຸດ ແລະກວດສະບັບຮ່າງ") { Task { await load() } }.disabled(busy) }
                Divider()
                HStack(spacing: 12) {
                    if !paymentOnly && stage > 1 {
                        Button("ກັບຄືນ") { stage -= 1; dirty = true }.disabled(busy || submitted != nil || staleDraft != nil)
                    }
                    if saved && dirty { Label("ເກັບສະບັບຮ່າງແລ້ວ", systemImage: "checkmark").font(Theme.font(12)).foregroundStyle(Theme.muted) }
                    Spacer()
                    if busy { ProgressView().controlSize(.small) }
                    if submitted != nil {
                        Button("ລອງຄຳຂໍເດີມ") { Task { await submit() } }.buttonStyle(.borderedProminent).disabled(busy || !canWrite)
                    } else if paymentOnly || stage == 3 {
                        Button(paymentOnly ? "ຢືນຢັນຮັບເງິນ" : "ຢືນຢັນ ແລະປິດຮອບ") { Task { await submit() } }
                            .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                            .disabled(busy || !canWrite || !validPayment || (!paymentOnly && !validCounts) || staleDraft != nil)
                    } else {
                        Button(stage == 1 ? "ຕໍ່ໄປ · ຮັບເງິນ" : "ຕໍ່ໄປ · ກວດສະຫຼຸບ") { stage += 1; dirty = true }
                            .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                            .disabled(staleDraft != nil || (stage == 1 ? !validCounts : !validPayment))
                    }
                }
            }
        }.padding(24).frame(minWidth: 760, idealWidth: 860, minHeight: 680, idealHeight: 760).font(Theme.font())
        .interactiveDismissDisabled(busy || dirty || submitted != nil)
        .task { await load() }
        .task(id: draft) {
            guard ready, dirty, completion == nil, staleDraft == nil else { return }
            do { try await Task.sleep(for: .milliseconds(350)); try Task.checkCancellation(); await persist() }
            catch { /* A newer edit owns the next save. */ }
        }
        .confirmationDialog(submitted == nil ? "ເກັບວຽກກ່ອນປິດ?" : "ຄຳຂໍນີ້ຍັງລໍຜົນ", isPresented: $close, titleVisibility: .visible) {
            Button("ເກັບສະບັບຮ່າງ ແລະປິດ") { Task { await persist(); if saveError == nil { dismiss() } } }
            if submitted == nil { Button("ປະຖິ້ມສະບັບຮ່າງ", role: .destructive) { Task { do { try await model.removeDraft(key: key, startNewIntent: true); dismiss() } catch { saveError = error.localizedDescription } } } }
            Button("ເຮັດຕໍ່", role: .cancel) {}
        } message: { Text(submitted == nil ? "ສະບັບຮ່າງຈະຜູກກັບບັນຊີ, ຮ້ານ ແລະຂໍ້ມູນຮອບນີ້." : "ຄຳຂໍເດີມ ແລະລະຫັດລາຍການຈະຖືກເກັບໄວ້ ເພື່ອກວດຜົນເມື່ອເປີດຄືນ.") }
        .sheet(item: $receipt) { row in OperationsReceiptView(model: model, row: row, storeName: snapshot["store"].text("name")) }
    }
    private var stages: some View {
        HStack(spacing: 16) {
            ForEach(1...3, id: \.self) { number in
                HStack(spacing: 8) {
                    Image(systemName: number < stage ? "checkmark.circle.fill" : "\(number).circle\(number == stage ? ".fill" : "")")
                    Text(number == 1 ? "ນັບສິນຄ້າ" : number == 2 ? "ຮັບເງິນ" : "ກວດສະຫຼຸບ")
                }.font(Theme.font(14, weight: number == stage ? .semibold : .regular)).foregroundStyle(number == stage ? Theme.green : Theme.muted)
                if number < 3 { Divider().frame(height: 20) }
            }
        }.padding(.vertical, 8).accessibilityElement(children: .combine).accessibilityLabel("ຂັ້ນຕອນ \(stage) ໃນ 3")
    }
    private var countFields: some View {
        VStack(alignment: .leading, spacing: 24) {
            Text("1. ນັບສິນຄ້າໃນຕູ້").font(Theme.font(20, weight: .semibold))
            Text("ຈຳນວນກ່ອນນັບລວມການເຕີມແລ້ວ. ໃສ່ຈຳນວນທີ່ເຫຼືອຈິງ ແລະສິນຄ້າເສຍ/ໝົດອາຍຸທີ່ເອົາອອກ.").foregroundStyle(Theme.muted)
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                VStack(alignment: .leading, spacing: 12) {
                    HStack { Text(line.text("name")).font(Theme.font(16, weight: .semibold)); Spacer(); MoneyText(line["retailPrice"]); Text("/ ຖ້ວຍ").foregroundStyle(Theme.muted) }
                    HStack(alignment: .top, spacing: 24) {
                        VStack(alignment: .leading, spacing: 6) { Text("ກ່ອນນັບ").foregroundStyle(Theme.muted); Text(line["previousStock"].text).font(Theme.font(20, weight: .semibold)).monospacedDigit(); Text("ເຕີມແລ້ວ " + line["refilledSinceAudit"].text).font(Theme.font(12)).foregroundStyle(Theme.muted) }.frame(width: 120, alignment: .leading)
                        countField("ຄົງເຫຼືອຈິງ", id: line.text("productId"), expired: false)
                        countField("ເສຍ / ໝົດອາຍຸ", id: line.text("productId"), expired: true)
                        VStack(alignment: .trailing, spacing: 6) { Text("ຂາຍໄດ້").foregroundStyle(Theme.muted); Text(sold(line).map { "\($0) ຖ້ວຍ" } ?? "ກວດຈຳນວນ").font(Theme.font(16, weight: .semibold)).foregroundStyle(sold(line) == nil ? Theme.danger : Theme.ink) }.frame(maxWidth: .infinity, alignment: .trailing)
                    }
                    if sold(line) == nil { OperationsIssue(text: "ຈຳນວນຕ້ອງເປັນຈຳນວນເຕັມບໍ່ຕິດລົບ. ຄົງເຫຼືອ + ຂອງເສຍ ຕ້ອງບໍ່ເກີນຈຳນວນກ່ອນນັບ.") }
                    Divider()
                }
            }
            LabeledContent("ຍອດຂາຍລວມ (ຕົວຢ່າງກ່ອນຢືນຢັນ)") { AmountText(gross) }
        }
    }
    private func countField(_ title: String, id: String, expired: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
            TextField("0", text: Binding(get: { expired ? entries[id]?.expired ?? "0" : entries[id]?.remaining ?? "0" }, set: { value in
                var entry = entries[id] ?? OperationsCountEntry(remaining: "0", expired: "0")
                if expired { entry.expired = value } else { entry.remaining = value }
                entries[id] = entry; dirty = true; saved = false
            })).textFieldStyle(.roundedBorder).frame(width: 140).accessibilityLabel(title + " " + (lines.first { $0.text("productId") == id }?.text("name") ?? ""))
        }
    }
    private var paymentFields: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text(paymentOnly ? "ຮັບເງິນຄ້າງຢ່າງດຽວ" : "2. ຮັບເງິນ").font(Theme.font(20, weight: .semibold))
            if paymentOnly { Text("ລາຍການນີ້ບັນທຶກການຮັບເງິນຄ້າງ. ຈຳນວນສິນຄ້າ ແລະຮອບກວດຈະຍັງຄົງເດີມ.").foregroundStyle(Theme.muted) }
            LabeledContent("ຍອດຄ້າງເດີມ") { AmountText(previousBalance) }
            if !paymentOnly {
                LabeledContent("ຍອດຂາຍ") { AmountText(gross) }
                LabeledContent("ສ່ວນແບ່ງຮ້ານ") { AmountText(commission) }
                LabeledContent("ສ່ວນເຮົາຮອບນີ້") { AmountText(gross - commission) }
            }
            LabeledContent("ຕ້ອງຮັບທັງໝົດ") { AmountText(due).font(Theme.font(22, weight: .semibold)) }
            Divider()
            HStack(alignment: .top, spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("ຈຳນວນເງິນທີ່ຮັບ (LAK)")
                    TextField("0.00", text: $paid).textFieldStyle(.roundedBorder).accessibilityLabel("ຈຳນວນເງິນທີ່ຮັບ (LAK)").onChange(of: paid) { _, _ in dirty = true; saved = false }
                    if !validPayment { OperationsIssue(text: "ໃສ່ຍອດເງິນທີ່ບໍ່ເກີນຍອດຕ້ອງຮັບ ແລະມີບໍ່ເກີນ 2 ຕຳແໜ່ງ" + (paymentOnly ? " (ຫຼາຍກວ່າ 0)" : "")) }
                }
                Picker("ວິທີຮັບເງິນ", selection: $method) { Text("ເງິນສົດ").tag("cash"); Text("ໂອນທະນາຄານ").tag("bank") }.pickerStyle(.segmented).frame(width: 300).onChange(of: method) { _, _ in dirty = true; saved = false }
            }
            Button("ຮັບເຕັມຈຳນວນ") { paid = NSDecimalNumber(decimal: due).stringValue; dirty = true; saved = false }.disabled(due <= 0)
            LabeledContent("ຄົງເຫຼືອຫຼັງຮັບ") { AmountText(max(0, due - (paidAmount ?? 0))) }
        }
    }
    private var review: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("3. ກວດສະຫຼຸບ ແລະຢືນຢັນ").font(Theme.font(20, weight: .semibold))
            Text("ຫຼັງຢືນຢັນ ລະບົບຈະປັບຈຳນວນໃນຕູ້, ບັນທຶກຍອດຂາຍ ແລະອອກເລກໃບເສັດ.").foregroundStyle(Theme.muted)
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                HStack { Text(line.text("name")); Spacer(); Text("ຂາຍ \(sold(line) ?? 0) · ຄົງເຫຼືອ \(entries[line.text("productId")]?.remaining ?? "0") · ເສຍ \(entries[line.text("productId")]?.expired ?? "0")").monospacedDigit() }
            }
            Divider()
            LabeledContent("ຍອດຂາຍ") { AmountText(gross) }
            LabeledContent("ສ່ວນແບ່ງຮ້ານ") { AmountText(commission) }
            LabeledContent("ຍອດຄ້າງເດີມ") { AmountText(previousBalance) }
            LabeledContent("ຕ້ອງຮັບທັງໝົດ") { AmountText(due) }
            LabeledContent("ຮັບເງິນ · " + (method == "cash" ? "ເງິນສົດ" : "ໂອນທະນາຄານ")) { AmountText(paidAmount ?? 0) }
            LabeledContent("ຄົງເຫຼືອຫຼັງຮັບ") { AmountText(max(0, due - (paidAmount ?? 0))).font(Theme.font(20, weight: .semibold)) }
        }
    }
    private var staleDraftView: some View {
        VStack(alignment: .leading, spacing: 12) {
            OperationsIssue(text: reconcileDraft ? "ພົບສະບັບຮ່າງຂອງຄຳຂໍທີ່ສົ່ງແລ້ວ. ກວດປະຫວັດຮັບເງິນກ່ອນເລີ່ມລາຍການໃໝ່; ຄຳຂໍນີ້ອາດບັນທຶກແລ້ວ." : "ມີສະບັບຮ່າງຈາກຂໍ້ມູນຮອບເກົ່າ. ຈຳນວນ, ລາຄາ ຫຼືຍອດຄ້າງປ່ຽນແປງແລ້ວ; ຕ້ອງນັບ ແລະກວດຍອດໃໝ່.")
            HStack {
                Button("ສົ່ງອອກຈຳນວນເກົ່າ") { exportStaleDraft() }
                if reconcileDraft { Button("ກວດປະຫວັດຮັບເງິນ") { model.navigate(.settlements, storeId: storeId); dismiss() } }
                Button(reconcileDraft ? "ກວດແລ້ວ · ເລີ່ມຮອບໃໝ່" : "ເລີ່ມຈາກຂໍ້ມູນລ່າສຸດ", role: .destructive) { Task { do { try await model.removeDraft(key: key, startNewIntent: true); staleDraft = nil; reconcileDraft = false; dirty = false; saved = false; submitted = nil; paid = "0"; stage = 1; await load() } catch { saveError = error.localizedDescription } } }
            }
        }.padding(16).background(Theme.mango.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
    }
    private func completionView(_ result: JSONValue) -> some View {
        VStack(alignment: .leading, spacing: 24) {
            Label("ບັນທຶກສຳເລັດ", systemImage: "checkmark.circle.fill").font(Theme.font(23, weight: .semibold)).foregroundStyle(Theme.green)
            Text(result.text("receiptNumber")).font(Theme.font(18, weight: .semibold)).textSelection(.enabled)
            LabeledContent("ຮັບເງິນແລ້ວ") { MoneyText(result["paidAmount"]) }
            LabeledContent("ຄົງເຫຼືອ") { MoneyText(result["closingBalance"]) }
            StatusLabel(operationsStatus(result.text("paymentStatus")), tone: operationsTone(result.text("paymentStatus")))
            HStack {
                Button("ເບິ່ງໃບເສັດທີ່ບັນທຶກ") { Task { await openPersistedReceipt(result) } }
                Button("ໄປລາຍການຮັບເງິນ") { model.navigate(.settlements, storeId: storeId); dismiss() }
                Button("ເລີ່ມຮອບໃໝ່") { Task { do { try await model.removeDraft(key: key, startNewIntent: true); completion = nil; submitted = nil; dirty = false; saved = false; paid = "0"; stage = 1; await load() } catch { self.error = error.localizedDescription } } }
                Button("ສຳເລັດ") { dismiss() }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
            }
            if let error { OperationsIssue(text: error) }
            Spacer()
        }.padding(.top, 24).frame(maxWidth: .infinity, alignment: .leading)
    }
    private func load() async {
        guard !busy else { return }
        ready = false; error = nil; staleDraft = nil; reconcileDraft = false; rejected = false
        ownerId = model.session?.userId ?? ""
        async let storeRead: Void = storeState.load(model, "store", query: ["id": storeId])
        if !paymentOnly { await auditState.load(model, "restock", query: ["id": storeId]) }
        await storeRead
        let store = storeState.data["store"]
        guard !store.id.isEmpty else { return }
        let fresh: JSONValue
        if paymentOnly {
            fresh = .object(["store": store, "previousBalance": storeState.data["latestBalance"], "lines": .array([]), "fridge": store["fridge"]])
        } else {
            fresh = auditState.data["data"]
            guard !fresh["store"].id.isEmpty, !fresh["lines"].array.isEmpty else { return }
        }
        snapshot = fresh
        entries = Dictionary(uniqueKeysWithValues: lines.map { ($0.text("productId"), OperationsCountEntry(remaining: $0["previousStock"].text, expired: "0")) })
        do {
            if let old = try await model.loadDraft(key: key) {
                guard old.text("userId") == userId, old.text("storeId") == storeId, old["paymentOnly"].bool == paymentOnly else { throw OperationsError(message: "ສະບັບຮ່າງບໍ່ກົງກັບບັນຊີ ຫຼືຮ້ານນີ້") }
                if old["completion"] != .null {
                    completion = old["completion"]; snapshot = old["snapshot"]; dirty = false; ready = true; return
                }
                if old.text("nativeOutcome") == "reconciled" { staleDraft = old; reconcileDraft = true; ready = true; return }
                let hasCommand = await model.hasPendingCommand(path: paymentOnly ? "/api/settlements/pay" : "/api/restock-visits")
                let pending = old["submitted"] != .null && hasCommand
                if old["submitted"] != .null && !pending {
                    staleDraft = old; reconcileDraft = true
                } else if old["snapshot"] == fresh || pending {
                    snapshot = old["snapshot"]
                    entries = old["entries"].object.mapValues { OperationsCountEntry(remaining: $0.text("remaining"), expired: $0.text("expired")) }
                    paid = old.text("paidAmount"); method = old.text("paymentMethod") == "bank" ? "bank" : "cash"
                    stage = min(3, max(1, Int(old["stage"].double)))
                    submitted = old["submitted"] == .null ? nil : old["submitted"]
                    dirty = true; saved = true
                } else { staleDraft = old }
            }
        } catch { saveError = error.localizedDescription }
        ready = true
    }
    private func persist() async {
        guard ready, completion == nil, staleDraft == nil else { return }
        guard model.session?.userId == ownerId else { saveError = "ບັນຊີປ່ຽນແປງ; ເປີດຮອບກວດໃໝ່ຈາກບັນຊີເດີມ"; return }
        do { try await model.saveDraft(key: key, body: draft); saveError = nil; saved = true }
        catch { saveError = "ບໍ່ສາມາດເກັບສະບັບຮ່າງ: " + error.localizedDescription; saved = false }
    }
    private func submit() async {
        guard !busy, canWrite else { return }
        busy = true; error = nil
        defer { busy = false }
        do {
            if submitted == nil {
                guard validPayment, paymentOnly || validCounts else { throw OperationsError(message: "ກວດຈຳນວນ ແລະຍອດຮັບເງິນອີກຄັ້ງ") }
                let amount = try canonicalDecimal(paid, scale: 2)
                var body: [String: JSONValue] = ["storeId": .string(storeId), "paidAmount": .string(amount), "paymentMethod": .string(method)]
                if !paymentOnly {
                    body["fridgeAssetCode"] = snapshot["fridge"]["assetCode"]
                    body["expectedFinancialSnapshot"] = snapshot["expectedFinancialSnapshot"]
                    body["lines"] = .array(lines.map { line in
                        .object(["productId": line["productId"], "previousStock": line["previousStock"],
                                 "countRemaining": .string(entries[line.text("productId")]!.remaining),
                                 "countExpiredReturned": .string(entries[line.text("productId")]!.expired),
                                 "countRefilled": line["refilledSinceAudit"]])
                    })
                    guard body["expectedFinancialSnapshot"] != .null else { throw OperationsError(message: "ບໍ່ມີຂໍ້ມູນຮອບບັນຊີ; ກະລຸນາໂຫຼດຄືນ") }
                }
                submitted = .object(body); dirty = true
            }
            try await model.saveDraft(key: key, body: draft)
            let result = try await model.mutate(paymentOnly ? "/api/settlements/pay" : "/api/restock-visits", body: submitted!, draftKey: key)
            guard !result.text("receiptNumber").isEmpty, !result.text("settlementId").isEmpty else { throw OperationsError(message: "ຜົນຕອບບໍ່ຄົບ. ກະລຸນາກວດຄຳຂໍເດີມ.") }
            completion = result; submitted = nil; dirty = false
            try await model.saveDraft(key: key, body: draft)
            try await model.removeDraft(key: key)
            model.showNotice("ບັນທຶກສຳເລັດ · " + result.text("receiptNumber"))
        } catch {
            self.error = error.localizedDescription
            let pending = await model.hasPendingCommand(path: paymentOnly ? "/api/settlements/pay" : "/api/restock-visits")
            if completion == nil && !pending {
                submitted = nil; rejected = true
                await persist()
            }
        }
    }
    private func openPersistedReceipt(_ result: JSONValue) async {
        do {
            let response = try await model.read("store", query: ["id": storeId])
            guard let row = response.data["settlements"].array.first(where: { $0.id == result.text("settlementId") }) else { throw OperationsError(message: "ບໍ່ພົບໃບເສັດ; ເປີດປະຫວັດຮັບເງິນເພື່ອຄົ້ນຫາເລກໃບເສັດ") }
            receipt = row
        } catch { self.error = error.localizedDescription }
    }
    private func requestClose() { if busy { return }; if completion != nil || (!dirty && submitted == nil) { dismiss() } else { close = true } }
    private func sold(_ line: JSONValue) -> Int? {
        let id = line.text("productId")
        guard let entry = entries[id], let remaining = whole(entry.remaining), let expired = whole(entry.expired), let before = whole(line["previousStock"].text), remaining <= before, expired <= before - remaining else { return nil }
        return before - remaining - expired
    }
    private func whole(_ text: String) -> Int? {
        guard text.range(of: "^[0-9]+$", options: .regularExpression) != nil, let count = Int(text), count <= 2147483647 else { return nil }
        return count
    }
    private func rounded(_ decimal: Decimal) -> Decimal { var input = decimal; var result = Decimal(); NSDecimalRound(&result, &input, 2, .plain); return result }
    private func exportStaleDraft() {
        guard let old = staleDraft else { return }
        model.exportCSV(name: "audit-draft-\(storeId)", headers: ["ສິນຄ້າ", "ກ່ອນນັບ", "ຄົງເຫຼືອ", "ເສຍ", "ລາຄາ"], rows: old["snapshot"]["lines"].array.map { line in [line.text("name"), line["previousStock"].text, old["entries"][line.text("productId")].text("remaining"), old["entries"][line.text("productId")].text("expired"), line["retailPrice"].text] })
    }
}
