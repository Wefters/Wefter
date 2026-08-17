import { describe, expect, it, vi } from "vitest";
import { clear, h } from "../src/client/dom.js";

describe("h", () => {
  it("creates an element with the given tag", () => {
    const el = h("div");
    expect(el.tagName).toBe("DIV");
  });

  it("sets class via the class prop", () => {
    const el = h("span", { class: "foo bar" });
    expect(el.className).toBe("foo bar");
  });

  it("sets arbitrary attributes via setAttribute", () => {
    const el = h("input", { type: "text", placeholder: "hi" });
    expect(el.getAttribute("type")).toBe("text");
    expect(el.getAttribute("placeholder")).toBe("hi");
  });

  it("wires on* props as addEventListener, not attributes", () => {
    const onclick = vi.fn();
    const el = h("button", { onclick });
    expect(el.getAttribute("onclick")).toBeNull();
    el.click();
    expect(onclick).toHaveBeenCalledTimes(1);
  });

  it("skips undefined prop values", () => {
    const el = h("div", { class: undefined });
    expect(el.className).toBe("");
  });

  it("appends string children as text nodes", () => {
    const el = h("div", {}, "hello");
    expect(el.textContent).toBe("hello");
    expect(el.childNodes[0]?.nodeType).toBe(Node.TEXT_NODE);
  });

  it("appends element children in order", () => {
    const child1 = h("span", {}, "a");
    const child2 = h("span", {}, "b");
    const el = h("div", {}, child1, child2);
    expect(el.children[0]).toBe(child1);
    expect(el.children[1]).toBe(child2);
  });

  it("skips null, undefined, and false children", () => {
    const el = h("div", {}, null, undefined, false, "kept");
    expect(el.childNodes.length).toBe(1);
    expect(el.textContent).toBe("kept");
  });

  it("works with no props argument at all", () => {
    const el = h("div", null, "text");
    expect(el.textContent).toBe("text");
  });
});

describe("clear", () => {
  it("removes all children from an element", () => {
    const el = h("div", {}, h("span"), h("span"), "text");
    expect(el.childNodes.length).toBe(3);
    clear(el);
    expect(el.childNodes.length).toBe(0);
  });

  it("is a no-op on an already-empty element", () => {
    const el = h("div");
    expect(() => clear(el)).not.toThrow();
    expect(el.childNodes.length).toBe(0);
  });
});
