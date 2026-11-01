import SwiftUI
import MapKit

/// OpenStreetMap street tiles, the same source the web map uses (src/components/store-map.tsx).
final class StreetTileOverlay: MKTileOverlay {
    // OSM's tile policy asks for an identifying User-Agent and local caching.
    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.httpAdditionalHeaders = ["User-Agent": "YogurtManagerMac/0.1 (local business map)"]
        configuration.urlCache = URLCache(memoryCapacity: 16 * 1024 * 1024, diskCapacity: 128 * 1024 * 1024)
        configuration.requestCachePolicy = .returnCacheDataElseLoad
        return URLSession(configuration: configuration)
    }()
    init() {
        super.init(urlTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png")
        canReplaceMapContent = true; minimumZ = 2; maximumZ = 19
    }
    override func loadTile(at path: MKTileOverlayPath, result: @escaping (Data?, Error?) -> Void) {
        Self.session.dataTask(with: url(forTilePath: path)) { data, _, error in result(data, error) }.resume()
    }
}

struct StreetMapPin: Equatable {
    let id: String
    let title: String
    let latitude: Double
    let longitude: Double
    var warning = false
    var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: latitude, longitude: longitude) }
}

enum StreetMapDefaults {
    /// Central Vientiane, as on the web map.
    static let center = CLLocationCoordinate2D(latitude: 17.9757, longitude: 102.6137)
    static func region(around pins: [StreetMapPin]) -> MKCoordinateRegion {
        guard let south = pins.map(\.latitude).min(), let north = pins.map(\.latitude).max(),
              let west = pins.map(\.longitude).min(), let east = pins.map(\.longitude).max() else {
            return MKCoordinateRegion(center: center, span: MKCoordinateSpan(latitudeDelta: 0.08, longitudeDelta: 0.08))
        }
        // A lone store would otherwise zoom past the deepest tiles.
        return MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: (south + north) / 2, longitude: (west + east) / 2),
                                  span: MKCoordinateSpan(latitudeDelta: max((north - south) * 1.4, 0.02), longitudeDelta: max((east - west) * 1.4, 0.02)))
    }
}

/// MapKit view drawing OpenStreetMap tiles with store markers. `cameraID` moves the camera to
/// `camera` whenever it changes; `onPick` turns clicks into a chosen coordinate (location picker).
struct StreetMapView: NSViewRepresentable {
    var pins: [StreetMapPin]
    @Binding var selection: String?
    var camera: MKCoordinateRegion
    var cameraID: Int
    var onPick: ((CLLocationCoordinate2D) -> Void)? = nil
    var onCenterChange: ((CLLocationCoordinate2D) -> Void)? = nil

    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeNSView(context: Context) -> MKMapView {
        let map = PickingMapView()
        map.delegate = context.coordinator
        map.addOverlay(StreetTileOverlay(), level: .aboveLabels)
        map.showsCompass = true; map.showsScale = true; map.showsZoomControls = true
        map.pointOfInterestFilter = .excludingAll
        map.setRegion(camera, animated: false)
        map.onClick = { [weak coordinator = context.coordinator] in coordinator?.parent.onPick?($0) }
        context.coordinator.cameraID = cameraID
        sync(map, context: context)
        return map
    }
    func updateNSView(_ map: MKMapView, context: Context) {
        context.coordinator.parent = self
        sync(map, context: context)
        if context.coordinator.cameraID != cameraID { context.coordinator.cameraID = cameraID; map.setRegion(camera, animated: true) }
    }
    private func sync(_ map: MKMapView, context: Context) {
        if context.coordinator.shown != pins {
            map.removeAnnotations(map.annotations)
            map.addAnnotations(pins.map(StoreAnnotation.init))
            context.coordinator.shown = pins
        }
        let current = map.selectedAnnotations.compactMap { ($0 as? StoreAnnotation)?.pin.id }.first
        if current != selection {
            if let selection, let annotation = map.annotations.first(where: { ($0 as? StoreAnnotation)?.pin.id == selection }) { map.selectAnnotation(annotation, animated: true) }
            else { map.selectedAnnotations.forEach { map.deselectAnnotation($0, animated: false) } }
        }
    }

