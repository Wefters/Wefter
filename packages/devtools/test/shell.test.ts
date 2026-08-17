import { describe, expect, it } from "vitest";
import { createStore } from "../src/client/store.js";
import { mountShell } from "../src/client/shell.js";
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
});
