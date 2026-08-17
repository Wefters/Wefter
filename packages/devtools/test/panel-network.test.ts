import { describe, expect, it, vi } from "vitest";
import { createStore } from "../src/client/store.js";
import { createNetworkPanel } from "../src/client/panels/network.js";
import type { NetworkRecord } from "../src/shared/events.js";

const baseRecord: NetworkRecord = {
  requestId: "1",
  url: "/api/things",
  method: "GET",
  headers: { accept: "application/json" },
  timestamp: 1000,
  status: "pending",
};

describe("createNetworkPanel", () => {
  it("shows the empty state with no records", () => {
    const panel = createNetworkPanel(createStore<NetworkRecord[]>([]), vi.fn());
    expect(panel.querySelector(".wd-empty")?.textContent).toBe("No network activity yet.");
  });

  it("renders method and url", () => {
    const panel = createNetworkPanel(createStore<NetworkRecord[]>([baseRecord]), vi.fn());
    expect(panel.querySelector(".wd-col-plugin")?.textContent).toBe("GET");
    expect(panel.querySelector(".wd-col-method")?.textContent).toBe("/api/things");
  });

  it("categorizes a pending request with the pending accent", () => {
    const panel = createNetworkPanel(createStore<NetworkRecord[]>([baseRecord]), vi.fn());
    expect(panel.querySelector(".wd-row-group")?.className).toContain("wd-row-accent-pending");
  });

  it("categorizes a 2xx/3xx response as success", () => {
    const panel = createNetworkPanel(createStore<NetworkRecord[]>([{ ...baseRecord, status: 204 }]), vi.fn());
    expect(panel.querySelector(".wd-row-group")?.className).toContain("wd-row-accent-success");
  });

  it("categorizes a 4xx/5xx response as error", () => {
    const panel = createNetworkPanel(createStore<NetworkRecord[]>([{ ...baseRecord, status: 500 }]), vi.fn());
    expect(panel.querySelector(".wd-row-group")?.className).toContain("wd-row-accent-error");
  });

  it("expands to show headers/body preview on click", () => {
    const record = { ...baseRecord, status: 200, bodyPreview: "{\"ok\":true}" };
    const panel = createNetworkPanel(createStore<NetworkRecord[]>([record]), vi.fn());
    (panel.querySelector(".wd-row") as HTMLElement).click();
    expect(panel.querySelector(".wd-detail")?.textContent).toContain("ok");
  });

  it("filters by URL substring, case-insensitively", () => {
    const store = createStore<NetworkRecord[]>([
      { ...baseRecord, requestId: "1", url: "/api/foo" },
      { ...baseRecord, requestId: "2", url: "/api/BAR" },
    ]);
    const panel = createNetworkPanel(store, vi.fn());

    const input = panel.querySelector("input") as HTMLInputElement;
    input.value = "bar";
    input.dispatchEvent(new Event("input"));

    expect(panel.querySelectorAll(".wd-row").length).toBe(1);
    expect(panel.querySelector(".wd-col-method")?.textContent).toBe("/api/BAR");
  });

  it("calls onClear when the Clear button is clicked", () => {
    const onClear = vi.fn();
    const panel = createNetworkPanel(createStore<NetworkRecord[]>([baseRecord]), onClear);
    (panel.querySelector(".wd-clear-btn") as HTMLElement).click();
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
