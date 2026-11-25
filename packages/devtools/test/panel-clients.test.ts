import { describe, expect, it } from "vitest";
import { createStore } from "../src/client/store.js";
import { createClientsPanel } from "../src/client/panels/clients.js";
import type { ClientHelloEvent } from "../src/shared/events.js";

function flush(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

describe("createClientsPanel", () => {
  it("shows an empty state while no app is connected", () => {
    const panel = createClientsPanel(createStore<ClientHelloEvent[]>([]));
    expect(panel.querySelector(".wd-empty")?.textContent).toBe("No app connected yet.");
    expect(panel.querySelector(".wd-summary")?.textContent).toBe("0 apps connected");
  });

  it("lists each connected app with its id and page URL, updating live", async () => {
    const presence = createStore<ClientHelloEvent[]>([]);
    const panel = createClientsPanel(presence);

    presence.set(() => [
      { clientId: "a81c22f0e4b5", url: "http://localhost:5173/#/device", timestamp: 1 },
      { clientId: "b2", url: "http://localhost:5173/", timestamp: 2 },
    ]);
    await flush();

    const rows = [...panel.querySelectorAll(".wd-client-row")];
    expect(rows.length).toBe(2);
    expect(rows[0]!.querySelector(".wd-client-id")?.textContent).toBe("a81c22f0");
    expect(rows[0]!.querySelector(".wd-client-url")?.textContent).toBe("http://localhost:5173/#/device");
    expect(panel.querySelector(".wd-summary")?.textContent).toBe("2 apps connected");
  });

  it("explains that native plugin/permission state is not reported yet", () => {
    const panel = createClientsPanel(createStore<ClientHelloEvent[]>([]));
    expect(panel.querySelector(".wd-state-note")?.textContent).toContain("don't report plugin or permission state yet");
  });
});
