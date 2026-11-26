/**
 * Mirrors `fetch` and `XMLHttpRequest` traffic to the DevTools Network panel while the dev server is
 * running. Requests and responses are reported as separate events linked by a request id; response
 * bodies are previewed up to {@link BODY_PREVIEW_CAP} characters.
 */

import { emitDevtoolsEvent } from "./emit.js";
import { truncate } from "./serialize.js";
import { claimOnce } from "./claim-once.js";

/** Longest response body preview sent to DevTools, in characters. */
const BODY_PREVIEW_CAP = 2048;

let counter = 0;
const sessionPrefix = Math.random().toString(36).slice(2, 8) || "s";
let fetchInstalled = false;
let xhrInstalled = false;

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/**
 * Wraps `window.fetch`. The response is cloned so the app still receives an unread body; network
 * failures are reported with status 0 and then rethrown unchanged.
 */
export function installFetchPatch(): void {
  if (fetchInstalled || typeof window === "undefined" || typeof window.fetch !== "function") return;
  fetchInstalled = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = (async (...args: Parameters<typeof fetch>) => {
    const [input, init] = args;
    const request = input instanceof Request ? input : undefined;
    const requestId = `${sessionPrefix}-${counter++}`;
    const url = request ? request.url : input.toString();
    const method = init?.method ?? request?.method ?? "GET";
    const headers = headersToRecord(new Headers(init?.headers ?? request?.headers));
    const startedAt = Date.now();

    emitDevtoolsEvent("wefter:network_request", { requestId, url, method, headers, timestamp: startedAt });

    try {
      const response = await originalFetch(...args);
      void previewFetchBody(response.clone(), requestId, startedAt);
      return response;
    } catch (err) {
      emitDevtoolsEvent("wefter:network_response", {
        requestId,
        status: 0,
        durationMs: Date.now() - startedAt,
        bodyPreview: err instanceof Error ? err.message : String(err),
        bodyTruncated: false,
      });
      throw err;
    }
  }) as typeof fetch;
}

/** Reads a cloned response and reports it, falling back to an empty preview when the body is not text. */
async function previewFetchBody(clone: Response, requestId: string, startedAt: number): Promise<void> {
  try {
    const text = await clone.text();
    const { preview, truncated } = truncate(text, BODY_PREVIEW_CAP);
    emitDevtoolsEvent("wefter:network_response", {
      requestId,
      status: clone.status,
      durationMs: Date.now() - startedAt,
      bodyPreview: preview,
      bodyTruncated: truncated,
    });
  } catch {
    emitDevtoolsEvent("wefter:network_response", {
      requestId,
      status: clone.status,
      durationMs: Date.now() - startedAt,
      bodyPreview: "",
      bodyTruncated: false,
    });
  }
}

/** What is remembered about an `XMLHttpRequest` between `open()` and its response. */
interface XhrMeta {
  requestId: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  startedAt: number;
}

const xhrMeta = new WeakMap<XMLHttpRequest, XhrMeta>();

/**
 * Wraps `XMLHttpRequest.prototype.open`, `setRequestHeader` and `send` to report each request and, on
 * `loadend`, its response. Only text responses are previewed.
 */
export function installXhrPatch(): void {
  if (xhrInstalled || typeof window === "undefined" || typeof window.XMLHttpRequest === "undefined") return;
  xhrInstalled = true;

  const proto = XMLHttpRequest.prototype;
  const originalOpen = proto.open;
  const originalSend = proto.send;
  const originalSetRequestHeader = proto.setRequestHeader;

  proto.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    xhrMeta.set(this, {
      requestId: `${sessionPrefix}-${counter++}`,
      method,
      url: url.toString(),
      headers: {},
      startedAt: 0,
    });
    return originalOpen.apply(this, [method, url, ...rest] as unknown as Parameters<typeof originalOpen>);
  } as typeof proto.open;

  proto.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) {
    const meta = xhrMeta.get(this);
    if (meta) meta.headers[name] = value;
    return originalSetRequestHeader.call(this, name, value);
  };

  proto.send = function (this: XMLHttpRequest, ...args: unknown[]) {
    const meta = xhrMeta.get(this);
    if (meta) {
      meta.startedAt = Date.now();
      emitDevtoolsEvent("wefter:network_request", {
        requestId: meta.requestId,
        url: meta.url,
        method: meta.method,
        headers: meta.headers,
        timestamp: meta.startedAt,
      });
      this.addEventListener("loadend", () => {
        let bodyPreview = "";
        let bodyTruncated = false;
        if (this.responseType === "" || this.responseType === "text") {
          try {
            const result = truncate(this.responseText ?? "", BODY_PREVIEW_CAP);
            bodyPreview = result.preview;
            bodyTruncated = result.truncated;
          } catch {}
        }
        emitDevtoolsEvent("wefter:network_response", {
          requestId: meta.requestId,
          status: this.status,
          durationMs: Date.now() - meta.startedAt,
          bodyPreview,
          bodyTruncated,
        });
      });
    }
    return originalSend.apply(this, args as unknown as Parameters<typeof originalSend>);
  } as typeof proto.send;
}

if (typeof window !== "undefined" && import.meta.hot && claimOnce("network")) {
  installFetchPatch();
  installXhrPatch();
}
