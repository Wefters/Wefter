import { h } from "../dom.js";

export function statusBadge(status: string): HTMLElement {
  return h("span", { class: `wd-badge wd-badge-${status}` }, status);
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.toLocaleTimeString(undefined, { hour12: false })}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

export function jsonPreview(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export function tryParseJson(text: string | undefined): unknown {
  if (!text) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function clearButton(onClear: () => void): HTMLElement {
  return h(
    "button",
    {
      class: "wd-clear-btn",
      onclick: onClear,
    },
    "Clear",
  );
}

export function copyButton(getText: () => string): HTMLElement {
  const btn = h("button", { class: "wd-copy-btn" }, "Copy");
  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    navigator.clipboard.writeText(getText()).then(
      () => {
        const original = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(() => {
          btn.textContent = original;
        }, 1200);
      },
      () => {},
    );
  });
  return btn;
}

export function expandChevron(isOpen: boolean): HTMLElement {
  return h("span", { class: `wd-chevron${isOpen ? " open" : ""}` }, "▸");
}

export function statusAccentClass(status: string): string {
  if (status === "success") return "wd-row-accent-success";
  if (status === "pending") return "wd-row-accent-pending";
  return "wd-row-accent-error";
}
