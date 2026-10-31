// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "YogurtNative",
    platforms: [.macOS(.v15)],
    products: [.executable(name: "YogurtNative", targets: ["YogurtNative"])],
    targets: [
        .executableTarget(name: "YogurtNative", resources: [.process("Resources")]),
        .testTarget(name: "YogurtNativeTests", dependencies: ["YogurtNative"])
    ],
    swiftLanguageModes: [.v5]
)
