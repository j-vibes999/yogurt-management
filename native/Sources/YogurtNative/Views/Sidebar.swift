import SwiftUI

/// Evergreen navigation shared with the web app (DESIGN.md › Navigation): quiet group labels,
/// light labels on evergreen, a mint active surface with dark text, and the signed-in user below.
struct SidebarView: View {
    @ObservedObject var model: AppModel
    let session: NativeSession
    private static let groups: [(title: String, items: [Destination])] = [
        ("ວຽກປະຈຳວັນ", [.overview, .stores, .map, .refills, .driver, .settlements]),
        ("ສະຕັອກ ແລະການຜະລິດ", [.inventory, .production]),
        ("ການເງິນ", [.expenses, .reports]),
        ("ຈັດການ", [.operations]),
    ]
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SidebarBrand().padding(.horizontal, 8).padding(.bottom, 16)
            Rectangle().fill(.white.opacity(0.08)).frame(height: 1).padding(.bottom, 12)
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(Self.groups, id: \.title) { group in
                        let items = group.items.filter { $0.isAllowed(role: session.role) }
                        if !items.isEmpty {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(group.title).font(Theme.font(12, weight: .semibold)).foregroundStyle(Theme.sidebarText)
                                    .padding(.horizontal, 10).padding(.top, 4).padding(.bottom, 2).accessibilityAddTraits(.isHeader)
                                ForEach(items) { destination in
                                    SidebarItem(destination: destination, active: model.selected == destination, count: model.navCounts[destination]) { model.navigate(destination) }
                                }
                            }
                        }
                    }
                }.padding(.bottom, 12)
            }.scrollIndicators(.never)
            SidebarAccount(model: model, session: session).padding(.top, 8)
        }
        .padding(.horizontal, 12).padding(.top, 6).padding(.bottom, 14)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Theme.evergreen.ignoresSafeArea())
        .environment(\.colorScheme, .dark)
    }
}

private struct SidebarItem: View {
    let destination: Destination
    let active: Bool
    let count: Int?
    let action: () -> Void
    @State private var hovering = false
    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: destination.symbol).font(.system(size: 14, weight: .medium)).frame(width: 19)
                    .foregroundStyle(active ? Theme.evergreen : hovering ? .white : Theme.sidebarIcon)
                Text(destination.title).font(Theme.font(14, weight: active ? .bold : .medium)).lineLimit(1)
                    .foregroundStyle(active ? Theme.evergreen : hovering ? .white : Theme.surfaceSoft)
                Spacer(minLength: 4)
                if let count, count > 0 {
                    Text(count > 99 ? "99+" : "\(count)").font(.system(size: 11, weight: .bold)).monospacedDigit()
                        .foregroundStyle(active ? Theme.evergreen : Theme.surfaceSoft)
                        .padding(.horizontal, 6).frame(minWidth: 22, minHeight: 20)
                        .background(active ? Color.white : Color.white.opacity(0.12), in: Capsule())
                        .overlay(Capsule().strokeBorder(active ? Color.white : Color.white.opacity(0.18)))
                }
            }
            .padding(.horizontal, 11).frame(height: 38)
            .background(active ? Theme.mint : hovering ? Color.white.opacity(0.08) : .clear, in: RoundedRectangle(cornerRadius: 9))
            .overlay(RoundedRectangle(cornerRadius: 9).strokeBorder(active ? Color.white.opacity(0.22) : .clear))
            .contentShape(RoundedRectangle(cornerRadius: 9))
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.15), value: hovering)
        .accessibilityLabel(count.map { "\(destination.title), \($0) ລາຍການ" } ?? destination.title)
        .accessibilityAddTraits(active ? .isSelected : [])
    }
}

private struct SidebarBrand: View {
    var body: some View {
        HStack(spacing: 11) {
            BrandMark().frame(width: 24, height: 24).foregroundStyle(Theme.evergreen)
                .frame(width: 38, height: 38).background(Theme.accent, in: RoundedRectangle(cornerRadius: 10))
            VStack(alignment: .leading, spacing: 1) {
                Text("Yogurt Manager").font(Theme.font(15, weight: .bold)).foregroundStyle(.white)
                Text("ລະບົບຈັດການໂຢເກີດ").font(Theme.font(12, weight: .semibold)).foregroundStyle(Theme.sidebarText)
            }
        }.accessibilityElement(children: .combine)
    }
}

