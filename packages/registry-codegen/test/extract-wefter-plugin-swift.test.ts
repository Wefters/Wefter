import { describe, expect, it } from "vitest";
import {
  extractWefterHooksSwift,
  extractWefterMethodsSwift,
  findMalformedWefterHooksSwift,
  findMalformedWefterMethodsSwift,
} from "../src/extract-wefter-plugin-swift.js";

const WELL_FORMED = `
import Foundation

final class ScannerPlugin: WefterPlugin {
    // @WefterMethod
    func open(payload: [String: Any], callback: @escaping (Result<Any, Error>) -> Void) throws {
        resolve(callback)
    }

    // @WefterMethod
    func close(payload: [String: Any], callback: @escaping (Result<Any, Error>) -> Void) throws {
        resolve(callback)
    }

    // @WefterHook("onPause")
    func handlePause() {
        releaseCamera()
    }
}
`;

describe("extractWefterMethodsSwift", () => {
  it("extracts every correctly-formed @WefterMethod function", () => {
    const methods = extractWefterMethodsSwift(WELL_FORMED);

    expect(methods.map((m) => m.name)).toEqual(["open", "close"]);
  });

  it("returns an empty array, not a crash, when there are no annotations at all", () => {
    expect(extractWefterMethodsSwift("final class Plain { func foo() {} }")).toEqual([]);
  });

  it("reports a plausible 1-based line number for each match", () => {
    const methods = extractWefterMethodsSwift(WELL_FORMED);
    expect(methods[0].lineNumber).toBeGreaterThan(0);
    expect(methods[1].lineNumber).toBeGreaterThan(methods[0].lineNumber);
  });
});

describe("findMalformedWefterMethodsSwift", () => {
  it("does NOT flag correctly-formed methods", () => {
    expect(findMalformedWefterMethodsSwift(WELL_FORMED)).toEqual([]);
  });

  it("flags a @WefterMethod with the wrong parameter shape", () => {
    const malformed = `
// @WefterMethod
func open(wrongParam: String, callback: @escaping (Result<Any, Error>) -> Void) throws {
}
`;
    expect(findMalformedWefterMethodsSwift(malformed)).toEqual([2]);
  });

  it("flags a @WefterMethod missing the `throws` keyword", () => {
    const malformed = `
// @WefterMethod
func open(payload: [String: Any], callback: @escaping (Result<Any, Error>) -> Void) {
}
`;
    expect(findMalformedWefterMethodsSwift(malformed)).toEqual([2]);
  });

  it("flags a @WefterMethod missing the callback parameter entirely", () => {
    const malformed = `
// @WefterMethod
func open(payload: [String: Any]) throws {
}
`;
    expect(findMalformedWefterMethodsSwift(malformed)).toEqual([2]);
  });
});

describe("extractWefterHooksSwift", () => {
  it("extracts hook name and method name", () => {
    const hooks = extractWefterHooksSwift(WELL_FORMED);

    expect(hooks).toEqual([{ hookName: "onPause", methodName: "handlePause", lineNumber: expect.any(Number) }]);
  });

  it("returns an empty array when there are no hooks", () => {
    expect(extractWefterHooksSwift("final class Plain {}")).toEqual([]);
  });
});

describe("findMalformedWefterHooksSwift", () => {
  it("does not flag a correctly-formed hook", () => {
    expect(findMalformedWefterHooksSwift(WELL_FORMED)).toEqual([]);
  });

  it("flags a @WefterHook whose function takes a parameter (hooks must be no-arg)", () => {
    const malformed = `
// @WefterHook("onPause")
func handlePause(reason: String) {
}
`;
    expect(findMalformedWefterHooksSwift(malformed)).toEqual([2]);
  });
});
