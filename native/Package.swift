// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "YogurtNative",
    platforms: [.macOS(.v15)],
    products: [.executable(name: "YogurtNative", targets: ["YogurtNative"])],
    dependencies: [
        .package(url: "https://github.com/vapor/postgres-nio.git", exact: "1.33.0"),
        .package(url: "https://github.com/krzyzanowskim/CryptoSwift.git", exact: "1.10.0")
    ],
    targets: [
        .executableTarget(name: "YogurtNative", dependencies: [
            .product(name: "PostgresNIO", package: "postgres-nio"),
            .product(name: "CryptoSwift", package: "CryptoSwift")
        ], resources: [.process("Resources")]),
        .testTarget(name: "YogurtNativeTests", dependencies: ["YogurtNative"])
    ],
    swiftLanguageModes: [.v5]
)
