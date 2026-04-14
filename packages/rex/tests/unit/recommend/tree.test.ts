import { describe, it, expect } from "vitest";
import { walkRecommendationTree } from "../../../src/recommend/tree.js";
import type { RecommendationTreeItem } from "../../../src/recommend/types.js";

function makeItem(
  id: string,
  children: RecommendationTreeItem[] = [],
): RecommendationTreeItem {
  return { id, title: `Item ${id}`, status: "pending", level: "task", children };
}

describe("walkRecommendationTree", () => {
  it("yields nothing for empty input", () => {
    expect([...walkRecommendationTree([])]).toHaveLength(0);
  });

  it("yields each item in a flat list", () => {
    const items = [makeItem("a"), makeItem("b"), makeItem("c")];
    const result = [...walkRecommendationTree(items)];
    expect(result).toHaveLength(3);
    expect(result.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("yields parent before its children", () => {
    const child = makeItem("child");
    const parent = makeItem("parent", [child]);
    const result = [...walkRecommendationTree([parent])];
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe("parent");
    expect(result[1]!.id).toBe("child");
  });

  it("traverses in depth-first order", () => {
    const grandchild = makeItem("gc");
    const child = makeItem("c", [grandchild]);
    const sibling = makeItem("s");
    const root = makeItem("r", [child, sibling]);
    const result = [...walkRecommendationTree([root])];
    expect(result.map((i) => i.id)).toEqual(["r", "c", "gc", "s"]);
  });

  it("yields each item object by reference", () => {
    const item = makeItem("x");
    const [first] = [...walkRecommendationTree([item])];
    expect(first).toBe(item);
  });

  it("works with readonly arrays", () => {
    const items: readonly RecommendationTreeItem[] = [makeItem("a"), makeItem("b")];
    const result = [...walkRecommendationTree(items)];
    expect(result).toHaveLength(2);
  });

  it("handles items with no children field (undefined)", () => {
    const item: RecommendationTreeItem = {
      id: "x",
      title: "X",
      status: "pending",
      level: "epic",
    };
    const result = [...walkRecommendationTree([item])];
    expect(result).toHaveLength(1);
  });

  it("handles items with empty children array", () => {
    const item = makeItem("x", []);
    const result = [...walkRecommendationTree([item])];
    expect(result).toHaveLength(1);
  });

  it("visits all items in a multi-level tree", () => {
    const items = [
      makeItem("epic", [
        makeItem("feature", [
          makeItem("task1"),
          makeItem("task2"),
        ]),
      ]),
      makeItem("epic2"),
    ];
    const result = [...walkRecommendationTree(items)];
    expect(result.map((i) => i.id)).toEqual(["epic", "feature", "task1", "task2", "epic2"]);
  });
});
