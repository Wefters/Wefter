import { describe, expect, it } from "vitest";
import {
  extractWefterHooks,
  extractWefterMethods,
  findMalformedWefterHooks,
  findMalformedWefterMethods,
} from "../src/extract-wefter-plugin.js";

const WELL_FORMED = `
package dev.wefter.bridge

import android.content.Context
import org.json.JSONObject

class ScannerPlugin(context: Context, dispatcher: BridgeDispatcher) : WefterPlugin(context, dispatcher) {
    @WefterMethod
    fun open(payload: JSONObject, callback: (Result<Any>) -> Unit) {
        resolve(callback)
    }

    @WefterMethod
    fun close(payload: JSONObject, callback: (Result<Any>) -> Unit) {
        resolve(callback)
    }

    @WefterHook("onPause")
    fun handlePause() {
        releaseCamera()
    }
}
`;

describe("extractWefterMethods", () => {
  it("extracts every correctly-formed @WefterMethod function", () => {
    const methods = extractWefterMethods(WELL_FORMED);

    expect(methods.map((m) => m.name)).toEqual(["open", "close"]);
  });

  it("returns an empty array, not a crash, when there are no annotations at all", () => {
    expect(extractWefterMethods("class Plain { fun foo() {} }")).toEqual([]);
  });

  it("reports a plausible 1-based line number for each match", () => {
    const methods = extractWefterMethods(WELL_FORMED);
    expect(methods[0].lineNumber).toBeGreaterThan(0);
    expect(methods[1].lineNumber).toBeGreaterThan(methods[0].lineNumber);
  });
});

describe("findMalformedWefterMethods", () => {
  it("does NOT flag correctly-formed methods — regression test for the truncating-loose-pattern bug", () => {
    expect(findMalformedWefterMethods(WELL_FORMED)).toEqual([]);
  });

  it("flags a @WefterMethod with the wrong parameter shape", () => {
    const malformed = `
@WefterMethod
fun open(wrongParam: String, callback: (Result<Any>) -> Unit) {
}
`;
    expect(findMalformedWefterMethods(malformed)).toEqual([2]);
  });

  it("flags a @WefterMethod missing the callback parameter entirely", () => {
    const malformed = `
@WefterMethod
fun open(payload: JSONObject) {
}
`;
    expect(findMalformedWefterMethods(malformed)).toEqual([2]);
  });
});

describe("extractWefterHooks", () => {
  it("extracts hook name and method name", () => {
    const hooks = extractWefterHooks(WELL_FORMED);

    expect(hooks).toEqual([{ hookName: "onPause", methodName: "handlePause", lineNumber: expect.any(Number) }]);
  });

  it("returns an empty array when there are no hooks", () => {
    expect(extractWefterHooks("class Plain")).toEqual([]);
  });
});

describe("findMalformedWefterHooks", () => {
  it("does not flag a correctly-formed hook", () => {
    expect(findMalformedWefterHooks(WELL_FORMED)).toEqual([]);
  });

  it("flags a @WefterHook whose function takes a parameter (hooks must be no-arg)", () => {
    const malformed = `
@WefterHook("onPause")
fun handlePause(reason: String) {
}
`;
    expect(findMalformedWefterHooks(malformed)).toEqual([2]);
  });
});
