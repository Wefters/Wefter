/**
 * Reports uncaught errors and unhandled promise rejections to the DevTools Console panel while the dev
 * server is running. The app's own error handling is left untouched.
 */

import { emitDevtoolsEvent } from "./emit.js";
import { safeSerialize } from "./serialize.js";
import { claimOnce } from "./claim-once.js";

/** Best available text for an error: its stack, the string itself, or its JSON form. */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

/** Sends an error to the DevTools Console as an `uncaught` entry. Never throws. */
export function reportUncaughtError(error: unknown): void {
  try {
    emitDevtoolsEvent("wefter:console", {
      level: "uncaught",
      args: [error instanceof Error ? `${error.name}: ${error.message}` : safeSerialize(error)],
      stack: describeError(error),
      timestamp: Date.now(),
    });
  } catch {}
}

let installed = false;

/** Listens for `error` and `unhandledrejection` on the window. Safe to call more than once. */
export function installUncaughtReporter(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("error", (event) => reportUncaughtError(event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => reportUncaughtError(event.reason));
}

if (typeof window !== "undefined" && import.meta.hot && claimOnce("uncaught")) {
  installUncaughtReporter();
}
