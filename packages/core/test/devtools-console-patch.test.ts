import { beforeEach, describe, expect, it, vi } from "vitest";

const emitDevtoolsEvent = vi.fn();
vi.mock("../src/internal/devtools/emit.js", () => ({
  emitDevtoolsEvent: (...args: unknown[]) => emitDevtoolsEvent(...args),
  onDevtoolsEvent: vi.fn(),
}));

const { installConsolePatch, __resetConsolePatchForTest } = await import("../src/internal/devtools/console-patch.js");

beforeEach(() => {
  __resetConsolePatchForTest();
  emitDevtoolsEvent.mockClear();
});

describe("installConsolePatch", () => {
  it("still calls the original console method with the original arguments", () => {
    const original = vi.fn();
    console.log = original;
    installConsolePatch();

    console.log("hello", 42);

    expect(original).toHaveBeenCalledWith("hello", 42);
  });

  it("emits wefter:console with the level, serialized args, and a timestamp", () => {
    console.log = vi.fn();
    installConsolePatch();

    console.log("hi", { a: 1 });

    const call = emitDevtoolsEvent.mock.calls.find(([name]) => name === "wefter:console");
    expect(call).toBeDefined();
    const [, payload] = call!;
    expect(payload).toMatchObject({ level: "log", args: ["hi", { a: 1 }], stack: null });
    expect((payload as { timestamp: number }).timestamp).toEqual(expect.any(Number));
  });

  it("captures a stack trace for warn and error but not for log/info/debug", () => {
    console.warn = vi.fn();
    console.debug = vi.fn();
    installConsolePatch();

    console.warn("careful");
    console.debug("quiet");

    const warnPayload = emitDevtoolsEvent.mock.calls.find(
      ([name, p]) => name === "wefter:console" && (p as { level: string }).level === "warn",
    )![1] as { stack: string | null };
    const debugPayload = emitDevtoolsEvent.mock.calls.find(
      ([name, p]) => name === "wefter:console" && (p as { level: string }).level === "debug",
    )![1] as { stack: string | null };

    expect(typeof warnPayload.stack).toBe("string");
    expect(debugPayload.stack).toBeNull();
  });

  it("never wraps twice from repeated install calls", () => {
    installConsolePatch();
    const wrapped = console.log;
    installConsolePatch();

    expect(console.log).toBe(wrapped);
  });

  it("a devtools-emit failure never suppresses the real console output", () => {
    const original = vi.fn();
    console.log = original;
    installConsolePatch();
    emitDevtoolsEvent.mockImplementationOnce(() => {
      throw new Error("emit boom");
    });

    expect(() => console.log("still works")).not.toThrow();
    expect(original).toHaveBeenCalledWith("still works");
  });
});