private struct SidebarAccount: View {
    @ObservedObject var model: AppModel
    let session: NativeSession
    private var roleLabel: String { session.role == "admin" ? "ຜູ້ຈັດການ" : session.role == "driver" ? "ຈັດສົ່ງ / ຮັບເງິນ" : "ຝ່າຍຜະລິດ" }
    private var online: Bool { session.source == "database" }
    var body: some View {
        HStack(spacing: 10) {
            Text(String(session.fullName.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased())
                .font(Theme.font(13, weight: .bold)).foregroundStyle(.white)
                .frame(width: 32, height: 32)
                .background(LinearGradient(colors: [Theme.success, Theme.green], startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: 8))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(session.fullName).font(Theme.font(13, weight: .bold)).foregroundStyle(.white).lineLimit(1)
                HStack(spacing: 5) {
                    Circle().fill(online ? Theme.onlineDot : Theme.accent).frame(width: 6, height: 6)
                    Text(online ? roleLabel : "\(roleLabel) · ອອຟລາຍ").font(Theme.font(12, weight: .semibold)).foregroundStyle(Theme.sidebarText).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            Button { logout() } label: {
                Image(systemName: "rectangle.portrait.and.arrow.right").font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(hoveringLogout ? .white : Theme.sidebarText).frame(width: 28, height: 28)
                    .background(hoveringLogout ? Theme.danger.opacity(0.35) : .clear, in: RoundedRectangle(cornerRadius: 6))
            }
            .buttonStyle(.plain).onHover { hoveringLogout = $0 }.help("ອອກຈາກລະບົບ").accessibilityLabel("ອອກຈາກລະບົບ")
        }
        .padding(.horizontal, 10).padding(.vertical, 12)
        .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 12))
        .overlay(alignment: .top) { Rectangle().fill(.white.opacity(0.08)).frame(height: 1).padding(.horizontal, 12) }
        .contextMenu {
            Button("ກວດກາການເຊື່ອມຕໍ່", systemImage: "arrow.clockwise") { Task { do { try await model.refreshSession() } catch { model.showNotice(error.localizedDescription) } } }
            Button("ອອກຈາກລະບົບ", systemImage: "rectangle.portrait.and.arrow.right") { logout() }
        }
    }
    @State private var hoveringLogout = false
    private func logout() { Task { do { try await model.logout() } catch { model.showNotice(error.localizedDescription) } } }
}

/// The cup-and-leaf mark from `src/components/brand-mark.tsx`, drawn on its 32-point grid.
struct BrandMark: View {
    var body: some View {
        Canvas { context, size in
            let scale = min(size.width, size.height) / 32
            context.scaleBy(x: scale, y: scale)
            let ink = GraphicsContext.Shading.style(.foreground)
            var cup = Path(); cup.move(to: CGPoint(x: 7, y: 13)); cup.addLine(to: CGPoint(x: 25, y: 13)); cup.addLine(to: CGPoint(x: 22.8, y: 26)); cup.addLine(to: CGPoint(x: 9.2, y: 26)); cup.closeSubpath()
            context.fill(cup, with: .color(Theme.mint)); context.stroke(cup, with: ink, style: StrokeStyle(lineWidth: 1.8, lineJoin: .round))
            var rims = Path(); rims.move(to: CGPoint(x: 6, y: 13)); rims.addLine(to: CGPoint(x: 26, y: 13)); rims.move(to: CGPoint(x: 11, y: 19)); rims.addLine(to: CGPoint(x: 21, y: 19))
            context.stroke(rims, with: ink, style: StrokeStyle(lineWidth: 1.8, lineCap: .round))
            var leaf = Path(); leaf.move(to: CGPoint(x: 16, y: 11))
            leaf.addCurve(to: CGPoint(x: 24, y: 4), control1: CGPoint(x: 15, y: 6), control2: CGPoint(x: 19.1, y: 3.5))
            leaf.addCurve(to: CGPoint(x: 16, y: 11), control1: CGPoint(x: 22.6, y: 8.7), control2: CGPoint(x: 20.2, y: 11.1)); leaf.closeSubpath()
            context.fill(leaf, with: .color(Theme.accent)); context.stroke(leaf, with: ink, style: StrokeStyle(lineWidth: 1.4, lineJoin: .round))
            var stem = Path(); stem.move(to: CGPoint(x: 16, y: 11)); stem.addLine(to: CGPoint(x: 20, y: 7))
            context.stroke(stem, with: ink, style: StrokeStyle(lineWidth: 1.4, lineCap: .round))
        }.accessibilityHidden(true)
    }
}
