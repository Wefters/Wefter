import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chipGroup,
  clearButton,
  compactPreview,
  formatDuration,
  jsonTree,
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

describe("compactPreview", () => {
  it("summarises objects one level deep and abbreviates nested containers", () => {
    expect(compactPreview({ a: 1, s: "x", n: null, nested: { b: 2 }, list: [1, 2] })).toBe(
      '{a: 1, s: "x", n: null, nested: {…}, list: […2]}',
    );
  });

  it("caps long previews with an ellipsis", () => {
    const text = compactPreview({ text: "x".repeat(500) }, 40);
    expect(text.length).toBe(40);
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("formatDuration", () => {
  it("uses ms below a second and seconds above", () => {
    expect(formatDuration(18)).toBe("18 ms");
    expect(formatDuration(4820)).toBe("4.82 s");
    expect(formatDuration(10000)).toBe("10.0 s");
    expect(formatDuration(undefined)).toBe("");
  });
});

describe("jsonTree", () => {
  it("opens to the requested depth and builds deeper children only when opened", () => {
    const tree = jsonTree({ a: { b: { c: 1 } } }, { expandDepth: 1 });
    const root = tree.querySelector<HTMLDetailsElement>("details")!;
    expect(root.open).toBe(true);

    const child = root.querySelector<HTMLDetailsElement>(".wd-tree-children > details")!;
    expect(child.open).toBe(false);
    expect(child.querySelector(".wd-tree-children")?.childElementCount).toBe(0);

    child.open = true;
    child.dispatchEvent(new Event("toggle"));
    expect(child.textContent).toContain("c");
  });

  it("renders primitives as coloured leaves", () => {
    const tree = jsonTree({ s: "x", n: 2, b: true }, { expandDepth: 1 });
    expect(tree.querySelector(".wd-json-string")?.textContent).toBe('"x"');
    expect(tree.querySelector(".wd-json-number")?.textContent).toBe("2");
    expect(tree.querySelector(".wd-json-literal")?.textContent).toBe("true");
  });
});

describe("chipGroup", () => {
  it("behaves as a radio group: one checked chip, arrow keys move the choice", () => {
    const onChange = vi.fn();
    const group = chipGroup(
      "Level",
      [
        { value: "", label: "All" },
        { value: "warn", label: "Warn" },
      ],
      onChange,
    );
    document.body.appendChild(group.element);
    const [all, warn] = group.element.querySelectorAll<HTMLElement>(".wd-chip");

    all!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    expect(onChange).toHaveBeenLastCalledWith("warn");
    expect(warn!.getAttribute("aria-checked")).toBe("true");
    expect(all!.getAttribute("aria-checked")).toBe("false");
    expect(document.activeElement).toBe(warn);
    group.element.remove();
  });

  it("shows counts and hides zero counts", () => {
    const group = chipGroup(
      "Level",
      [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
      vi.fn(),
    );
    group.setCounts({ a: 4, b: 0 });
    expect([...group.element.querySelectorAll(".wd-chip-count")].map((c) => c.textContent)).toEqual(["4", ""]);
  });
});
