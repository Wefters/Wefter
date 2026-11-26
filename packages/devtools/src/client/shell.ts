/**
 * The dashboard frame: header with logo, panel tabs, connection status and actions; the active panel;
 * and a status bar with server state, statistics and keyboard hints.
 */

import type { Store } from "./store.js";
import type { ClientHelloEvent } from "../shared/events.js";
import { h } from "./dom.js";
import { icon, wefterLogo } from "./icons.js";

/** Count shown on a tab. A tone colours it for errors or warnings. */
export interface PanelBadge {
  count: number;
  tone?: "error" | "warn" | "";
}

/** A panel to show in the shell. */
export interface PanelDef {
  id: string;
  label: string;
  element: HTMLElement;
  badge?: Store<PanelBadge>;
}

/** A statistic shown in the status bar. */
export interface StatusItem {
  label: string;
  tone?: "error" | "warn" | "";
}

/** Optional live data for the status bar. */
export interface ShellOptions {
  serverConnected?: Store<boolean>;
  stats?: Store<StatusItem[]>;
}

/** `localStorage` key of the chosen theme. */
const THEME_KEY = "wefter-devtools:theme";
type Theme = "dark" | "light";

/** The saved theme, else the system preference. */
function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {}
  const prefersLight = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches;
  return prefersLight ? "light" : "dark";
}

/** Whether keyboard shortcuts should be ignored because the user is typing. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName);
}

/** A keyboard hint for the status bar. */
function kbd(keys: string, label: string): HTMLElement {
  return h("span", { class: "wd-hint" }, h("kbd", null, keys), label);
}

/**
 * Builds the shell around `panels`.
 *
 * Keyboard shortcuts: `/` or Cmd/Ctrl+K focuses the active panel's filter, `1`–`9` switch panels,
 * arrow keys move between tabs, and Esc closes the open details pane.
 *
 * @param presenceStore Connected apps; drives the connection pill and enables the reload button.
 * @param onReloadDevice Called by the "Reload app" button.
 */
