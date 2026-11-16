// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "JANCUANative",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "jan-cua-native", targets: ["CuaNative"])],
    targets: [
        .executableTarget(name: "CuaNative"),
        .testTarget(name: "CuaNativeTests", dependencies: ["CuaNative"], path: "tests/swift"),
    ],
    swiftLanguageModes: [.v6]
)
