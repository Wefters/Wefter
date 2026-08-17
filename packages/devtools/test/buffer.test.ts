import { describe, expect, it } from "vitest";
import { RingBuffer } from "../src/server/buffer.js";

describe("RingBuffer", () => {
  it("keeps items in push order while under the cap", () => {
    const buffer = new RingBuffer<number>(3);
    buffer.push(1);
    buffer.push(2);

    expect(buffer.toArray()).toEqual([1, 2]);
  });

  it("drops the oldest item once the cap is exceeded", () => {
    const buffer = new RingBuffer<number>(3);
    buffer.push(1);
    buffer.push(2);
    buffer.push(3);
    buffer.push(4);

    expect(buffer.toArray()).toEqual([2, 3, 4]);
  });

  it("keeps dropping from the front as more items arrive past the cap", () => {
    const buffer = new RingBuffer<number>(2);
    for (let i = 1; i <= 5; i++) buffer.push(i);

    expect(buffer.toArray()).toEqual([4, 5]);
  });

  it("toArray returns a copy, not a live reference", () => {
    const buffer = new RingBuffer<number>(3);
    buffer.push(1);
    const snapshot = buffer.toArray();
    buffer.push(2);

    expect(snapshot).toEqual([1]);
  });

  it("updateLast merges into the most recent match, most-recent-first search", () => {
    const buffer = new RingBuffer<{ id: string; value: number }>(10);
    buffer.push({ id: "a", value: 1 });
    buffer.push({ id: "b", value: 1 });
    buffer.push({ id: "a", value: 2 });

    const found = buffer.updateLast(
      (item) => item.id === "a",
      (item) => ({ ...item, value: 99 }),
    );

    expect(found).toBe(true);
    expect(buffer.toArray()).toEqual([
      { id: "a", value: 1 },
      { id: "b", value: 1 },
      { id: "a", value: 99 },
    ]);
  });

  it("updateLast returns false and leaves the buffer untouched when nothing matches", () => {
    const buffer = new RingBuffer<{ id: string }>(10);
    buffer.push({ id: "a" });

    const found = buffer.updateLast(
      (item) => item.id === "missing",
      (item) => item,
    );

    expect(found).toBe(false);
    expect(buffer.toArray()).toEqual([{ id: "a" }]);
  });
});
