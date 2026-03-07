import { describe, it, expect } from "vitest";
import { searchTree, itemMatchesSearch, highlightSearchText, collectAllTags } from "../../../src/viewer/components/prd-tree/tree-search.js";
import type { PRDItemData } from "../../../src/viewer/components/prd-tree/types.js";
import type { SearchFacets } from "../../../src/viewer/components/prd-tree/tree-search.js";

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

// ── searchTree with facets ──────────────────────────────────────────────────

describe("searchTree with facets", () => {
  const tree: PRDItemData[] = [
    makeItem({
      id: "e1",
      level: "epic",
      status: "pending",
      title: "Auth Epic",
      tags: ["auth", "core"],
      children: [
        makeItem({
          id: "t1",
          level: "task",
          status: "pending",
          title: "Add login form",
          tags: ["auth", "frontend"],
        }),
        makeItem({
          id: "t2",
          level: "task",
          status: "completed",
          title: "Validate tokens",
          tags: ["auth", "backend"],
        }),
        makeItem({
          id: "t3",
          level: "task",
          status: "blocked",
          title: "Add OAuth",
          tags: ["auth", "frontend"],
        }),
      ],
    }),
    makeItem({
      id: "e2",
      level: "epic",
      status: "in_progress",
      title: "Dashboard",
      tags: ["ui"],
      children: [
        makeItem({
          id: "t4",
          level: "task",
          status: "pending",
          title: "Build layout",
          tags: ["frontend"],
        }),
      ],
    }),
  ];

  it("returns empty result when no query and no facets", () => {
    const result = searchTree(tree, "");
    expect(result.matchCount).toBe(0);
  });

  it("returns empty result when facets are empty sets", () => {
    const facets: SearchFacets = { tags: new Set(), statuses: new Set() };
    const result = searchTree(tree, "", facets);
    expect(result.matchCount).toBe(0);
  });

  it("filters by tag facet alone (no text query)", () => {
    const facets: SearchFacets = { tags: new Set(["backend"]) };
    const result = searchTree(tree, "", facets);
    expect(result.matchIds.has("t2")).toBe(true);
    expect(result.matchCount).toBe(1);
  });

  it("filters by multiple tags with AND logic", () => {
    const facets: SearchFacets = { tags: new Set(["auth", "frontend"]) };
    const result = searchTree(tree, "", facets);
    // t1 has auth+frontend, t3 has auth+frontend
    expect(result.matchIds.has("t1")).toBe(true);
    expect(result.matchIds.has("t3")).toBe(true);
    // t2 has auth+backend (missing frontend) → excluded
    expect(result.matchIds.has("t2")).toBe(false);
    // t4 has frontend but not auth → excluded
    expect(result.matchIds.has("t4")).toBe(false);
    expect(result.matchCount).toBe(2);
  });

  it("filters by status facet alone (no text query)", () => {
    const facets: SearchFacets = { statuses: new Set(["completed"] as const) };
    const result = searchTree(tree, "", facets);
    expect(result.matchIds.has("t2")).toBe(true);
    expect(result.matchCount).toBe(1);
  });

  it("filters by multiple statuses with OR logic", () => {
    const facets: SearchFacets = { statuses: new Set(["completed", "blocked"] as const) };
    const result = searchTree(tree, "", facets);
    expect(result.matchIds.has("t2")).toBe(true);
    expect(result.matchIds.has("t3")).toBe(true);
    expect(result.matchCount).toBe(2);
  });

  it("combines text query with tag facet (AND)", () => {
    const facets: SearchFacets = { tags: new Set(["frontend"]) };
    const result = searchTree(tree, "add", facets);
    // "Add login form" has tag frontend → matches
    expect(result.matchIds.has("t1")).toBe(true);
    // "Add OAuth" has tag frontend → matches
    expect(result.matchIds.has("t3")).toBe(true);
    // "Build layout" has tag frontend but title doesn't match "add"
    expect(result.matchIds.has("t4")).toBe(false);
    expect(result.matchCount).toBe(2);
  });

  it("combines text query with status facet (AND)", () => {
    const facets: SearchFacets = { statuses: new Set(["pending"] as const) };
    const result = searchTree(tree, "add", facets);
    // "Add login form" is pending → matches
    expect(result.matchIds.has("t1")).toBe(true);
    // "Add OAuth" is blocked, not pending → excluded
    expect(result.matchIds.has("t3")).toBe(false);
    expect(result.matchCount).toBe(1);
  });

  it("combines text query with both tag and status facets", () => {
    const facets: SearchFacets = {
      tags: new Set(["auth"]),
      statuses: new Set(["pending"] as const),
    };
    const result = searchTree(tree, "add", facets);
    // "Add login form" is pending + has auth tag + matches "add" → yes
    expect(result.matchIds.has("t1")).toBe(true);
    // "Add OAuth" has auth but is blocked → no
    expect(result.matchIds.has("t3")).toBe(false);
    expect(result.matchCount).toBe(1);
  });

  it("includes ancestors of facet matches", () => {
    const facets: SearchFacets = { tags: new Set(["backend"]) };
    const result = searchTree(tree, "", facets);
    // t2 matches; e1 is ancestor
    expect(result.ancestorIds.has("e1")).toBe(true);
    expect(result.visibleIds.has("e1")).toBe(true);
    expect(result.expandIds.has("e1")).toBe(true);
  });

  it("excludes items without matching tags", () => {
    const facets: SearchFacets = { tags: new Set(["nonexistent"]) };
    const result = searchTree(tree, "", facets);
    expect(result.matchCount).toBe(0);
  });
});

// ── collectAllTags ──────────────────────────────────────────────────────────

describe("collectAllTags", () => {
  it("returns empty array for tree with no tags", () => {
    const tree: PRDItemData[] = [
      makeItem({ id: "t1", level: "task", status: "pending", title: "No tags" }),
    ];
    expect(collectAllTags(tree)).toEqual([]);
  });

  it("collects tags from all levels", () => {
    const tree: PRDItemData[] = [
      makeItem({
        id: "e1",
        level: "epic",
        status: "pending",
        title: "Epic",
        tags: ["core"],
        children: [
          makeItem({
            id: "t1",
            level: "task",
            status: "pending",
            title: "Task",
            tags: ["frontend", "auth"],
          }),
        ],
      }),
    ];
    expect(collectAllTags(tree)).toEqual(["auth", "core", "frontend"]);
  });

  it("deduplicates tags", () => {
    const tree: PRDItemData[] = [
      makeItem({ id: "t1", level: "task", status: "pending", title: "A", tags: ["web", "api"] }),
      makeItem({ id: "t2", level: "task", status: "pending", title: "B", tags: ["web", "db"] }),
    ];
    expect(collectAllTags(tree)).toEqual(["api", "db", "web"]);
  });

  it("returns sorted alphabetically", () => {
    const tree: PRDItemData[] = [
      makeItem({ id: "t1", level: "task", status: "pending", title: "A", tags: ["zeta", "alpha", "mu"] }),
    ];
    expect(collectAllTags(tree)).toEqual(["alpha", "mu", "zeta"]);
  });
});
