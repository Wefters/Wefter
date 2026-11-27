import UIKit
import WebKit

/// Saves files the web page downloads (`<a download>` links, including `blob:` and `data:` URLs and the
/// app's bundled files, and responses sent as attachments or that the web view cannot show): each is
/// downloaded to a temporary folder, then offered in the system "Save to Files" sheet.
final class WebDownloads: NSObject, WKDownloadDelegate, UIDocumentPickerDelegate {
    private weak var presenter: UIViewController?
    /// Where each download in progress is written.
    private var destinations: [ObjectIdentifier: URL] = [:]
    /// The temporary folder of the file each open "Save to Files" sheet shows.
    private var pickerFolders: [ObjectIdentifier: URL] = [:]

    /// Makes downloads WebKit cannot do itself work, in the app's own pages:
    ///
    /// - A `blob:` URL a download link was just clicked with stays alive for 30 seconds, even when the page
    ///   revokes it at once (`link.click(); URL.revokeObjectURL(url)`, as many download helpers do): WebKit
    ///   reads the blob only after the click has returned.
    /// - Download links to the app's bundled files (`app://local/…`) are read by the page and saved as a
    ///   blob, since WebKit's downloads cannot load the app's own scheme.
    static let userScript = WKUserScript(
        source: """
        (function () {
          if (window.__wefterDownloadUrls) return;
          var clicked = window.__wefterDownloadUrls = new Set();
          var click = HTMLAnchorElement.prototype.click;
          var revoke = URL.revokeObjectURL;

          function remember(anchor) {
            if (anchor && anchor.hasAttribute && anchor.hasAttribute('download') && /^blob:/.test(anchor.href)) {
              clicked.add(anchor.href);
            }
          }

          function bundledUrl(anchor) {
            if (!anchor || !anchor.hasAttribute || !anchor.hasAttribute('download') || !anchor.href) return null;
            try {
              var url = new URL(anchor.href, location.href);
              return url.protocol === '\(AssetSchemeHandler.scheme):' ? url : null;
            } catch (e) {
              return null;
            }
          }

          function saveBundled(anchor, url) {
            var name = anchor.getAttribute('download') || decodeURIComponent(url.pathname.split('/').pop() || '') || 'download';
            fetch(url.href)
              .then(function (response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.blob();
              })
              .then(function (blob) {
                var link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = name;
                clicked.add(link.href);
                click.call(link);
                URL.revokeObjectURL(link.href);
              })
              .catch(function (error) { console.error('[Wefter] Could not download ' + url.href + ': ' + error); });
          }

          document.addEventListener('click', function (event) {
            remember(event.target && event.target.closest && event.target.closest('a[download]'));
          }, true);

          window.addEventListener('click', function (event) {
            if (event.defaultPrevented || !event.target || !event.target.closest) return;
            var anchor = event.target.closest('a[download]');
            var url = bundledUrl(anchor);
            if (!url) return;
            event.preventDefault();
            saveBundled(anchor, url);
          });

          HTMLAnchorElement.prototype.click = function () {
            var url = !this.isConnected && bundledUrl(this);
            if (url) return saveBundled(this, url);
            remember(this);
            return click.call(this);
          };

          URL.revokeObjectURL = function (url) {
            if (!clicked.has(url)) return revoke.call(URL, url);
            clicked.delete(url);
            setTimeout(function () { revoke.call(URL, url); }, 30000);
          };
        })();
        """,
        injectionTime: .atDocumentStart,
        forMainFrameOnly: false
    )

    private static let rootFolder = FileManager.default.temporaryDirectory.appendingPathComponent(
        "WefterDownloads", isDirectory: true
    )

    init(presenter: UIViewController) {
        self.presenter = presenter
        super.init()
        try? FileManager.default.removeItem(at: Self.rootFolder)
    }

    /// Starts handling `download`.
    func track(_ download: WKDownload) {
        download.delegate = self
    }

    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        let folder = Self.rootFolder.appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        } catch {
            completionHandler(nil)
            return
        }
        let destination = folder.appendingPathComponent(Self.safeFileName(suggestedFilename))
        destinations[ObjectIdentifier(download)] = destination
        completionHandler(destination)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let file = destinations.removeValue(forKey: ObjectIdentifier(download)) else { return }
        let picker = UIDocumentPickerViewController(forExporting: [file], asCopy: true)
        picker.delegate = self
        pickerFolders[ObjectIdentifier(picker)] = file.deletingLastPathComponent()
        if presenter?.presentOnTop(picker) != true {
            cleanUp(picker)
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        if let file = destinations.removeValue(forKey: ObjectIdentifier(download)) {
            try? FileManager.default.removeItem(at: file.deletingLastPathComponent())
        }
        let alert = UIAlertController(title: nil, message: WefterText.get("downloads.failedFile"), preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: WefterText.get("dialog.ok"), style: .default))
        presenter?.presentOnTop(alert)
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        cleanUp(controller)
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        cleanUp(controller)
    }

    /// Deletes the temporary copy once the sheet has saved it, or was closed.
    private func cleanUp(_ picker: UIDocumentPickerViewController) {
        if let folder = pickerFolders.removeValue(forKey: ObjectIdentifier(picker)) {
            try? FileManager.default.removeItem(at: folder)
        }
    }

    /// A file name without path separators.
    private static func safeFileName(_ suggested: String) -> String {
        let name = suggested
            .components(separatedBy: CharacterSet(charactersIn: "/\\:"))
            .joined(separator: "_")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty || name == "." || name == ".." ? "download" : String(name.prefix(120))
    }
}
