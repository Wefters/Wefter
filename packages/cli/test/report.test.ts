import { describe, expect, it } from "vitest";
import { allPassed, buildReportLines } from "../src/doctor/report.js";
import type { CheckResult } from "../src/doctor/checks.js";

describe("buildReportLines", () => {
  it("shows a passed check with its detail in parens, green icon", () => {
    const lines = buildReportLines([
      { name: "Node.js version", passed: true, detail: "v20.11.0" },
    ]);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual([
      { text: "✔ ", color: "green" },
      { text: "Node.js version (v20.11.0)" },
    ]);
  });

  it("shows a failed check with an em-dash detail, red icon, and an indented Fix line", () => {
    const lines = buildReportLines([
      {
        name: "JDK version",
        passed: false,
        detail: "found 11, need 17",
        fix: "install JDK 17 and set JAVA_HOME to point at it",
      },
    ]);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual([
      { text: "✘ ", color: "red" },
      { text: "JDK version — found 11, need 17" },
    ]);
    expect(lines[1]).toEqual([
      { text: "    " },
      { text: "Fix: ", color: "gray" },
      { text: "install JDK 17 and set JAVA_HOME to point at it" },
    ]);
  });

  it("omits the Fix line entirely when a check passes", () => {
    const lines = buildReportLines([{ name: "adb on PATH", passed: true }]);

    expect(lines).toHaveLength(1);
  });

  it("omits the Fix line when a failed check has no fix text", () => {
    const lines = buildReportLines([{ name: "mystery check", passed: false }]);

    expect(lines).toHaveLength(1);
  });
});

describe("allPassed", () => {
  it("is true only when every check passed", () => {
    const passing: CheckResult[] = [
      { name: "a", passed: true },
      { name: "b", passed: true },
    ];
    const failing: CheckResult[] = [
      { name: "a", passed: true },
      { name: "b", passed: false },
    ];

    expect(allPassed(passing)).toBe(true);
    expect(allPassed(failing)).toBe(false);
  });
});
