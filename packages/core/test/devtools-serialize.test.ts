import { describe, expect, it } from "vitest";
import { safeSerialize, truncate } from "../src/internal/devtools/serialize.js";

describe("truncate", () => {
  it("returns the original string untouched when under the cap", () => {
    expect(truncate("hello", 10)).toEqual({ preview: "hello", truncated: false });
  });

  it("truncates and flags strings over the cap", () => {
    expect(truncate("abcdefghij", 5)).toEqual({ preview: "abcde", truncated: true });
  });
});

describe("safeSerialize", () => {
  it("passes primitives through unchanged", () => {
    expect(safeSerialize(42)).toBe(42);
    expect(safeSerialize("hi")).toBe("hi");
    expect(safeSerialize(true)).toBe(true);
    expect(safeSerialize(null)).toBe(null);
    expect(safeSerialize(undefined)).toBe(undefined);
  });

  it("serializes plain objects and arrays recursively", () => {
    expect(safeSerialize({ a: 1, b: [1, 2, 3] })).toEqual({ a: 1, b: [1, 2, 3] });
  });

  it("renders functions as a short label instead of throwing or hanging", () => {
    function namedFn() {}
    expect(safeSerialize(namedFn)).toBe("[Function: namedFn]");
    expect(safeSerialize(() => {})).toBe("[Function: anonymous]");
  });

  it("special-cases Error objects into a plain, JSON-safe shape", () => {
    const err = new Error("boom");
    const result = safeSerialize(err) as { __wefterKind: string; name: string; message: string };
    expect(result.__wefterKind).toBe("error");
    expect(result.name).toBe("Error");
    expect(result.message).toBe("boom");
  });

  it("does not throw or hang on a directly circular object", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    expect(() => safeSerialize(obj)).not.toThrow();
    expect((safeSerialize(obj) as { self: unknown }).self).toBe("[Circular]");
  });

  it("does not false-positive on the same object appearing twice in sibling branches", () => {
    const shared = { value: 1 };
    const obj = { first: shared, second: shared };
    const result = safeSerialize(obj) as { first: unknown; second: unknown };
    expect(result.first).toEqual({ value: 1 });
    expect(result.second).toEqual({ value: 1 });
  });

  it("caps array length so a huge array cannot hang serialization", () => {
    const huge = Array.from({ length: 500 }, (_, i) => i);
    const result = safeSerialize(huge) as unknown[];
    expect(result.length).toBe(50);
  });

  it("caps object key count so a huge object cannot hang serialization", () => {
    const huge: Record<string, number> = {};
    for (let i = 0; i < 500; i++) huge[`k${i}`] = i;
    const result = safeSerialize(huge) as Record<string, unknown>;
    expect(Object.keys(result).length).toBe(51); // 50 real keys + the truncation marker
    expect(result["…"]).toBe("[truncated]");
  });
});
