import type { Store } from "../store.js";
import type { ClientHelloEvent } from "../../shared/events.js";
import { clear, h } from "../dom.js";

export function createPluginStatePanel(presenceStore: Store<ClientHelloEvent[]>): HTMLElement {
  const root = h("div", { class: "wd-panel-content" });
  const body = h("div", { class: "wd-empty" });
  root.appendChild(body);

  function render(): void {
    const count = presenceStore.get().length;
    clear(body);
    body.appendChild(
      h(
        "div",
        {},
        h("div", {}, "No native client connected yet."),
        h(
          "div",
          { class: "wd-col-dim" },
          `${count} JS client${count === 1 ? "" : "s"} connected, 0 reporting plugin/permission state.`,
        ),
      ),
    );
  }

  presenceStore.subscribe(render);
  render();
  return root;
}
