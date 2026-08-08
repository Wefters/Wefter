import Foundation
import UIKit

final class PingTestPlugin: WefterPlugin {
    private static let tickIntervalSeconds: TimeInterval = 2
    private var timer: Timer?
    private var tickCount = 0

    required init(dispatcher: BridgeDispatcher, viewController: UIViewController?) {
        super.init(dispatcher: dispatcher, viewController: viewController)
        startTicking()
    }

    private func startTicking() {
        let timer = Timer.scheduledTimer(withTimeInterval: Self.tickIntervalSeconds, repeats: true) { [weak self] _ in
            guard let self else { return }
            self.tickCount += 1
            self.emit("tick", ["count": self.tickCount])
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    // @WefterMethod
    func ping(payload: [String: Any], callback: @escaping (Result<Any, Error>) -> Void) throws {
        resolve(callback, data: ["pong": true])
    }
}
