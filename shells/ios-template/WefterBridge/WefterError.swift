import Foundation

/// An error a plugin returns to JavaScript. `code` becomes the `WefterBridgeError` code there.
///
/// In debug builds the call stack at creation is kept and shown in DevTools; release builds keep nothing.
public struct WefterError: Error, LocalizedError {
    public let code: String
    public let message: String
    public let debugStack: [String]

    /// Creates an error with a machine-readable `code` (such as `PERMISSION_DENIED`) and a message for
    /// developers.
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
