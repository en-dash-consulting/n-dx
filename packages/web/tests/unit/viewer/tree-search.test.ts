import { describe, it, expect } from "vitest";
import { searchTree, itemMatchesSearch, highlightSearchText } from "../../../src/viewer/components/prd-tree/tree-search.js";
import type { PRDItemData } from "../../../src/viewer/components/prd-tree/types.js";

function makeItem(
  overrides: Partial<PRDItemData> & { id: string; level: PRDItemData["level"]; status: PRDItemData["status"] },
): PRDItemData {
  return {
    title: overrides.id,
    ...overrides,
  };
}

// ── searchTree ──────────────────────────────────────────────────────────────

describe("searchTree", () => {
  const tree: PRDItemData[] = [
    makeItem({
      id: "e1",
      level: "epic",
      status: "pending",
      title: "Auth Epic",
      children: [
        makeItem({
          id: "f1",
          level: "feature",
          status: "pending",
          title: "Login Feature",
          children: [
            makeItem({ id: "t1", level: "task", status: "pending", title: "Add login form" }),
            makeItem({ id: "t2", level: "task", status: "completed", title: "Validate tokens", description: "JWT token validation" }),
          ],
        }),
        makeItem({
          id: "f2",
          level: "feature",
          status: "pending",
          title: "Signup Feature",
          children: [
            makeItem({ id: "t3", level: "task", status: "pending", title: "Add signup page" }),
          ],
        }),
      ],
    }),
    makeItem({
      id: "e2",
      level: "epic",
      status: "pending",
      title: "Dashboard Epic",
      children: [
        makeItem({ id: "t4", level: "task", status: "pending", title: "Build dashboard layout" }),
      ],
    }),
  ];

  it("returns empty result for empty query", () => {
    const result = searchTree(tree, "");
    expect(result.matchCount).toBe(0);
    expect(result.matchIds.size).toBe(0);
    expect(result.visibleIds.size).toBe(0);
  });

  it("returns empty result for whitespace-only query", () => {
    const result = searchTree(tree, "   ");
    expect(result.matchCount).toBe(0);
  });

  it("finds items by title (case-insensitive)", () => {
    const result = searchTree(tree, "login");
    expect(result.matchIds.has("f1")).toBe(true);
    expect(result.matchIds.has("t1")).toBe(true);
    expect(result.matchCount).toBe(2); // "Login Feature" and "Add login form"
  });

  it("finds items by description", () => {
    const result = searchTree(tree, "JWT");
    expect(result.matchIds.has("t2")).toBe(true);
    expect(result.matchCount).toBe(1);
  });

  it("includes ancestors of matches in visibleIds", () => {
    const result = searchTree(tree, "login form");
    expect(result.matchIds.has("t1")).toBe(true);
    // Ancestors: e1 and f1
    expect(result.ancestorIds.has("e1")).toBe(true);
    expect(result.ancestorIds.has("f1")).toBe(true);
    // All in visibleIds
    expect(result.visibleIds.has("t1")).toBe(true);
    expect(result.visibleIds.has("e1")).toBe(true);
    expect(result.visibleIds.has("f1")).toBe(true);
  });

  it("includes ancestors in expandIds", () => {
    const result = searchTree(tree, "signup page");
    expect(result.matchIds.has("t3")).toBe(true);
    expect(result.expandIds.has("e1")).toBe(true);
    expect(result.expandIds.has("f2")).toBe(true);
  });

  it("does not include unrelated branches", () => {
    const result = searchTree(tree, "dashboard");
    expect(result.matchIds.has("t4")).toBe(true);
    expect(result.matchIds.has("e2")).toBe(true);
    // e1 and its children should NOT be visible
    expect(result.visibleIds.has("e1")).toBe(false);
    expect(result.visibleIds.has("f1")).toBe(false);
  });

  it("matches across multiple branches", () => {
    const result = searchTree(tree, "add");
    // "Add login form" and "Add signup page"
    expect(result.matchIds.has("t1")).toBe(true);
    expect(result.matchIds.has("t3")).toBe(true);
    expect(result.matchCount).toBe(2);
  });
});

// ── itemMatchesSearch ───────────────────────────────────────────────────────

describe("itemMatchesSearch", () => {
  it("returns true when item is in visibleIds", () => {
    const item = makeItem({ id: "t1", level: "task", status: "pending" });
    const visibleIds = new Set(["t1"]);
    expect(itemMatchesSearch(item, visibleIds)).toBe(true);
  });

  it("returns true when a descendant is in visibleIds", () => {
    const item = makeItem({
      id: "e1",
      level: "epic",
      status: "pending",
      children: [
        makeItem({ id: "t1", level: "task", status: "pending" }),
      ],
    });
    const visibleIds = new Set(["t1"]);
    expect(itemMatchesSearch(item, visibleIds)).toBe(true);
  });

  it("returns false when item and descendants are not in visibleIds", () => {
    const item = makeItem({
      id: "e1",
      level: "epic",
      status: "pending",
      children: [
        makeItem({ id: "t1", level: "task", status: "pending" }),
      ],
    });
    const visibleIds = new Set(["t99"]);
    expect(itemMatchesSearch(item, visibleIds)).toBe(false);
  });
});

// ── highlightSearchText ─────────────────────────────────────────────────────

describe("highlightSearchText", () => {
  it("returns plain text for empty query", () => {
    const result = highlightSearchText("Hello world", "");
    expect(result).toEqual(["Hello world"]);
  });

  it("returns plain text when no match", () => {
    const result = highlightSearchText("Hello world", "xyz");
    expect(result).toEqual(["Hello world"]);
  });

  it("wraps matched substring in mark element", () => {
    const result = highlightSearchText("Hello world", "world");
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("Hello ");
    // Second element is a VNode (mark)
    const mark = result[1] as any;
    expect(mark.type).toBe("mark");
    expect(mark.props.class).toBe("prd-search-highlight");
    expect(mark.props.children).toBe("world");
  });

  it("is case-insensitive", () => {
    const result = highlightSearchText("Hello World", "hello");
    expect(result).toHaveLength(2);
    const mark = result[0] as any;
    expect(mark.type).toBe("mark");
    expect(mark.props.children).toBe("Hello");
    expect(result[1]).toBe(" World");
  });

  it("highlights multiple occurrences", () => {
    const result = highlightSearchText("test the test case", "test");
    expect(result).toHaveLength(4);
    // mark, " the ", mark, " case"
    expect((result[0] as any).type).toBe("mark");
    expect(result[1]).toBe(" the ");
    expect((result[2] as any).type).toBe("mark");
    expect(result[3]).toBe(" case");
  });

  it("handles match at end of string", () => {
    const result = highlightSearchText("find me", "me");
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("find ");
    expect((result[1] as any).props.children).toBe("me");
  });

  it("handles match at start of string", () => {
    const result = highlightSearchText("start here", "start");
    expect(result).toHaveLength(2);
    expect((result[0] as any).props.children).toBe("start");
    expect(result[1]).toBe(" here");
  });

  it("handles entire string as match", () => {
    const result = highlightSearchText("match", "match");
    expect(result).toHaveLength(1);
    expect((result[0] as any).type).toBe("mark");
    expect((result[0] as any).props.children).toBe("match");
  });
});
