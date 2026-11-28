import { afterEach, describe, expect, it } from "vitest";
import { installMockBridge, uninstallMockBridge } from "../src/testing.js";
import {
  getGestures,
  getSafeArea,
  getSystemBars,
  onSafeAreaChange,
  setGestures,
  setSystemBars,
} from "../src/internal/system-ui.js";

afterEach(() => {
  uninstallMockBridge();
});

describe("system bars and gestures", () => {
  it("sends the settings to the app and returns its answer", async () => {
    const calls: [string, unknown][] = [];
    installMockBridge({
      __system: (method, payload) => {
        calls.push([method, payload]);
        return { hidden: true, icons: "light", supported: { hidden: true, icons: true } };
      },
    });

    expect(await setSystemBars({ hidden: true })).toMatchObject({ hidden: true });
    await getSystemBars();
    await setGestures({ swipeBack: false, edgeProtection: [{ x: 0, y: 0, width: 10, height: 10 }] });
    await getGestures();
    await getSafeArea();
    expect(calls).toEqual([
      ["setSystemBars", { hidden: true }],
      ["getSystemBars", {}],
      ["setGestures", { swipeBack: false, edgeProtection: [{ x: 0, y: 0, width: 10, height: 10 }] }],
      ["getGestures", {}],
      ["getSafeArea", {}],
    ]);
  });

  it("returns the defaults, none supported, outside an app", async () => {
    expect(await getSystemBars()).toEqual({ hidden: false, icons: "auto", supported: { hidden: false, icons: false } });
    expect(await setGestures({ zoom: false })).toEqual({
      swipeBack: "history",
      zoom: false,
      longPress: true,
      overscroll: true,
      edgeProtection: false,
      supported: { swipeBack: false, zoom: false, longPress: false, overscroll: false, edgeProtection: false },
    });
    expect(await getSafeArea()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("passes safe area changes from the app to listeners", () => {
    installMockBridge({ __system: () => ({}) });
    const seen: unknown[] = [];
    const off = onSafeAreaChange((area) => seen.push(area));
    const area = { top: 24, right: 0, bottom: 16, left: 0 };
    window.__wefterNative.emit("__system:safeArea", JSON.stringify(area));
    off();
    window.__wefterNative.emit("__system:safeArea", JSON.stringify(area));
    expect(seen).toEqual([area]);
  });
});
