import type { Store } from "./store.js";
import type { ClientHelloEvent } from "../shared/events.js";
import { clear, h } from "./dom.js";

export interface PanelDef {
  id: string;
  label: string;
  element: HTMLElement;
}

export function mountShell(root: HTMLElement, panels: PanelDef[], presenceStore: Store<ClientHelloEvent[]>): void {
  let activeId = panels[0]?.id;

  const statusDot = h("span", { class: "wd-status-dot" });
  const clientsEl = h("span", { class: "wd-clients" }, "0 clients connected");
  const header = h(
    "div",
    { class: "wd-header" },
    h("span", { class: "wd-title" }, "Wefter Dev Tools"),
    h("span", { class: "wd-clients-group" }, statusDot, clientsEl),
  );
  const tabsEl = h("div", { class: "wd-tabs" });

  function renderTabs(): void {
    clear(tabsEl);
    for (const panel of panels) {
      tabsEl.appendChild(
        h(
          "div",
          {
            class: `wd-tab${panel.id === activeId ? " active" : ""}`,
            onclick: () => {
              activeId = panel.id;
              renderTabs();
              renderPanels();
            },
          },
          panel.label,
        ),
      );
    }
  }

  function renderPanels(): void {
    for (const panel of panels) panel.element.classList.toggle("active", panel.id === activeId);
  }

  presenceStore.subscribe((clients) => {
    clientsEl.textContent = `${clients.length} client${clients.length === 1 ? "" : "s"} connected`;
    statusDot.classList.toggle("connected", clients.length > 0);
  });

  for (const panel of panels) panel.element.classList.add("wd-panel");

  renderTabs();
  renderPanels();

  root.append(header, tabsEl, ...panels.map((p) => p.element));
}