    final class StoreAnnotation: NSObject, MKAnnotation {
        let pin: StreetMapPin
        init(_ pin: StreetMapPin) { self.pin = pin }
        var coordinate: CLLocationCoordinate2D { pin.coordinate }
        var title: String? { pin.title }
    }

    final class Coordinator: NSObject, MKMapViewDelegate {
        var parent: StreetMapView
        var shown: [StreetMapPin] = []
        var cameraID = 0
        init(_ parent: StreetMapView) { self.parent = parent }
        func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            overlay is MKTileOverlay ? MKTileOverlayRenderer(overlay: overlay) : MKOverlayRenderer(overlay: overlay)
        }
        func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            guard let store = annotation as? StoreAnnotation else { return nil }
            let view = mapView.dequeueReusableAnnotationView(withIdentifier: "store") as? MKMarkerAnnotationView
                ?? MKMarkerAnnotationView(annotation: annotation, reuseIdentifier: "store")
            view.annotation = annotation
            view.markerTintColor = NSColor(store.pin.warning ? Theme.mango : Theme.blue)
            view.glyphImage = NSImage(systemSymbolName: store.pin.warning ? "exclamationmark" : "storefront", accessibilityDescription: nil)
            view.titleVisibility = .visible
            return view
        }
        func mapView(_ mapView: MKMapView, didSelect view: MKAnnotationView) {
            guard let store = view.annotation as? StoreAnnotation, parent.selection != store.pin.id else { return }
            parent.selection = store.pin.id
        }
        func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) { parent.onCenterChange?(mapView.centerCoordinate) }
    }
}

/// Reports a plain click (no drag) as a coordinate. MKMapView may track the drag inside its own
/// mouseDown, so the release is checked both there and in mouseUp, once per click.
final class PickingMapView: MKMapView {
    var onClick: ((CLLocationCoordinate2D) -> Void)?
    private var downPoint: NSPoint?
    override func mouseDown(with event: NSEvent) {
        downPoint = convert(event.locationInWindow, from: nil)
        super.mouseDown(with: event)
        if let release = NSApp.currentEvent, release.type == .leftMouseUp { finish(release) }
    }
    override func mouseUp(with event: NSEvent) { super.mouseUp(with: event); finish(event) }
    private func finish(_ event: NSEvent) {
        guard let start = downPoint, onClick != nil else { return }
        downPoint = nil
        let point = convert(event.locationInWindow, from: nil)
        if hypot(point.x - start.x, point.y - start.y) < 4 { onClick?(convert(point, toCoordinateFrom: self)) }
    }
}

/// Attribution required by OpenStreetMap's licence.
struct StreetMapAttribution: View {
    var body: some View {
        Text("© OpenStreetMap contributors").font(.system(size: 10)).foregroundStyle(Theme.ink)
            .padding(.horizontal, 6).padding(.vertical, 2).background(.white.opacity(0.85), in: RoundedRectangle(cornerRadius: 4)).padding(6)
    }
}

