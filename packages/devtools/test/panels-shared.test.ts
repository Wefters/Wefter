import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearButton,
  copyButton,
  expandChevron,
  formatTime,
  jsonPreview,
  statusAccentClass,
  statusBadge,
} from "../src/client/panels/shared.js";

describe("statusBadge", () => {
  it("renders the status text and a status-scoped class", () => {
    const el = statusBadge("success");
    expect(el.textContent).toBe("success");
    expect(el.className).toBe("wd-badge wd-badge-success");
  });
});

describe("formatTime", () => {
  it("includes milliseconds zero-padded to three digits", () => {
    const t = new Date();
    t.setMilliseconds(7);
    const formatted = formatTime(t.getTime());
    expect(formatted.endsWith(".007")).toBe(true);
  });

  it("formats in 24-hour time (no AM/PM marker)", () => {
    const formatted = formatTime(Date.now());
    expect(formatted).not.toMatch(/[AP]M/i);
  });
});

describe("jsonPreview", () => {
  it("pretty-prints an object with 2-space indentation", () => {
    expect(jsonPreview({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it("falls back to String() for values JSON.stringify can't handle", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(jsonPreview(circular)).toBe(String(circular));
  });

  it("falls back to String() for undefined, since JSON.stringify(undefined) is undefined", () => {
    expect(jsonPreview(undefined)).toBe("undefined");
  });
});

describe("clearButton", () => {
  it("invokes the callback on click", () => {
    const onClear = vi.fn();
    const btn = clearButton(onClear);
    expect(btn.textContent).toBe("Clear");
    btn.click();
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe("expandChevron", () => {
  it("adds the open class when isOpen is true", () => {
    expect(expandChevron(true).className).toBe("wd-chevron open");
  });

  it("omits the open class when isOpen is false", () => {
    expect(expandChevron(false).className).toBe("wd-chevron");
  });
});

describe("statusAccentClass", () => {
  it("maps success to the success accent", () => {
    expect(statusAccentClass("success")).toBe("wd-row-accent-success");
  });

  it("maps pending to the pending accent", () => {
    expect(statusAccentClass("pending")).toBe("wd-row-accent-pending");
  });

  it("maps every other status (error, timeout, cancelled) to the error accent", () => {
    expect(statusAccentClass("error")).toBe("wd-row-accent-error");
    expect(statusAccentClass("timeout")).toBe("wd-row-accent-error");
    expect(statusAccentClass("cancelled")).toBe("wd-row-accent-error");
  });
});

describe("copyButton", () => {
  const originalClipboard = navigator.clipboard;

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: originalClipboard, configurable: true });
    vi.useRealTimers();
  });

  it("writes the text returned by getText to the clipboard on click", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    const btn = copyButton(() => "copy-me");
    btn.click();

    expect(writeText).toHaveBeenCalledWith("copy-me");
  });

  it("stops the click from bubbling, so an ancestor row-expand handler doesn't also fire", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    const rowHandler = vi.fn();
    const row = document.createElement("div");
    row.addEventListener("click", rowHandler);
    const btn = copyButton(() => "x");
    row.appendChild(btn);
    document.body.appendChild(row);

    btn.click();

    expect(rowHandler).not.toHaveBeenCalled();
    document.body.removeChild(row);
  });

  it("flips label to 'Copied' on success then reverts after the timeout", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    const btn = copyButton(() => "x");
    btn.click();

    await vi.advanceTimersByTimeAsync(0);
    expect(btn.textContent).toBe("Copied");

    await vi.advanceTimersByTimeAsync(1200);
    expect(btn.textContent).toBe("Copy");
  });

  it("does not throw and leaves the label alone when the clipboard write rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    const btn = copyButton(() => "x");
    expect(() => btn.click()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(btn.textContent).toBe("Copy");
  });
});
