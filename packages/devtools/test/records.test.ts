import { describe, expect, it } from "vitest";
import { appendRecord, mergeRecordById } from "../src/client/records.js";

describe("appendRecord", () => {
  it("returns a new array with the item appended", () => {
    const original = [1, 2];
    const result = appendRecord(original, 3);
    expect(result).toEqual([1, 2, 3]);
    expect(result).not.toBe(original);
    expect(original).toEqual([1, 2]);
  });
});

describe("mergeRecordById", () => {
  it("merges the patch into the record matching the key", () => {
    const list = [
      { id: "a", value: 1 },
      { id: "b", value: 2 },
    ];
    const result = mergeRecordById(list, "id", { id: "b", value: 99 });
    expect(result).toEqual([
      { id: "a", value: 1 },
      { id: "b", value: 99 },
    ]);
  });

  it("returns the same array reference when nothing matches", () => {
    const list = [{ id: "a", value: 1 }];
    const result = mergeRecordById(list, "id", { id: "missing", value: 5 });
    expect(result).toBe(list);
  });

  it("does not mutate the original array", () => {
    const list = [{ id: "a", value: 1 }];
    mergeRecordById(list, "id", { id: "a", value: 2 });
    expect(list).toEqual([{ id: "a", value: 1 }]);
  });

  it("only patches the given fields, keeping the rest of the record", () => {
    const list = [{ id: "a", status: "pending", plugin: "haptics" }];
    const result = mergeRecordById(list, "id", { id: "a", status: "success" });
    expect(result).toEqual([{ id: "a", status: "success", plugin: "haptics" }]);
  });

  it("matches the most-recently-pushed record when duplicate ids exist, first match wins by index order", () => {
    const list = [
      { id: "a", value: 1 },
      { id: "a", value: 2 },
    ];
    const result = mergeRecordById(list, "id", { id: "a", value: 99 });
    expect(result).toEqual([
      { id: "a", value: 99 },
      { id: "a", value: 2 },
    ]);
  });
});
