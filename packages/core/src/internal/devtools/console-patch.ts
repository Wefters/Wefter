import { emitDevtoolsEvent } from "./emit.js";
import { safeSerialize } from "./serialize.js";

const LEVELS = ["log", "info", "warn", "error", "debug"] as const;
type ConsoleLevel = (typeof LEVELS)[number];

let installed = false;
const originals: Partial<Record<ConsoleLevel, Console[ConsoleLevel]>> = {};

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
      } catch {
        // best-effort devtools telemetry — never let a serialization failure affect app console output
      }
    };
  }
}

export type { ConsoleLevel };

export function __resetConsolePatchForTest(): void {
  for (const level of LEVELS) {
    const original = originals[level];
    if (original) console[level] = original;
  }
  installed = false;
}

if (typeof window !== "undefined" && import.meta.hot) {
  installConsolePatch();
}
