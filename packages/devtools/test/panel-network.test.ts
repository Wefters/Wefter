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

function rows(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(".wd-trow")];
}

describe("createNetworkPanel", () => {
  it("shows the empty state with no records", () => {
    const panel = createNetworkPanel(createStore<NetworkRecord[]>([]), vi.fn());
    expect(panel.querySelector(".wd-empty")?.textContent).toBe("No network activity yet.");
  });

  it("renders method and path, with the host only for other origins", () => {
    const panel = createNetworkPanel(
      createStore<NetworkRecord[]>([
        baseRecord,
        { ...baseRecord, requestId: "2", url: "https://cdn.example.com/a.json?x=1" },
      ]),
      vi.fn(),
    );
    const [local, remote] = rows(panel);
    expect(local!.querySelector(".wd-col-plugin")?.textContent).toBe("GET");
    expect(local!.querySelector(".wd-col-method")?.textContent).toBe("/api/things");
    expect(local!.querySelector(".wd-url-host")).toBeNull();
    expect(remote!.querySelector(".wd-col-method")?.textContent).toBe("/a.json?x=1");
    expect(remote!.querySelector(".wd-url-host")?.textContent).toBe("cdn.example.com");
  });

  it.each([
    ["pending", "pending"],
    [204, "success"],
    [302, "success"],
    [404, "error"],
    [500, "error"],
  ] as const)("categorizes status %s as %s", (status, category) => {
    const panel = createNetworkPanel(createStore<NetworkRecord[]>([{ ...baseRecord, status }]), vi.fn());
    expect(rows(panel)[0]!.className).toContain(`wd-row-accent-${category}`);
    expect(panel.querySelector(".wd-trow .wd-badge")?.className).toContain(`wd-badge-${category}`);
  });

  it("opens the inspector with overview, request headers and the parsed response body", () => {
    const record = { ...baseRecord, status: 200, durationMs: 12, bodyPreview: '{"ok":true}' };
    const panel = createNetworkPanel(createStore<NetworkRecord[]>([record]), vi.fn());
    rows(panel)[0]!.click();

    const titles = [...panel.querySelectorAll(".wd-section-title")].map((e) => e.textContent);
    expect(titles).toEqual(["Overview", "Request headers", "Response"]);
    const inspector = panel.querySelector(".wd-inspector")!.textContent!;
    expect(inspector).toContain("application/json");
    expect(inspector).toContain("ok");
    expect(inspector).toContain("12 ms");
  });

  it("notes when the response preview was truncated", () => {
    const record = { ...baseRecord, status: 200, bodyPreview: "abc", bodyTruncated: true };
    const panel = createNetworkPanel(createStore<NetworkRecord[]>([record]), vi.fn());
    rows(panel)[0]!.click();
    expect(panel.querySelector(".wd-note")?.textContent).toContain("truncated");
  });

  it("filters by URL substring, case-insensitively", () => {
    const store = createStore<NetworkRecord[]>([
      { ...baseRecord, requestId: "1", url: "/api/foo" },
      { ...baseRecord, requestId: "2", url: "/api/BAR" },
    ]);
    const panel = createNetworkPanel(store, vi.fn());

    const input = panel.querySelector(".wd-search") as HTMLInputElement;
    input.value = "bar";
    input.dispatchEvent(new Event("input"));

    expect(rows(panel).length).toBe(1);
    expect(panel.querySelector(".wd-trow .wd-col-method")?.textContent).toBe("/api/BAR");
  });

  it("shows only failed requests with the Failed chip", () => {
    const store = createStore<NetworkRecord[]>([
      { ...baseRecord, requestId: "1", status: 200 },
      { ...baseRecord, requestId: "2", status: 404 },
    ]);
    const panel = createNetworkPanel(store, vi.fn());
    panel.querySelector<HTMLElement>('.wd-chip[data-value="error"]')!.click();
    expect(rows(panel).length).toBe(1);
    expect(panel.querySelector(".wd-summary")?.textContent).toBe("1 of 2 requests · 1 failed");
  });

  it("calls onClear when the Clear button is clicked", () => {
    const onClear = vi.fn();
    const panel = createNetworkPanel(createStore<NetworkRecord[]>([baseRecord]), onClear);
    (panel.querySelector(".wd-clear-btn") as HTMLElement).click();
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
