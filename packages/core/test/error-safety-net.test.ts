import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetOverlayForTest,
  __setDebugBuildForTest,
  reportUnhandledError,
} from "../src/internal/error-safety-net.js";

beforeEach(() => {
  __resetOverlayForTest();
});

afterEach(() => {
  __resetOverlayForTest();
  __setDebugBuildForTest(true);
});

describe("reportUnhandledError", () => {
  it("renders a visible overlay entry in dev builds", () => {
    __setDebugBuildForTest(true);

    reportUnhandledError(new Error("boom"));

    const overlay = document.querySelector("[data-wefter-error-overlay]");
    expect(overlay).not.toBeNull();
    expect(overlay!.textContent).toContain("Error: boom");
  });

  it("appends further errors to the same overlay rather than creating a new one each time", () => {
    __setDebugBuildForTest(true);

    reportUnhandledError(new Error("first"));
    reportUnhandledError(new Error("second"));

    const overlays = document.querySelectorAll("[data-wefter-error-overlay]");
    expect(overlays.length).toBe(1);
    expect(overlays[0].textContent).toContain("first");
    expect(overlays[0].textContent).toContain("second");
  });

  it("only logs to the console in release builds — no overlay", () => {
    __setDebugBuildForTest(false);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    reportUnhandledError(new Error("prod boom"));

    expect(document.querySelector("[data-wefter-error-overlay]")).toBeNull();
    expect(spy).toHaveBeenCalledWith("[wefter] unhandled error", expect.any(Error));

    spy.mockRestore();
  });

  it("handles non-Error rejection reasons without throwing", () => {
    __setDebugBuildForTest(true);

    expect(() => reportUnhandledError({ code: "NOT_AN_ERROR" })).not.toThrow();
    expect(document.querySelector("[data-wefter-error-overlay]")!.textContent).toContain("NOT_AN_ERROR");
  });
});

describe("window error listeners", () => {
  it("routes an uncaught error event into the overlay", () => {
    __setDebugBuildForTest(true);

    window.dispatchEvent(
      new ErrorEvent("error", { error: new Error("window-level crash"), message: "window-level crash" }),
    );

    expect(document.querySelector("[data-wefter-error-overlay]")!.textContent).toContain("window-level crash");
  });
});
