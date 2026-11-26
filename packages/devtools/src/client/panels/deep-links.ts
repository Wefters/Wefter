/**
 * The Deep Links panel: every link the app received (from the native shell or sent from here), whether the
 * app is listening with `onDeepLink`, a tester that sends a link to the app or opens it on a device, and
 * the links each environment registers in `wefter.config.json`.
 */

import type { Store } from "../store.js";
import type { DeepLinkEnvironmentInfo, DeepLinkEvent, DeepLinkPlatform, OpenLinkResult } from "../../shared/events.js";
import { h } from "../dom.js";
import { icon } from "../icons.js";
import { createRecordTable } from "./record-table.js";
import {
  chipGroup,
  clearButton,
  compactPreview,
  emptyState,
  formatTime,
  iconButton,
  inspectorSection,
  jsonPreview,
  keyValueList,
  mutedText,
  searchField,
  toolbar,
  toolbarDivider,
  toolbarSpacer,
} from "./shared.js";

/** What the panel asks of the dashboard and the dev server. Tests pass fakes. */
export interface DeepLinksPanelActions {
  /** Clears the link history. */
  onClear(): void;
  /** Sends a link to every connected app, as if the shell had received it. */
  onSimulate(url: string): void;
  /** Opens a link on an Android device or the iOS Simulator. */
  openOnDevice?(platform: DeepLinkPlatform, url: string): Promise<OpenLinkResult>;
  /** Loads each environment's deep links from `wefter.config.json`. */
  loadConfig?(): Promise<DeepLinkEnvironmentInfo[]>;
}

/** Asks the dev server to open a link on a device. */
async function openOnDeviceViaServer(platform: DeepLinkPlatform, url: string): Promise<OpenLinkResult> {
  try {
    const res = await fetch("/__wefter-devtools/api/open-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform, url }),
    });
    return (await res.json()) as OpenLinkResult;
  } catch {
    return { ok: false, output: "Could not reach the dev server." };
  }
}

/** Loads the deep link settings from the dev server. */
async function loadConfigFromServer(): Promise<DeepLinkEnvironmentInfo[]> {
  const res = await fetch("/__wefter-devtools/api/deep-links");
  return (await res.json()) as DeepLinkEnvironmentInfo[];
}

/** Names of the device targets, for buttons and messages. */
const PLATFORM_LABEL: Record<DeepLinkPlatform, string> = { android: "Android", ios: "iOS Simulator" };

/** A link that no listener received: it could not be parsed, or the app was not listening. */
const isUnhandled = (link: DeepLinkEvent) => link.listeners === 0;

/** How the link reached the app, as a short label. */
function originLabel(link: DeepLinkEvent): string {
  if (link.source === "devtools") return "DevTools";
  return link.isLaunch ? "Launch" : "Native";
}

/** A badge for how the link reached the app. */
function originBadge(link: DeepLinkEvent): HTMLElement {
  const tone = link.source === "devtools" ? "pending" : link.isLaunch ? "success" : "";
  return h("span", { class: `wd-badge${tone ? ` wd-badge-${tone}` : ""}` }, originLabel(link));
}

/** Example links of one environment, ready to try: `scheme://` and `https://domain/path`. */
function exampleLinks(env: DeepLinkEnvironmentInfo): string[] {
  const path = (env.paths[0] ?? "/").replace(/\*$/, "");
  return [...env.schemes.map((scheme) => `${scheme}://`), ...env.domains.map((domain) => `https://${domain}${path}`)];
}

/** Details pane content for a link. */
function inspectLink(link: DeepLinkEvent, resend: (url: string) => void, useInTester: (url: string) => void) {
  const queryEntries = Object.entries(link.query);
  const delivery =
    link.scheme === null ? "Not a valid URL" : `${link.listeners} listener${link.listeners === 1 ? "" : "s"}`;
  const body: Node[] = [
    inspectorSection(
      "Overview",
      keyValueList([
        ["URL", h("code", { class: "wd-break" }, link.url)],
        ["Scheme", link.scheme ? h("code", null, link.scheme) : "—"],
        ["Path", link.path ? h("code", { class: "wd-break" }, link.path) : "—"],
        ["Received", link.isLaunch ? "At launch" : "While running"],
        ["Source", link.source === "devtools" ? "DevTools (Send to app)" : "Native shell"],
        ["Delivered to", delivery],
        ["Time", formatTime(link.timestamp)],
      ]),
      { copy: () => link.url },
    ),
  ];

  if (isUnhandled(link)) {
    body.push(
      h(
        "div",
        { class: "wd-note wd-dl-note" },
        link.scheme === null
          ? "The URL could not be parsed, so no listener was called."
          : "No onDeepLink listener received this link. Subscribe early, for example where the router is created.",
      ),
    );
  }

  body.push(
    inspectorSection(
      "Query parameters",
      queryEntries.length
        ? keyValueList(queryEntries.map(([key, value]) => [key, h("code", { class: "wd-break" }, value)]))
        : mutedText("No query parameters"),
      { copy: queryEntries.length ? () => jsonPreview(link.query) : undefined },
    ),
    inspectorSection(
      "Actions",
      h(
        "div",
        { class: "wd-dl-actions" },
        iconButton("send", "Send to app again", () => resend(link.url), { showLabel: true }),
        iconButton("link", "Use in tester", () => useInTester(link.url), { showLabel: true }),
      ),
    ),
  );

  return {
    title: h("span", { class: "wd-break" }, link.path ?? link.url),
    meta: originBadge(link),
    body,
  };
}

