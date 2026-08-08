import Foundation
import WebKit
import UniformTypeIdentifiers

public final class AssetSchemeHandler: NSObject, WKURLSchemeHandler {

    public static let scheme = "app"
    public static let host = "local"

    private let rootDirectory: URL

    public init(rootDirectory: URL? = nil) {
        self.rootDirectory = rootDirectory ?? Bundle.main.bundleURL.appendingPathComponent("www", isDirectory: true)
    }

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

    public func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {

    }

    static let contentSecurityPolicy =
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
            + "img-src 'self' data: https:; connect-src 'self' https:; font-src 'self' data:;"

    private static func mimeType(for url: URL) -> String {
        if let type = UTType(filenameExtension: url.pathExtension), let mime = type.preferredMIMEType {
            return mime
        }
        return "application/octet-stream"
    }

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
