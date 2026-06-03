import { describe, it, expect } from "vitest";
import { toCanonicalJSON, sortItems } from "../../../src/core/canonical.js";
import { makeItem } from "../../helpers/index.js";

describe("toCanonicalJSON", () => {
  it("produces pretty-printed JSON with trailing newline", () => {
    const result = toCanonicalJSON({ a: 1, b: [2, 3] });
    expect(result).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}\n');
  });

  it("ends with newline", () => {
    expect(toCanonicalJSON({})).toMatch(/\n$/);
  });

  it("handles null", () => {
    expect(toCanonicalJSON(null)).toBe("null\n");
  });
});

describe("sortItems", () => {
  it("sorts by priority (critical first)", () => {
    const items: PRDItem[] = [
      makeItem({ id: "1", title: "Low", priority: "low" }),
      makeItem({ id: "2", title: "Critical", priority: "critical" }),
      makeItem({ id: "3", title: "High", priority: "high" }),
      makeItem({ id: "4", title: "Medium", priority: "medium" }),
    ];
    const sorted = sortItems(items);
    expect(sorted.map((i) => i.priority)).toEqual([
      "critical",
      "high",
      "medium",
      "low",
    ]);
  });

  it("sorts alphabetically within same priority", () => {
    const items: PRDItem[] = [
      makeItem({ id: "1", title: "Zebra", priority: "high" }),
      makeItem({ id: "2", title: "Apple", priority: "high" }),
    ];
    const sorted = sortItems(items);
    expect(sorted.map((i) => i.title)).toEqual(["Apple", "Zebra"]);
  });

  it("treats missing priority as medium", () => {
    const items: PRDItem[] = [
      makeItem({ id: "1", title: "No Priority" }),
      makeItem({ id: "2", title: "High", priority: "high" }),
    ];
    const sorted = sortItems(items);
    expect(sorted[0].priority).toBe("high");
  });

  it("recursively sorts children", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [
          makeItem({ id: "t1", title: "Low Task", priority: "low" }),
          makeItem({ id: "t2", title: "High Task", priority: "high" }),
        ],
      }),
    ];
    const sorted = sortItems(items);
    expect(sorted[0].children![0].priority).toBe("high");
    expect(sorted[0].children![1].priority).toBe("low");
  });

  it("does not mutate original array", () => {
    const items: PRDItem[] = [
      makeItem({ id: "1", title: "B" }),
      makeItem({ id: "2", title: "A" }),
    ];
    const sorted = sortItems(items);
    expect(items[0].title).toBe("B");
    expect(sorted[0].title).toBe("A");
  });
});
