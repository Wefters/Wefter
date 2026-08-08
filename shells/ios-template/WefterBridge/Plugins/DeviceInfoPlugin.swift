import Foundation
import UIKit

final class DeviceInfoPlugin: WefterPlugin {

    // @WefterMethod
    func getInfo(payload: [String: Any], callback: @escaping (Result<Any, Error>) -> Void) throws {
        resolve(callback, data: [
            "platform": "ios",
            "osVersion": UIDevice.current.systemVersion,
        ])
    }
}
