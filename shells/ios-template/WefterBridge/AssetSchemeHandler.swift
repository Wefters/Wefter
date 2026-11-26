import Foundation
import WebKit
import UniformTypeIdentifiers

/// Serves the bundled web app from the app bundle's `www` folder at `app://local/`.
///
/// Serving from a custom scheme instead of `file://` gives the page a real origin. Requests outside `www`
/// are refused, byte ranges are supported (for media), and every response carries a Content Security
/// Policy.
public final class AssetSchemeHandler: NSObject, WKURLSchemeHandler {

    /// Scheme and host of bundled pages: `app://local/index.html`.
    public static let scheme = "app"
    public static let host = "local"

    private let rootDirectory: URL

    /// Serves files from `rootDirectory`, or from the bundle's `www` folder by default.
    public init(rootDirectory: URL? = nil) {
        self.rootDirectory = rootDirectory ?? Bundle.main.bundleURL.appendingPathComponent("www", isDirectory: true)
    }

    /// Answers a request with the file it names, `index.html` for the root.
    public func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }

        let relativePath = url.path.hasPrefix("/") ? String(url.path.dropFirst()) : url.path
        let requestedPath = relativePath.isEmpty ? "index.html" : relativePath
        let fileURL = rootDirectory.appendingPathComponent(requestedPath)

        let standardizedRoot = rootDirectory.standardizedFileURL.path
        let standardizedFile = fileURL.standardizedFileURL.path
        guard standardizedFile.hasPrefix(standardizedRoot) else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }

        guard let fileData = FileManager.default.contents(atPath: standardizedFile) else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }

        let mimeType = Self.mimeType(for: fileURL)
        let rangeHeader = urlSchemeTask.request.value(forHTTPHeaderField: "Range")

        let (bodyData, statusCode, extraHeaders) = Self.resolveRangeIfPresent(rangeHeader, fullData: fileData)

        var headers: [String: String] = [
            "Content-Security-Policy": Self.contentSecurityPolicy,
            "Content-Type": mimeType,
            "Content-Length": String(bodyData.count),
            "Accept-Ranges": "bytes",
        ]
        headers.merge(extraHeaders) { _, new in new }

        guard let response = HTTPURLResponse(url: url, statusCode: statusCode, httpVersion: "HTTP/1.1", headerFields: headers) else {
            urlSchemeTask.didFailWithError(URLError(.badServerResponse))
            return
        }

        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(bodyData)
        urlSchemeTask.didFinish()
    }

    /// Nothing to cancel: responses are sent in full as soon as a request starts.
    public func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {

    }

    /// Only the app's own code may run; images and network requests may also use HTTPS.
    static let contentSecurityPolicy =
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
            + "img-src 'self' data: https:; connect-src 'self' https:; font-src 'self' data:;"

    /// MIME type from the file extension.
    private static func mimeType(for url: URL) -> String {
        if let type = UTType(filenameExtension: url.pathExtension), let mime = type.preferredMIMEType {
            return mime
        }
        return "application/octet-stream"
    }

    /// Applies a `Range: bytes=start-end` header.
    ///
    /// - Returns: The body, status (`206` for a range, otherwise `200`) and extra headers. Invalid ranges get
    ///   the whole file.
    private static func resolveRangeIfPresent(_ rangeHeader: String?, fullData: Data) -> (Data, Int, [String: String]) {
        guard let rangeHeader, rangeHeader.hasPrefix("bytes=") else {
            return (fullData, 200, [:])
        }

        let spec = rangeHeader.dropFirst("bytes=".count)
        let parts = spec.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
        guard parts.count == 2, let start = Int(parts[0]) else {
            return (fullData, 200, [:])
        }

        let lastIndex = fullData.count - 1
        let end = parts[1].isEmpty ? lastIndex : min(Int(parts[1]) ?? lastIndex, lastIndex)
        guard start >= 0, start <= end, end <= lastIndex else {
            return (fullData, 200, [:])
        }

        let slice = fullData.subdata(in: start..<(end + 1))
        let contentRange = "bytes \(start)-\(end)/\(fullData.count)"
        return (slice, 206, ["Content-Range": contentRange])
    }
}
