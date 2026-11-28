import { invokeNative, isNativeBridgeAvailable, registerHook } from "./native-bridge.js";

/** Insets, in CSS pixels, that the status bar, navigation bar, notch and home indicator cover. */
export interface SafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The status bar and, on Android, the navigation bar. */
export interface SystemBars {
  /**
   * Whether the bars are hidden. A swipe from the edge shows them for a moment; on iOS the home indicator
   * fades out too.
   */
  hidden: boolean;
  /** Colour of the bars' icons: `"auto"` suits `launchBackground`, `"dark"` for light pages, `"light"` for dark ones. */
  icons: "auto" | "dark" | "light";
}

/** An area of the page, in CSS pixels from its top left corner. */
export interface GestureArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Touch gestures the app's web view responds to. */
export interface Gestures {
  /**
   * The iOS swipe from the left edge (right edge in right-to-left languages): `"history"` goes back in the
   * web view's history, `"page"` sends it to {@link onBack} listeners, `false` turns it off. Android's back
   * gesture is the system's and always reaches `onBack`.
   */
  swipeBack: "history" | "page" | false;
  /** Pinch and double-tap zoom, as the page's viewport allows. */
  zoom: boolean;
  /** Long-press link previews, the text selection callout, tap highlights and dragging images and links. Inputs stay selectable. */
  longPress: boolean;
  /** Android's stretch at the ends of a scrolled page. */
  overscroll: boolean;
  /**
   * Holds back the system's edge gestures where the page needs the touches. On Android, `true` keeps the
   * back gesture off the lowest 200dp of both side edges, where thumbs rest on a game's controls, and back
   * still works from the upper part; areas protect only themselves. On iOS any value defers the home
   * indicator and Control Center on every edge, so a first swipe only shows the indicator.
   */
  edgeProtection: boolean | GestureArea[];
}

/** Which settings the platform the app runs on supports. */
export type Supported<T> = { [K in keyof T]: boolean };

/** {@link SystemBars} with what the platform supports. */
export type SystemBarsState = SystemBars & { supported: Supported<SystemBars> };

/** {@link Gestures} with what the platform supports. */
export type GesturesState = Gestures & { supported: Supported<Gestures> };

const DEFAULT_BARS: SystemBars = { hidden: false, icons: "auto" };
const DEFAULT_GESTURES: Gestures = {
  swipeBack: "history",
  zoom: true,
  longPress: true,
  overscroll: true,
  edgeProtection: false,
};

function unsupported<T extends object>(value: T): T & { supported: Supported<T> } {
  const supported = Object.fromEntries(Object.keys(value).map((key) => [key, false])) as Supported<T>;
  return { ...value, supported };
}

/**
 * The status bar's (and Android navigation bar's) current settings, from `systemBars` in
 * `wefter.config.json` or {@link setSystemBars}. Outside an app it returns the defaults, none supported.
 */
export async function getSystemBars(): Promise<SystemBarsState> {
  if (!isNativeBridgeAvailable()) return unsupported(DEFAULT_BARS);
  return invokeNative<SystemBarsState>("__system", "getSystemBars", {});
}

/**
 * Hides or shows the system bars, or changes their icon colour, until the app changes them again. Settings
 * left out keep their current value. Use it for a full-screen game round or photo viewer, or for a page
 * whose header is darker than the rest of the app.
 *
 * @returns The new settings. Outside an app nothing changes.
 *
 * @example
 * await setSystemBars({ hidden: true });
 */
export async function setSystemBars(bars: Partial<SystemBars>): Promise<SystemBarsState> {
  if (!isNativeBridgeAvailable()) return unsupported({ ...DEFAULT_BARS, ...bars });
  return invokeNative<SystemBarsState>("__system", "setSystemBars", bars);
}

/**
 * The gestures' current settings, from `gestures` in `wefter.config.json` or {@link setGestures}. Outside
 * an app it returns the defaults, none supported.
 */
export async function getGestures(): Promise<GesturesState> {
  if (!isNativeBridgeAvailable()) return unsupported(DEFAULT_GESTURES);
  return invokeNative<GesturesState>("__system", "getGestures", {});
}

/**
 * Changes which gestures the web view responds to, until the app changes them again. Settings left out
 * keep their current value.
 *
 * @returns The new settings. Outside an app nothing changes.
 *
 * @example
 * // While a round is played: no swipe back or zoom, and the joystick's corner protected.
 * await setGestures({ swipeBack: false, zoom: false, edgeProtection: [{ x: 0, y: 300, width: 160, height: 160 }] });
 */
export async function setGestures(gestures: Partial<Gestures>): Promise<GesturesState> {
  if (!isNativeBridgeAvailable()) return unsupported({ ...DEFAULT_GESTURES, ...gestures });
  return invokeNative<GesturesState>("__system", "setGestures", gestures);
}

/** Reads `env(safe-area-inset-*)` in a browser, through an element styled with it. */
function cssSafeArea(): SafeArea {
  const zero = { top: 0, right: 0, bottom: 0, left: 0 };
  if (typeof document === "undefined" || !document.body) return zero;
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;pointer-events:none;" +
    "padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const area = {
    top: parseFloat(style.paddingTop) || 0,
    right: parseFloat(style.paddingRight) || 0,
    bottom: parseFloat(style.paddingBottom) || 0,
    left: parseFloat(style.paddingLeft) || 0,
  };
  probe.remove();
  return area;
}

/**
 * The insets, in CSS pixels, that the system bars, notch and home indicator cover now. They change when the
 * screen rotates and when the bars are hidden. The app also sets them as CSS variables on `<html>`:
 * `--wefter-safe-area-top`, `-right`, `-bottom` and `-left`, which unlike `env(safe-area-inset-*)` are
 * reliable on Android too. In a browser this reads `env(safe-area-inset-*)`.
 */
export async function getSafeArea(): Promise<SafeArea> {
  if (!isNativeBridgeAvailable()) return cssSafeArea();
  return invokeNative<SafeArea>("__system", "getSafeArea", {});
}

/**
 * Calls `listener` whenever the safe area changes: on rotation, and when the bars are hidden or shown. In a
 * browser it listens for window resizes.
 *
 * @returns A function that removes the listener.
 */
export function onSafeAreaChange(listener: (area: SafeArea) => void): () => void {
  if (!isNativeBridgeAvailable()) {
    if (typeof window === "undefined") return () => {};
    const onResize = () => listener(cssSafeArea());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }
  const subscription = registerHook("__system:safeArea", (data) => listener(data as SafeArea));
  return () => subscription.remove();
}
