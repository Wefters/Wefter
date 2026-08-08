// swift-tools-version:5.9

import PackageDescription

let package = Package(
    name: "NativeDependencies",
    platforms: [.iOS(.v16)],
    products: [
        .library(name: "NativeDependencies", targets: ["NativeDependencies"])
    ],
    dependencies: [

    ],
    targets: [
        .target(
            name: "NativeDependencies",
            dependencies: [

            ]
        )
    ]
)
