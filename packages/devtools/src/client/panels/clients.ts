import type { Store } from "../store.js";
import type { ClientHelloEvent } from "../../shared/events.js";
import { h } from "../dom.js";
import { emptyState, formatTime, toolbar, toolbarSpacer } from "./shared.js";

function shortId(id: string): string {
  return id.length > 10 ? id.slice(0, 8) : id;
}

/** Connected app instances, plus a note on the (not yet reported) native plugin/permission state. */
export function createClientsPanel(presenceStore: Store<ClientHelloEvent[]>): HTMLElement {
  const summaryEl = h("span", { class: "wd-summary", "aria-live": "polite" });
  const body = h("div", { class: "wd-tbody", role: "list", "aria-label": "Connected apps" });

  const root = h(
    "div",
    { class: "wd-panel-content" },
    toolbar(h("span", { class: "wd-toolbar-title" }, "Connected apps"), toolbarSpacer(), summaryEl),
    h(
      "div",
      { class: "wd-table wd-clients-table" },
      h(
        "div",
        { class: "wd-thead", "aria-hidden": "true" },
        h("span", { class: "wd-th" }, "Client"),
        h("span", { class: "wd-th" }, "Page"),
        h("span", { class: "wd-th wd-th-end" }, "Connected"),
      ),
      body,
    ),
    h(
      "p",
      { class: "wd-state-note" },
      h("strong", null, "Plugin & permission state. "),
      "Native shells don't report plugin or permission state yet. Once they do, each app's granted and denied permissions will be listed here.",
    ),
  );

  function render(): void {
    const clients = presenceStore.get();
    summaryEl.textContent = `${clients.length} app${clients.length === 1 ? "" : "s"} connected`;
    if (clients.length === 0) {
      body.replaceChildren(
        emptyState(
          "No app connected yet.",
          "Start the app in a simulator, an emulator or a browser tab pointed at this dev server.",
          "clients",
        ),
      );
      return;
    }
    body.replaceChildren(
      ...clients.map((client) =>
        h(
          "div",
          { class: "wd-trow wd-client-row", role: "listitem" },
          h(
            "span",
            { class: "wd-cell wd-client-id-cell" },
            h("span", { class: "wd-status-dot connected", "aria-hidden": "true" }),
            h("code", { class: "wd-client-id", title: client.clientId }, shortId(client.clientId)),
          ),
          h("span", { class: "wd-cell wd-client-url", title: client.url }, client.url),
          h("span", { class: "wd-cell wd-cell-time" }, formatTime(client.timestamp)),
        ),
      ),
    );
  }

  presenceStore.subscribe(render);
  render();
  return root;
}
