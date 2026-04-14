import { describe, it, expect } from "vitest";
import { walkFixTree, collectFixItemIds } from "../../../src/fix/tree.js";
import type { FixItem } from "../../../src/fix/types.js";

function makeItem(id: string, overrides: Partial<FixItem> = {}): FixItem {
  return { id, title: `Item ${id}`, status: "pending", ...overrides };
}

describe("walkFixTree", () => {
  it("yields nothing for empty input", () => {
    expect([...walkFixTree([])]).toHaveLength(0);
  });

  it("yields each item with empty parent chain for flat list", () => {
    const items = [makeItem("a"), makeItem("b")];
    const result = [...walkFixTree(items)];
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ item: items[0], parents: [] });
    expect(result[1]).toEqual({ item: items[1], parents: [] });
  });

  it("yields parent before children", () => {
    const child = makeItem("child");
    const parent = makeItem("parent", { children: [child] });
    const result = [...walkFixTree([parent])];
    expect(result).toHaveLength(2);
    expect(result[0]!.item.id).toBe("parent");
    expect(result[1]!.item.id).toBe("child");
  });

  it("builds parent chain for directly nested child", () => {
    const child = makeItem("child");
    const parent = makeItem("parent", { children: [child] });
    const result = [...walkFixTree([parent])];
    expect(result[1]).toEqual({ item: child, parents: [parent] });
  });

  it("builds full parent chain for deeply nested items", () => {
    const grandchild = makeItem("gc");
    const child = makeItem("c", { children: [grandchild] });
    const grandparent = makeItem("gp", { children: [child] });
    const result = [...walkFixTree([grandparent])];
    expect(result).toHaveLength(3);
    expect(result[2]).toEqual({ item: grandchild, parents: [grandparent, child] });
  });

  it("traverses siblings after all children of first item", () => {
    const childA = makeItem("a-child");
    const itemA = makeItem("a", { children: [childA] });
    const itemB = makeItem("b");
    const result = [...walkFixTree([itemA, itemB])];
    expect(result.map((e) => e.item.id)).toEqual(["a", "a-child", "b"]);
  });

  it("does not recurse when children array is empty", () => {
    const item = makeItem("x", { children: [] });
    const result = [...walkFixTree([item])];
    expect(result).toHaveLength(1);
    expect(result[0]!.parents).toHaveLength(0);
  });
});

describe("collectFixItemIds", () => {
  it("returns empty set for empty input", () => {
    expect(collectFixItemIds([])).toEqual(new Set());
  });

  it("collects IDs from flat list", () => {
    const items = [makeItem("a"), makeItem("b"), makeItem("c")];
    expect(collectFixItemIds(items)).toEqual(new Set(["a", "b", "c"]));
  });

  it("collects IDs from nested items", () => {
    const child = makeItem("child");
    const parent = makeItem("parent", { children: [child] });
    expect(collectFixItemIds([parent])).toEqual(new Set(["parent", "child"]));
  });

  it("collects IDs from deeply nested items", () => {
    const grandchild = makeItem("gc");
    const child = makeItem("c", { children: [grandchild] });
    const root = makeItem("r", { children: [child] });
    expect(collectFixItemIds([root])).toEqual(new Set(["r", "c", "gc"]));
  });
});
