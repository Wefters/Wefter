import { describe, expect, it, vi } from "vitest";
import { createStore } from "../src/client/store.js";
import { createDeepLinksPanel, type DeepLinksPanelActions } from "../src/client/panels/deep-links.js";
import type { DeepLinkEnvironmentInfo, DeepLinkEvent } from "../src/shared/events.js";

const link: DeepLinkEvent = {
  url: "myshop://product/42?ref=mail",
  scheme: "myshop",
  path: "/product/42",
  query: { ref: "mail" },
  isLaunch: true,
  source: "native",
  listeners: 1,
  timestamp: 1000,
};

const environments: DeepLinkEnvironmentInfo[] = [
  { name: "development", appId: "com.example.shop.dev", schemes: ["myshop-dev"], domains: [], paths: [] },
  {
    name: "production",
    appId: "com.example.shop",
    schemes: ["myshop"],
    domains: ["shop.example.com"],
    paths: ["/product/*"],
  },
];

/** Lets promises and the store's animation-frame updates settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function rows(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(".wd-trow")];
}

function createPanel(
  links: DeepLinkEvent[] = [],
  listeners: number | null = 1,
  overrides: Partial<DeepLinksPanelActions> = {},
) {
  const actions = {
    onClear: vi.fn(),
    onSimulate: vi.fn(),
    openOnDevice: vi.fn(async () => ({ ok: true, output: "Starting: Intent { act=android.intent.action.VIEW }" })),
    loadConfig: vi.fn(async () => environments),
    ...overrides,
  };
  const panel = createDeepLinksPanel(createStore(links), createStore<number | null>(listeners), actions);
  const input = panel.querySelector<HTMLInputElement>(".wd-dl-url")!;
  return { panel, actions, input };
}

describe("createDeepLinksPanel", () => {
  it("shows the empty state before any link arrives", () => {
    const { panel } = createPanel();
    expect(panel.querySelector(".wd-empty")?.textContent).toBe("No deep links yet.");
  });

  it("lists each link's origin, scheme, path, query and listener count", () => {
    const { panel } = createPanel([link, { ...link, isLaunch: false, source: "devtools", timestamp: 2000 }]);
    const [launch, simulated] = rows(panel);

    expect(launch!.querySelector(".wd-badge")?.textContent).toBe("Launch");
    expect(launch!.querySelector(".wd-col-plugin")?.textContent).toBe("myshop");
    expect(launch!.querySelector(".wd-col-method")?.textContent).toBe("/product/42");
    expect(launch!.querySelector(".wd-cell-args")?.textContent).toContain("mail");
    expect(launch!.querySelector(".wd-cell-num")?.textContent).toBe("1");
    expect(simulated!.querySelector(".wd-badge")?.textContent).toBe("DevTools");
  });

  it("marks links no listener received, and filters to them", () => {
    const { panel } = createPanel([link, { ...link, url: "myshop://cart", path: "/cart", listeners: 0, timestamp: 2 }]);

    expect(rows(panel)[1]!.className).toContain("wd-row-accent-unhandled");
    expect(rows(panel)[1]!.querySelector(".wd-cell-num")?.textContent).toBe("None");
    expect(panel.querySelector(".wd-summary")?.textContent).toBe("2 links · 1 not handled");

    panel.querySelector<HTMLElement>('.wd-chip[data-value="unhandled"]')!.click();
    expect(rows(panel)).toHaveLength(1);
  });

  it.each([
    [null, "Waiting for the app", ""],
    [0, "No onDeepLink listener", "wd-dl-status-warn"],
    [2, "onDeepLink: 2 listeners", "wd-dl-status-ok"],
  ] as const)("shows %s listeners as %s", (count, text, className) => {
    const { panel } = createPanel([], count);
    const status = panel.querySelector(".wd-dl-status")!;
    expect(status.textContent).toBe(text);
    if (className) expect(status.className).toContain(className);
  });

  it("sends the tester's link to the app, also with Enter, and asks for a link when empty", () => {
    const { panel, actions, input } = createPanel();
    const send = panel.querySelector<HTMLButtonElement>(".wd-dl-send-btn")!;

    send.click();
    expect(actions.onSimulate).not.toHaveBeenCalled();
    expect(panel.querySelector(".wd-dl-result")?.textContent).toBe("Enter a link first.");

    input.value = " myshop://cart ";
    send.click();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(actions.onSimulate).toHaveBeenCalledTimes(2);
    expect(actions.onSimulate).toHaveBeenCalledWith("myshop://cart");
    expect(panel.querySelector(".wd-dl-result")?.textContent).toBe("Sent to the app.");
  });

  it("warns when a link is sent while the app has no listener", () => {
    const { panel, input } = createPanel([], 0);
    input.value = "myshop://cart";
    panel.querySelector<HTMLButtonElement>(".wd-dl-send-btn")!.click();
    expect(panel.querySelector(".wd-dl-result")?.textContent).toBe("Sent, but the app has no onDeepLink listener.");
  });

  it("opens the link on a device and shows what the command reported", async () => {
    const openOnDevice = vi.fn(async () => ({ ok: false, output: "adb: no devices/emulators found" }));
    const { panel, input } = createPanel([], 1, { openOnDevice });
    input.value = "myshop://cart";
    const [android, ios] = [...panel.querySelectorAll<HTMLButtonElement>(".wd-dl-device-btn")];

    android!.click();
    expect(android!.disabled).toBe(true);
    await settle();
    expect(openOnDevice).toHaveBeenCalledWith("android", "myshop://cart");
    expect(android!.disabled).toBe(false);
    expect(panel.querySelector(".wd-dl-result")?.textContent).toBe("Android: adb: no devices/emulators found");

    openOnDevice.mockResolvedValueOnce({ ok: true, output: "" });
    ios!.click();
    await settle();
    expect(openOnDevice).toHaveBeenLastCalledWith("ios", "myshop://cart");
    expect(panel.querySelector(".wd-dl-result")?.textContent).toBe("Opened on iOS Simulator.");
  });

  it("lists each environment's configured links, which fill the tester when clicked", async () => {
    const { panel, input } = createPanel();
    await settle();

    const examples = [...panel.querySelectorAll<HTMLButtonElement>(".wd-dl-example")].map((b) => b.textContent);
    expect(examples).toEqual(["myshop-dev://", "myshop://", "https://shop.example.com/product/"]);

    panel.querySelectorAll<HTMLButtonElement>(".wd-dl-example")[2]!.click();
    expect(input.value).toBe("https://shop.example.com/product/");
  });

  it("explains how to configure links when there are none, and when the config cannot be read", async () => {
    const empty = createPanel([], 1, { loadConfig: async () => [] });
    const failed = createPanel([], 1, { loadConfig: async () => Promise.reject(new Error("offline")) });
    await settle();

    expect(empty.panel.querySelector(".wd-dl-config")?.textContent).toContain('Add "deepLinks" to wefter.config.json');
    expect(failed.panel.querySelector(".wd-dl-config")?.textContent).toBe("Could not load wefter.config.json.");
  });

  it("shows the link's details, its query, and resends it from the details pane", () => {
    const { panel, actions } = createPanel([link]);
    rows(panel)[0]!.click();

    const titles = [...panel.querySelectorAll(".wd-section-title")].map((e) => e.textContent);
    expect(titles).toEqual(["Overview", "Query parameters", "Actions"]);
    const inspector = panel.querySelector(".wd-inspector")!;
    expect(inspector.textContent).toContain("At launch");
    expect(inspector.textContent).toContain("1 listener");

    [...inspector.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => b.textContent === "Send to app again")!
      .click();
    expect(actions.onSimulate).toHaveBeenCalledWith(link.url);
  });

  it("explains an unhandled link in its details", () => {
    const { panel } = createPanel([{ ...link, listeners: 0 }]);
    rows(panel)[0]!.click();
    expect(panel.querySelector(".wd-inspector .wd-note")?.textContent).toContain("No onDeepLink listener received");
  });
});
