import type { ColoredSegment } from "../utils/logger.js";
import type { CheckResult } from "./checks.js";

/** Formats check results as coloured lines, with a "Fix:" line under each failure. */
export function buildReportLines(results: CheckResult[]): ColoredSegment[][] {
  const lines: ColoredSegment[][] = [];

  for (const result of results) {
    const icon: ColoredSegment = result.passed ? { text: "✔ ", color: "green" } : { text: "✘ ", color: "red" };

    const label = result.detail
      ? result.passed
        ? `${result.name} (${result.detail})`
        : `${result.name} — ${result.detail}`
      : result.name;

    lines.push([icon, { text: label }]);

    if (!result.passed && result.fix) {
      lines.push([{ text: "    " }, { text: "Fix: ", color: "gray" }, { text: result.fix }]);
    }
  }

  return lines;
}

/** Whether every check passed. */
export function allPassed(results: CheckResult[]): boolean {
  return results.every((result) => result.passed);
}
