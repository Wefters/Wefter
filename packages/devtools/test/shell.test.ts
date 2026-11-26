import { describe, expect, it, vi } from "vitest";
import { createStore } from "../src/client/store.js";
import { mountShell, type PanelBadge } from "../src/client/shell.js";
import type { ClientHelloEvent } from "../src/shared/events.js";

function flush(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function makePanels() {
  return [
    { id: "one", label: "One", element: document.createElement("div") },
    { id: "two", label: "Two", element: document.createElement("div") },
  ];
}

describe("mountShell", () => {
  it("renders a tab per panel and activates the first one by default", () => {
    const root = document.createElement("div");
    const panels = makePanels();
    mountShell(root, panels, createStore<ClientHelloEvent[]>([]));

    const tabs = root.querySelectorAll(".wd-tab");
    expect(tabs.length).toBe(2);
    expect(tabs[0]?.textContent).toBe("One");
    expect(panels[0]!.element.classList.contains("active")).toBe(true);
    expect(panels[1]!.element.classList.contains("active")).toBe(false);
  });

  it("invokes the reload-device callback when the header Reload button is clicked", () => {
    const root = document.createElement("div");
    const onReloadDevice = vi.fn();
    mountShell(root, makePanels(), createStore<ClientHelloEvent[]>([]), onReloadDevice);

    (root.querySelector(".wd-reload-btn") as HTMLElement).click();

    expect(onReloadDevice).toHaveBeenCalledTimes(1);
  });

  it("disables the Reload button while no client is connected and enables it once one is", async () => {
    const root = document.createElement("div");
    const presenceStore = createStore<ClientHelloEvent[]>([]);
    mountShell(root, makePanels(), presenceStore, () => {});

    presenceStore.set(() => []);
    await flush();
    expect((root.querySelector(".wd-reload-btn") as HTMLButtonElement).disabled).toBe(true);

    presenceStore.set(() => [{ clientId: "a", url: "/", timestamp: Date.now() }]);
    await flush();
    expect((root.querySelector(".wd-reload-btn") as HTMLButtonElement).disabled).toBe(false);
  });

  it("switches the active panel and tab styling on click", () => {
    const root = document.createElement("div");
    const panels = makePanels();
    mountShell(root, panels, createStore<ClientHelloEvent[]>([]));

    (root.querySelectorAll(".wd-tab")[1] as HTMLElement).click();

    expect(panels[0]!.element.classList.contains("active")).toBe(false);
    expect(panels[1]!.element.classList.contains("active")).toBe(true);
    const tabsAfter = root.querySelectorAll(".wd-tab");
    expect(tabsAfter[0]?.classList.contains("active")).toBe(false);
    expect(tabsAfter[1]?.classList.contains("active")).toBe(true);
  });

  it("shows a zero-client label and a disconnected dot before any presence update", () => {
    const root = document.createElement("div");
    mountShell(root, makePanels(), createStore<ClientHelloEvent[]>([]));

    expect(root.querySelector(".wd-clients")?.textContent).toBe("0 clients connected");
    expect(root.querySelector(".wd-status-dot")?.classList.contains("connected")).toBe(false);
  });

  it("updates client count and connects the status dot when the presence store changes", async () => {
    const root = document.createElement("div");
    const presenceStore = createStore<ClientHelloEvent[]>([]);
    mountShell(root, makePanels(), presenceStore);

    presenceStore.set(() => [{ clientId: "a", url: "/", timestamp: Date.now() }]);
    await flush();

    expect(root.querySelector(".wd-clients")?.textContent).toBe("1 client connected");
    expect(root.querySelector(".wd-status-dot")?.classList.contains("connected")).toBe(true);
  });

  it("pluralizes the client count for 0 and 2+, singular only for exactly 1", async () => {
    const root = document.createElement("div");
    const presenceStore = createStore<ClientHelloEvent[]>([]);
    mountShell(root, makePanels(), presenceStore);

    presenceStore.set(() => [
      { clientId: "a", url: "/", timestamp: Date.now() },
      { clientId: "b", url: "/", timestamp: Date.now() },
    ]);
    await flush();

    expect(root.querySelector(".wd-clients")?.textContent).toBe("2 clients connected");
  });

  it("disconnects the status dot again when presence drops back to zero", async () => {
    const root = document.createElement("div");
    const presenceStore = createStore<ClientHelloEvent[]>([]);
    mountShell(root, makePanels(), presenceStore);

    presenceStore.set(() => [{ clientId: "a", url: "/", timestamp: Date.now() }]);
    await flush();
    presenceStore.set(() => []);
    await flush();

    expect(root.querySelector(".wd-status-dot")?.classList.contains("connected")).toBe(false);
  });

  it("marks tabs and panels up as an accessible tablist", () => {
    const root = document.createElement("div");
    const panels = makePanels();
    mountShell(root, panels, createStore<ClientHelloEvent[]>([]));

    const tabs = root.querySelectorAll<HTMLElement>('[role="tab"]');
    expect(root.querySelector('[role="tablist"]')).not.toBeNull();
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(tabs[0]!.getAttribute("aria-controls")).toBe(panels[0]!.element.id);
    expect(panels[0]!.element.getAttribute("role")).toBe("tabpanel");
    expect([...tabs].map((t) => t.tabIndex)).toEqual([0, -1]);
  });

  it("moves between tabs with the left/right arrow keys", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const panels = makePanels();
    mountShell(root, panels, createStore<ClientHelloEvent[]>([]));

    const first = root.querySelector<HTMLElement>(".wd-tab")!;
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    expect(panels[1]!.element.classList.contains("active")).toBe(true);
    expect(document.activeElement).toBe(root.querySelectorAll(".wd-tab")[1]);
    root.remove();
  });

  it("switches panels with the number keys and focuses the active panel's filter with /", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const panels = makePanels();
    const search = document.createElement("input");
    search.className = "wd-search";
    panels[1]!.element.appendChild(search);
    mountShell(root, panels, createStore<ClientHelloEvent[]>([]));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "2", bubbles: true }));
    expect(panels[1]!.element.classList.contains("active")).toBe(true);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
    expect(document.activeElement).toBe(search);

    search.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true }));
    expect(panels[1]!.element.classList.contains("active")).toBe(true);
    root.remove();
  });

  it("shows a tab badge only when its count is non-zero, with the requested tone", async () => {
    const root = document.createElement("div");
    const badge = createStore<PanelBadge>({ count: 0 });
    const panels = makePanels();
    mountShell(root, [{ ...panels[0]!, badge }, panels[1]!], createStore<ClientHelloEvent[]>([]));

    badge.set(() => ({ count: 3, tone: "error" }));
    await flush();

    const el = root.querySelector(".wd-tab-badge")!;
    expect(el.textContent).toBe("3");
    expect(el.className).toBe("wd-tab-badge wd-tab-badge-error");
  });

  it("toggles between dark and light themes and remembers the choice", () => {
    localStorage.removeItem("wefter-devtools:theme");
    const root = document.createElement("div");
    mountShell(root, makePanels(), createStore<ClientHelloEvent[]>([]));
    const before = document.documentElement.dataset.theme;

    root.querySelector<HTMLElement>(".wd-theme-btn")!.click();

    const after = document.documentElement.dataset.theme;
    expect(after).not.toBe(before);
    expect(localStorage.getItem("wefter-devtools:theme")).toBe(after);
  });

  it("shows the URL of a single connected app next to the count", async () => {
    const root = document.createElement("div");
    const presenceStore = createStore<ClientHelloEvent[]>([]);
    mountShell(root, makePanels(), presenceStore);

    presenceStore.set(() => [{ clientId: "a", url: "http://localhost:5173/#/scan", timestamp: 1 }]);
    await flush();

    expect(root.querySelector(".wd-conn-url")?.textContent).toBe("http://localhost:5173/#/scan");
  });

  it("shows the full Wefter logo in the top bar", () => {
    const root = document.createElement("div");
    mountShell(root, makePanels(), createStore<ClientHelloEvent[]>([]));

    const logo = root.querySelector(".wd-header .wd-logo")!;
    expect(logo.getAttribute("aria-label")).toBe("Wefter");
    expect(logo.querySelectorAll("path").length).toBe(9);
  });
});
