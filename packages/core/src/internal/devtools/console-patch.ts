/** Mirrors `console.*` calls to the DevTools Console panel while the dev server is running. */

import { emitDevtoolsEvent } from "./emit.js";
import { safeSerialize } from "./serialize.js";
import { claimOnce } from "./claim-once.js";

/** The console methods that are forwarded. */
const LEVELS = ["log", "info", "warn", "error", "debug"] as const;
type ConsoleLevel = (typeof LEVELS)[number];

let installed = false;
const originals: Partial<Record<ConsoleLevel, Console[ConsoleLevel]>> = {};

/**
 * Wraps each console method so it still logs normally and also sends a serialised copy of its arguments
 * to DevTools. Warnings and errors include the stack of the call site. Safe to call more than once.
 */
export function installConsolePatch(): void {
  if (installed) return;
  installed = true;

  for (const level of LEVELS) {
    originals[level] = console[level];
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      try {
        const stack = level === "warn" || level === "error" ? new Error().stack : undefined;
        emitDevtoolsEvent("wefter:console", {
          level,
          args: args.map((arg) => safeSerialize(arg)),
          stack: stack ?? null,
          timestamp: Date.now(),
        });
      } catch {}
    };
  }
}

export type { ConsoleLevel };

/** Restores the original console methods. Test-only. */
export function __resetConsolePatchForTest(): void {
  for (const level of LEVELS) {
    const original = originals[level];
    if (original) console[level] = original;
  }
  installed = false;
}

if (typeof window !== "undefined" && import.meta.hot && claimOnce("console")) {
  installConsolePatch();
}
