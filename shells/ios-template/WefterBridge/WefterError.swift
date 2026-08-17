import Foundation

public struct WefterError: Error, LocalizedError {
    public let code: String
    public let message: String
    public let debugStack: [String]

    public init(code: String, message: String) {
        self.code = code
        self.message = message
        #if DEBUG
        self.debugStack = Thread.callStackSymbols
        #else
        self.debugStack = []
        #endif
    }

    public var errorDescription: String? { message }
}