/// Choose a store's position by searching OpenStreetMap places or clicking the map.
struct StoreLocationPicker: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let latitude: String
    let longitude: String
    let onChoose: (String, String) -> Void
    @State private var chosen: CLLocationCoordinate2D?
    @State private var camera = MKCoordinateRegion(center: StreetMapDefaults.center, span: MKCoordinateSpan(latitudeDelta: 0.08, longitudeDelta: 0.08))
    @State private var cameraID = 0
    @State private var center = StreetMapDefaults.center
    @State private var query = ""
    @State private var results: [AppModel.PlaceResult] = []
    @State private var searching = false
    @State private var error: String?
    private var pins: [StreetMapPin] { chosen.map { [StreetMapPin(id: "chosen", title: "ຕຳແໜ່ງຮ້ານ", latitude: $0.latitude, longitude: $0.longitude)] } ?? [] }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("ປັກໝຸດຕຳແໜ່ງຮ້ານ").font(Theme.font(21, weight: .bold)).foregroundStyle(Theme.evergreen)
            Text("ຄົ້ນຫາສະຖານທີ່, ຄລິກໃສ່ແຜນທີ່ບ່ອນທີ່ຮ້ານຕັ້ງຢູ່ ຫຼືເລື່ອນແຜນທີ່ແລ້ວກົດ “ປັກໝຸດກາງແຜນທີ່”").foregroundStyle(Theme.muted)
            HStack {
                TextField("ຄົ້ນຫາສະຖານທີ່ໃນລາວ ເຊັ່ນ ດົງໂດກ", text: $query).textFieldStyle(.roundedBorder).onSubmit { Task { await search() } }
                Button { Task { await search() } } label: { Label("ຄົ້ນຫາ", systemImage: "magnifyingglass") }.disabled(searching || query.trimmingCharacters(in: .whitespaces).isEmpty)
            }.controlSize(.large)
            if let error { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(Theme.danger) }
            if !results.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(results) { place in
                        Button { choose(CLLocationCoordinate2D(latitude: place.latitude, longitude: place.longitude), zoom: 0.01); results = [] } label: {
                            Label(place.name, systemImage: "mappin.circle").lineLimit(1).frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 7).padding(.horizontal, 10).contentShape(Rectangle())
                        }.buttonStyle(.plain)
                        if place.id != results.last?.id { Divider() }
                    }
                }.background(Theme.surface).tableSurface()
            }
            StreetMapView(pins: pins, selection: .constant(nil), camera: camera, cameraID: cameraID, onPick: { choose($0, zoom: nil) }, onCenterChange: { center = $0 })
                .overlay { Image(systemName: "plus").font(.system(size: 16, weight: .light)).foregroundStyle(Theme.ink.opacity(0.6)).allowsHitTesting(false).accessibilityHidden(true) }
                .overlay(alignment: .bottomLeading) { StreetMapAttribution() }
                .overlay(alignment: .topTrailing) {
                    Button { choose(center, zoom: nil) } label: { Label("ປັກໝຸດກາງແຜນທີ່", systemImage: "scope") }
                        .buttonStyle(.borderedProminent).controlSize(.regular).padding(10)
                }
                .clipShape(RoundedRectangle(cornerRadius: 10)).overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.border))
                .frame(minHeight: 380)
            HStack {
                Text(chosen.map { String(format: "ເສັ້ນຂະໜານ %.6f · ເສັ້ນແວງ %.6f", $0.latitude, $0.longitude) } ?? "ຍັງບໍ່ໄດ້ເລືອກຕຳແໜ່ງ")
                    .font(Theme.font(13)).foregroundStyle(chosen == nil ? Theme.muted : Theme.ink).monospacedDigit().textSelection(.enabled)
                Spacer()
                Button("ຍົກເລີກ") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("ໃຊ້ຕຳແໜ່ງນີ້") {
                    guard let chosen else { return }
                    onChoose(String(format: "%.6f", chosen.latitude), String(format: "%.6f", chosen.longitude)); dismiss()
                }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(chosen == nil)
            }.controlSize(.large)
        }
        .padding(24).frame(width: 760, height: 680).font(Theme.font()).background(Theme.cream)
        .onAppear {
            if let lat = Double(latitude), let lng = Double(longitude), abs(lat) <= 90, abs(lng) <= 180 { choose(CLLocationCoordinate2D(latitude: lat, longitude: lng), zoom: 0.01) }
        }
    }
    private func choose(_ coordinate: CLLocationCoordinate2D, zoom: Double?) {
        chosen = coordinate
        if let zoom { camera = MKCoordinateRegion(center: coordinate, span: MKCoordinateSpan(latitudeDelta: zoom, longitudeDelta: zoom)); cameraID += 1 }
    }
    private func search() async {
        let text = query.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty, !searching else { return }
        searching = true; error = nil; defer { searching = false }
        do { results = try await model.searchPlaces(text); if results.isEmpty { error = "ບໍ່ພົບສະຖານທີ່; ລອງຄຳອື່ນ ຫຼືຄລິກໃສ່ແຜນທີ່" } }
        catch { self.error = error.localizedDescription }
    }
}
