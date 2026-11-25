import { emitDevtoolsEvent } from "./emit.js";
import { safeSerialize } from "./serialize.js";
import { claimOnce } from "./claim-once.js";

/**
 * Forwards uncaught errors and unhandled promise rejections to the devtools Console panel.
 *
 * Dev-only and report-only: nothing is drawn on the page. The browser / WebView still logs these
 * errors to its own console as usual (we never call preventDefault).
 */

function describeError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

export function reportUncaughtError(error: unknown): void {
  try {
    emitDevtoolsEvent("wefter:console", {
      level: "uncaught",
      args: [error instanceof Error ? `${error.name}: ${error.message}` : safeSerialize(error)],
      stack: describeError(error),
      timestamp: Date.now(),
    });
  } catch {
    // best-effort devtools telemetry — never let reporting turn into another uncaught error
  }
}

let installed = false;

export function installUncaughtReporter(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("error", (event) => reportUncaughtError(event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => reportUncaughtError(event.reason));
}

if (typeof window !== "undefined" && import.meta.hot && claimOnce("uncaught")) {
  installUncaughtReporter();
}