export function mountShell(
  root: HTMLElement,
  panels: PanelDef[],
  presenceStore: Store<ClientHelloEvent[]>,
  onReloadDevice: () => void = () => {},
  options: ShellOptions = {},
): void {
  let activeId = panels[0]?.id;
  let theme = initialTheme();
  const doc = root.ownerDocument;
  doc.documentElement.dataset.theme = theme;

  const tabsEl = h("nav", { class: "wd-tabs", role: "tablist", "aria-label": "Panels" });
  const tabButtons = panels.map((panel, index) => {
    const badge = h("span", { class: "wd-tab-badge" });
    const btn = h(
      "button",
      {
        type: "button",
        class: "wd-tab",
        role: "tab",
        id: `wd-tab-${panel.id}`,
        "aria-controls": `wd-panel-${panel.id}`,
        title: index < 9 ? `${panel.label} (${index + 1})` : panel.label,
        onclick: () => activate(panel.id, false),
        onkeydown: (e) => {
          const key = (e as KeyboardEvent).key;
          const step = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
          if (!step) return;
          e.preventDefault();
          activate(panels[(index + step + panels.length) % panels.length]!.id, true);
        },
      },
      h("span", { class: "wd-tab-label" }, panel.label),
      badge,
    );
    panel.badge?.subscribe(({ count, tone }) => {
      badge.textContent = count > 0 ? (count > 999 ? "999+" : String(count)) : "";
      badge.className = `wd-tab-badge${tone ? ` wd-tab-badge-${tone}` : ""}`;
    });
    tabsEl.appendChild(btn);
    return btn;
  });

  const statusDot = h("span", { class: "wd-status-dot", "aria-hidden": "true" });
  const clientsEl = h("span", { class: "wd-clients" }, "0 clients connected");
  const clientUrlEl = h("span", { class: "wd-conn-url" });
  const connEl = h("div", { class: "wd-conn", role: "status" }, statusDot, clientsEl, clientUrlEl);
  const reloadBtn = h(
    "button",
    {
      type: "button",
      class: "wd-btn wd-reload-btn",
      title: "Reload every connected app",
      onclick: () => onReloadDevice(),
    },
    icon("reload"),
    h("span", { class: "wd-btn-label" }, "Reload app"),
  );
  const themeBtn = h("button", {
    type: "button",
    class: "wd-btn wd-btn-icon wd-theme-btn",
    onclick: () => {
      theme = theme === "dark" ? "light" : "dark";
      doc.documentElement.dataset.theme = theme;
      try {
        localStorage.setItem(THEME_KEY, theme);
      } catch {}
      renderThemeButton();
    },
  });
  /** Shows the icon of the theme the button switches to. */
  function renderThemeButton(): void {
    const next = theme === "dark" ? "light" : "dark";
    themeBtn.replaceChildren(icon(theme === "dark" ? "sun" : "moon"));
    themeBtn.title = `Switch to ${next} theme`;
    themeBtn.setAttribute("aria-label", `Switch to ${next} theme`);
  }
  renderThemeButton();

  const header = h(
    "header",
    { class: "wd-header" },
    h("div", { class: "wd-brand" }, wefterLogo(), h("span", { class: "wd-title-sub" }, "DevTools")),
    tabsEl,
    h(
      "div",
      { class: "wd-header-actions" },
      connEl,
      h("span", { class: "wd-header-sep", "aria-hidden": "true" }),
      reloadBtn,
      themeBtn,
    ),
  );

  const main = h("main", { class: "wd-main" });
  for (const panel of panels) {
    panel.element.classList.add("wd-panel");
    panel.element.id = `wd-panel-${panel.id}`;
    panel.element.setAttribute("role", "tabpanel");
    panel.element.setAttribute("aria-labelledby", `wd-tab-${panel.id}`);
    main.appendChild(panel.element);
  }

  /** Shows one panel and updates the tab states. */
  function activate(id: string, focusTab: boolean): void {
    activeId = id;
    panels.forEach((panel, i) => {
      const on = panel.id === activeId;
      panel.element.classList.toggle("active", on);
      const tab = tabButtons[i]!;
      tab.classList.toggle("active", on);
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on && focusTab) tab.focus();
    });
  }

  const serverDot = h("span", { class: "wd-status-dot connected", "aria-hidden": "true" });
  const serverText = h("span", null, "Dev server connected");
  const statsEl = h("div", { class: "wd-statusbar-stats" });
  const footer = h(
    "footer",
    { class: "wd-statusbar" },
    h("div", { class: "wd-server-state", role: "status" }, serverDot, serverText),
    statsEl,
    h(
      "div",
      { class: "wd-hints", "aria-hidden": "true" },
      kbd("/", "Filter"),
      kbd("↑↓", "Move"),
      kbd("Esc", "Close"),
      kbd(`1–${Math.min(panels.length, 9)}`, "Panels"),
    ),
  );

  options.serverConnected?.subscribe((connected) => {
    serverDot.classList.toggle("connected", connected);
    serverDot.classList.toggle("offline", !connected);
    serverText.textContent = connected ? "Dev server connected" : "Dev server offline — reconnecting…";
  });
  options.stats?.subscribe((items) => {
    statsEl.replaceChildren(
      ...items.map((item) => h("span", { class: `wd-stat${item.tone ? ` wd-stat-${item.tone}` : ""}` }, item.label)),
    );
  });

  presenceStore.subscribe((clients) => {
    clientsEl.textContent = `${clients.length} client${clients.length === 1 ? "" : "s"} connected`;
    clientUrlEl.textContent = clients.length === 1 ? clients[0]!.url : "";
    clientUrlEl.title = clients.length === 1 ? clients[0]!.url : "";
    connEl.title = clients.length === 1 ? `${clientsEl.textContent} · ${clients[0]!.url}` : clientsEl.textContent;
    statusDot.classList.toggle("connected", clients.length > 0);
    reloadBtn.disabled = clients.length === 0;
  });

  doc.addEventListener("keydown", (event) => {
    if (!root.isConnected || event.altKey || isTextEntry(event.target)) return;
    const mod = event.metaKey || event.ctrlKey;
    if (event.key === "Escape") {
      root.querySelector<HTMLElement>(".wd-panel.active .wd-inspector-close")?.click();
      return;
    }
    if (event.key === "/" || (mod && event.key.toLowerCase() === "k")) {
      const search = root.querySelector<HTMLInputElement>(".wd-panel.active .wd-search");
      if (search) {
        event.preventDefault();
        search.focus();
        search.select();
      }
      return;
    }
    if (!mod && /^[1-9]$/.test(event.key)) {
      const panel = panels[Number(event.key) - 1];
      if (panel) {
        event.preventDefault();
        activate(panel.id, false);
      }
    }
  });

  activate(activeId ?? "", false);
  root.classList.add("wd-app");
  root.append(header, main, footer);
}