/**
 * Creates the Deep Links panel.
 *
 * @param store Links received by connected apps, oldest first.
 * @param listenersStore The `onDeepLink` listener count last reported by an app, or `null` before one has.
 */
export function createDeepLinksPanel(
  store: Store<DeepLinkEvent[]>,
  listenersStore: Store<number | null>,
  actions: DeepLinksPanelActions,
): HTMLElement {
  const openOnDevice = actions.openOnDevice ?? openOnDeviceViaServer;
  const loadConfig = actions.loadConfig ?? loadConfigFromServer;
  let search = "";
  let originFilter = "";

  const listenerStatus = h("span", { class: "wd-dl-status", role: "status" });
  const summaryEl = h("span", { class: "wd-summary", "aria-live": "polite" });
  const chips = chipGroup(
    "Filter by origin",
    [
      { value: "", label: "All" },
      { value: "launch", label: "Launch" },
      { value: "unhandled", label: "Not handled", tone: "warn" },
    ],
    (value) => {
      originFilter = value;
      render();
    },
  );

  const urlInput = h("input", {
    type: "text",
    class: "wd-input wd-dl-url",
    placeholder: "myshop://product/42?ref=test",
    "aria-label": "Link to test",
    spellcheck: "false",
    autocomplete: "off",
    onkeydown: (e) => {
      if ((e as KeyboardEvent).key === "Enter") {
        e.preventDefault();
        sendToApp();
      }
    },
  });
  const resultEl = h("span", { class: "wd-dl-result", "aria-live": "polite" });
  const deviceButtons = (Object.keys(PLATFORM_LABEL) as DeepLinkPlatform[]).map((platform) =>
    iconButton("link", `Open on ${PLATFORM_LABEL[platform]}`, () => void openOn(platform), {
      showLabel: true,
      className: "wd-dl-device-btn",
    }),
  );
  const tester = h(
    "div",
    { class: "wd-dl-tester" },
    h("span", { class: "wd-toolbar-title" }, "Test a link"),
    urlInput,
    iconButton("send", "Send to app", () => sendToApp(), { showLabel: true, className: "wd-dl-send-btn" }),
    ...deviceButtons,
    resultEl,
  );

  const configEl = h("div", { class: "wd-dl-config" });

  /** The tester's URL, or `null` (with a message) when it is empty. */
  function testerUrl(): string | null {
    const url = urlInput.value.trim();
    if (url) return url;
    showResult("Enter a link first.", "error");
    urlInput.focus();
    return null;
  }

  /** Shows the outcome of the last test. */
  function showResult(text: string, tone: "ok" | "error" | "" = "", detail = ""): void {
    resultEl.textContent = text;
    resultEl.className = `wd-dl-result${tone ? ` wd-dl-result-${tone}` : ""}`;
    resultEl.title = detail;
  }

  function sendToApp(url = testerUrl()): void {
    if (!url) return;
    actions.onSimulate(url);
    const listeners = listenersStore.get();
    showResult(
      listeners === 0 ? "Sent, but the app has no onDeepLink listener." : "Sent to the app.",
      listeners === 0 ? "error" : "ok",
    );
  }

  async function openOn(platform: DeepLinkPlatform): Promise<void> {
    const url = testerUrl();
    if (!url) return;
    for (const btn of deviceButtons) btn.disabled = true;
    showResult(`Opening on ${PLATFORM_LABEL[platform]}…`);
    const result = await openOnDevice(platform, url);
    for (const btn of deviceButtons) btn.disabled = false;
    const firstLine = result.output.split("\n").find((line) => line.trim()) ?? "";
    showResult(
      result.ok ? `Opened on ${PLATFORM_LABEL[platform]}.` : `${PLATFORM_LABEL[platform]}: ${firstLine || "failed"}`,
      result.ok ? "ok" : "error",
      result.output,
    );
  }

  /** Puts `url` in the tester and focuses it. */
  function useInTester(url: string): void {
    urlInput.value = url;
    urlInput.focus();
  }

  /** Shows each environment's registered links as buttons that fill the tester. */
  function renderConfig(envs: DeepLinkEnvironmentInfo[] | "loading" | "failed"): void {
    if (envs === "loading" || envs === "failed") {
      configEl.replaceChildren(
        mutedText(envs === "loading" ? "Loading configured links…" : "Could not load wefter.config.json."),
      );
      return;
    }
    const withLinks = envs.filter((env) => env.schemes.length + env.domains.length > 0);
    if (withLinks.length === 0) {
      configEl.replaceChildren(
        mutedText('No deep links configured. Add "deepLinks" to wefter.config.json and run `wefter sync`.'),
      );
      return;
    }
    configEl.replaceChildren(
      ...withLinks.map((env) =>
        h(
          "div",
          { class: "wd-dl-env" },
          h("span", { class: "wd-dl-env-name", title: env.appId }, env.name),
          ...exampleLinks(env).map((url) =>
            h(
              "button",
              { type: "button", class: "wd-dl-example", title: "Use in tester", onclick: () => useInTester(url) },
              url,
            ),
          ),
          env.paths.length ? h("span", { class: "wd-muted" }, `paths: ${env.paths.join(", ")}`) : null,
        ),
      ),
    );
  }

  const table = createRecordTable<DeepLinkEvent>({
    ariaLabel: "Deep links",
    columns: [
      { label: "Origin" },
      { label: "Scheme" },
      { label: "Path" },
      { label: "Query" },
      { label: "Listeners", className: "wd-th-end" },
      { label: "Time", className: "wd-th-end" },
    ],
    gridTemplate: "96px 120px minmax(0, 1.4fr) minmax(0, 1fr) 88px 96px",
    keyOf: (link) => `${link.timestamp}@${link.url}`,
    rowClass: (link) => (isUnhandled(link) ? "wd-row-accent-unhandled" : ""),
    cells: (link) => [
      h("span", { class: "wd-cell" }, originBadge(link)),
      h("span", { class: "wd-cell wd-col-plugin" }, link.scheme ?? "—"),
      h("span", { class: "wd-cell wd-cell-url wd-col-method", title: link.url }, link.path ?? link.url),
      h("span", { class: "wd-cell wd-cell-args" }, Object.keys(link.query).length ? compactPreview(link.query) : "—"),
      h(
        "span",
        { class: `wd-cell wd-cell-num${isUnhandled(link) ? " wd-dl-none" : ""}` },
        isUnhandled(link) ? "None" : String(link.listeners),
      ),
      h("span", { class: "wd-cell wd-cell-time" }, formatTime(link.timestamp)),
    ],
    inspect: (link) => inspectLink(link, (url) => sendToApp(url), useInTester),
    emptyState: () =>
      store.get().length === 0
        ? emptyState(
            "No deep links yet.",
            "Open a link on the device, or try one with the tester above. Links show up here as onDeepLink receives them.",
            "link",
          )
        : emptyState("No links match the filters.", "Clear the search or pick another filter.", "search"),
  });

  const root = h(
    "div",
    { class: "wd-panel-content" },
    toolbar(
      clearButton(actions.onClear),
      toolbarDivider(),
      searchField("Filter by URL…", (value) => {
        search = value;
        render();
      }),
      chips.element,
      toolbarSpacer(),
      listenerStatus,
      summaryEl,
    ),
    tester,
    configEl,
    table.element,
  );

  /** Shows whether the app is listening for links. */
  function renderListeners(count: number | null): void {
    listenerStatus.replaceChildren(
      icon(count === null ? "info" : count === 0 ? "warn" : "check"),
      count === null
        ? "Waiting for the app"
        : count === 0
          ? "No onDeepLink listener"
          : `onDeepLink: ${count} listener${count === 1 ? "" : "s"}`,
    );
    listenerStatus.className = `wd-dl-status${count === 0 ? " wd-dl-status-warn" : count ? " wd-dl-status-ok" : ""}`;
    listenerStatus.title =
      count === 0 ? "Links wait in the native shell until the app subscribes with onDeepLink from @wefterjs/core." : "";
  }

  /** Applies the filters and updates the table and counts. */
  function render(): void {
    const links = store.get();
    const scoped = search ? links.filter((link) => link.url.toLowerCase().includes(search)) : links;
    chips.setCounts({
      launch: scoped.filter((link) => link.isLaunch).length,
      unhandled: scoped.filter(isUnhandled).length,
    });
    const filtered =
      originFilter === "launch"
        ? scoped.filter((link) => link.isLaunch)
        : originFilter === "unhandled"
          ? scoped.filter(isUnhandled)
          : scoped;

    const unhandled = filtered.filter(isUnhandled).length;
    const total = filtered.length === links.length ? `${links.length}` : `${filtered.length} of ${links.length}`;
    summaryEl.textContent = `${total} link${links.length === 1 ? "" : "s"}${unhandled ? ` · ${unhandled} not handled` : ""}`;
    table.setRecords(filtered);
  }

  store.subscribe(render);
  listenersStore.subscribe(renderListeners);
  render();
  renderListeners(listenersStore.get());
  renderConfig("loading");
  loadConfig().then(renderConfig, () => renderConfig("failed"));
  return root;
}
