import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const emitDevtoolsEvent = vi.fn();
vi.mock("../src/internal/devtools/emit.js", () => ({
  emitDevtoolsEvent: (...args: unknown[]) => emitDevtoolsEvent(...args),
  onDevtoolsEvent: vi.fn(),
}));

const { installUncaughtReporter, reportUncaughtError } = await import("../src/internal/devtools/uncaught.js");

beforeAll(() => {
  installUncaughtReporter();
});

beforeEach(() => {
  emitDevtoolsEvent.mockClear();
  document.body.innerHTML = "";
});

describe("reportUncaughtError", () => {
  it("sends an uncaught console event with the error summary and its stack", () => {
    reportUncaughtError(new TypeError("boom"));

    expect(emitDevtoolsEvent).toHaveBeenCalledTimes(1);
    const [event, payload] = emitDevtoolsEvent.mock.calls[0]!;
    expect(event).toBe("wefter:console");
    expect(payload).toMatchObject({ level: "uncaught", args: ["TypeError: boom"] });
    expect((payload as { stack: string }).stack).toContain("boom");
  });

  it("handles non-Error values", () => {
    reportUncaughtError({ code: "NOT_AN_ERROR" });
    const [, payload] = emitDevtoolsEvent.mock.calls[0]!;
    expect(payload).toMatchObject({ args: [{ code: "NOT_AN_ERROR" }] });
    expect((payload as { stack: string }).stack).toContain("NOT_AN_ERROR");
  });

  it("never draws anything on the page", () => {
    reportUncaughtError(new Error("still invisible"));
    expect(document.body.children.length).toBe(0);
    expect(document.querySelector("[data-wefter-error-overlay]")).toBeNull();
  });
});

describe("window listeners", () => {
  it("reports uncaught error events", () => {
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("window-level crash"), message: "x" }));
    expect(emitDevtoolsEvent.mock.calls[0]![1]).toMatchObject({ args: ["Error: window-level crash"] });
  });

  it("reports unhandled promise rejections", () => {
    const event = new Event("unhandledrejection") as Event & { reason?: unknown };
    event.reason = new Error("nobody caught me");
    window.dispatchEvent(event);
    expect(emitDevtoolsEvent.mock.calls[0]![1]).toMatchObject({ args: ["Error: nobody caught me"] });
  });
});
