// swift-tools-version:5.9
// The Swift runtime lives in packages/swift; this manifest sits at the repository
// root because Swift Package Manager installs packages from a Git URL.
import PackageDescription

let package = Package(
    name: "Pubba",
    platforms: [.iOS(.v13), .macOS(.v10_15), .tvOS(.v13), .watchOS(.v6), .visionOS(.v1)],
    products: [.library(name: "Pubba", targets: ["Pubba"])],
    targets: [
        .target(name: "Pubba", path: "packages/swift/Sources/Pubba"),
        .testTarget(name: "PubbaTests", dependencies: ["Pubba"], path: "packages/swift/Tests/PubbaTests"),
    ]
)
