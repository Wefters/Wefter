export function truncate(str: string, capChars: number): { preview: string; truncated: boolean } {
  if (str.length <= capChars) return { preview: str, truncated: false };
  return { preview: str.slice(0, capChars), truncated: true };
}

const MAX_ITEMS = 50;

export function safeSerialize(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || typeof value !== "object") {
    return typeof value === "function" ? `[Function: ${value.name || "anonymous"}]` : value;
  }
  if (value instanceof Error) {
    return { __wefterKind: "error", name: value.name, message: value.message, stack: value.stack };
  }
  if (typeof Node !== "undefined" && value instanceof Node) {
    const el = value as Partial<Element>;
    const outerHtml = typeof el.outerHTML === "string" ? el.outerHTML : String(value);
    return {
      __wefterKind: "dom",
      tag: el.tagName ?? (value as Node).nodeName,
      preview: truncate(outerHtml, 200).preview,
    };
  }
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.slice(0, MAX_ITEMS).map((item) => safeSerialize(item, seen));
    }
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const key of Object.keys(value)) {
      if (++count > MAX_ITEMS) {
        out["…"] = "[truncated]";
        break;
      }
      out[key] = safeSerialize((value as Record<string, unknown>)[key], seen);
    }
    return out;
  } catch {
    return "[Unserializable]";
  } finally {
    seen.delete(value);
  }
}
