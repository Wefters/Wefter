import { describe, expect, it } from "vitest";
import { createStore } from "../src/client/store.js";
import { createPluginStatePanel } from "../src/client/panels/plugin-state.js";
import type { ClientHelloEvent } from "../src/shared/events.js";

function flush(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

describe("createPluginStatePanel", () => {
  it("always shows the 'no native client connected yet' message, since this pass has no native reporting", () => {
    const panel = createPluginStatePanel(createStore<ClientHelloEvent[]>([]));
    expect(panel.textContent).toContain("No native client connected yet.");
  });

  it("reports zero JS clients connected initially", () => {
    const panel = createPluginStatePanel(createStore<ClientHelloEvent[]>([]));
    expect(panel.textContent).toContain("0 JS clients connected, 0 reporting plugin/permission state.");
  });

  it("updates the JS client count as the presence store changes, still with zero plugin-state reporters", async () => {
    const presenceStore = createStore<ClientHelloEvent[]>([]);
    const panel = createPluginStatePanel(presenceStore);

    presenceStore.set(() => [{ clientId: "a", url: "/", timestamp: Date.now() }]);
    await flush();

    expect(panel.textContent).toContain("1 JS client connected, 0 reporting plugin/permission state.");
    expect(panel.textContent).toContain("No native client connected yet.");
  });

  it("pluralizes JS client count for 2+", async () => {
    const presenceStore = createStore<ClientHelloEvent[]>([]);
    const panel = createPluginStatePanel(presenceStore);

    presenceStore.set(() => [
      { clientId: "a", url: "/", timestamp: Date.now() },
      { clientId: "b", url: "/", timestamp: Date.now() },
    ]);
    await flush();

    expect(panel.textContent).toContain("2 JS clients connected");
  });
});
