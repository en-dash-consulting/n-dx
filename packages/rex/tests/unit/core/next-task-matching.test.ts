import { describe, it, expect } from "vitest";
import {
  extractTaskKeywords,
  matchTasksByKeywords,
} from "../../../src/core/next-task.js";
import type { PRDItem } from "../../../src/schema/index.js";

function makeItem(overrides: Partial<PRDItem> & { id: string; title: string }): PRDItem {
  return {
    status: "pending",
    level: "task",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// extractTaskKeywords
// ---------------------------------------------------------------------------

describe("extractTaskKeywords", () => {
  it("extracts keywords from title", () => {
    const item = makeItem({ id: "t1", title: "Implement tree traversal" });
    const kw = extractTaskKeywords(item);
    expect(kw).toContain("implement");
    expect(kw).toContain("tree");
    expect(kw).toContain("traversal");
  });

  it("extracts keywords from acceptance criteria", () => {
    const item = makeItem({
      id: "t1",
      title: "Task",
      acceptanceCriteria: ["Progress statistics are accurate", "Parent chains computed correctly"],
    });
    const kw = extractTaskKeywords(item);
    expect(kw).toContain("progress");
    expect(kw).toContain("statistics");
    expect(kw).toContain("accurate");
    expect(kw).toContain("parent");
    expect(kw).toContain("chains");
  });

  it("extracts keywords from tags", () => {
    const item = makeItem({
      id: "t1",
      title: "Task",
      tags: ["tree-ops", "performance"],
    });
    const kw = extractTaskKeywords(item);
    expect(kw).toContain("tree-ops");
    expect(kw).toContain("performance");
  });

  it("extracts keywords from description", () => {
    const item = makeItem({
      id: "t1",
      title: "Task",
      description: "Enhance next-task selection with keyword extraction",
    });
    const kw = extractTaskKeywords(item);
    expect(kw).toContain("enhance");
    expect(kw).toContain("next-task");
    expect(kw).toContain("selection");
    expect(kw).toContain("keyword");
    expect(kw).toContain("extraction");
  });

  it("deduplicates across all sources", () => {
    const item = makeItem({
      id: "t1",
      title: "Tree operations",
      description: "Tree traversal and search",
      tags: ["tree"],
    });
    const kw = extractTaskKeywords(item);
    const treeCount = kw.filter((k) => k === "tree").length;
    expect(treeCount).toBe(1);
  });

  it("returns empty for task with only stop words", () => {
    const item = makeItem({ id: "t1", title: "Do the it" });
    const kw = extractTaskKeywords(item);
    expect(kw).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// matchTasksByKeywords
// ---------------------------------------------------------------------------

describe("matchTasksByKeywords", () => {
  it("returns tasks matching given search keywords", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Implement tree traversal" }),
      makeItem({ id: "t2", title: "Fix database migration" }),
      makeItem({ id: "t3", title: "Optimize tree performance" }),
    ];
    const matches = matchTasksByKeywords(items, ["tree"]);
    const ids = matches.map((m) => m.item.id);
    expect(ids).toContain("t1");
    expect(ids).toContain("t3");
    expect(ids).not.toContain("t2");
  });

  it("ranks by match score (more keyword matches rank higher)", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "t1",
        title: "Tree traversal",
        acceptanceCriteria: ["Handles nested items"],
      }),
      makeItem({
        id: "t2",
        title: "Tree traversal performance",
        acceptanceCriteria: ["Optimizes tree operations", "Handles nested items"],
      }),
    ];
    const matches = matchTasksByKeywords(items, ["tree", "nested", "performance"]);
    // t2 should rank higher (more matches)
    expect(matches[0].item.id).toBe("t2");
  });

  it("returns empty when no tasks match", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Fix authentication bug" }),
    ];
    const matches = matchTasksByKeywords(items, ["tree", "traversal"]);
    expect(matches).toHaveLength(0);
  });

  it("matches against tags", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Some task", tags: ["performance", "tree-ops"] }),
      makeItem({ id: "t2", title: "Other task", tags: ["ui", "design"] }),
    ];
    const matches = matchTasksByKeywords(items, ["performance"]);
    expect(matches).toHaveLength(1);
    expect(matches[0].item.id).toBe("t1");
  });

  it("searches through nested children", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [
          makeItem({
            id: "f1",
            title: "Feature",
            level: "feature",
            children: [
              makeItem({ id: "t1", title: "Implement tree traversal" }),
            ],
          }),
        ],
      }),
    ];
    const matches = matchTasksByKeywords(items, ["tree"]);
    expect(matches).toHaveLength(1);
    expect(matches[0].item.id).toBe("t1");
  });

  it("respects minScore parameter", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Tree traversal" }),                      // 1 match for "tree"
      makeItem({ id: "t2", title: "Tree performance optimization tree" }),   // still 1 unique "tree" match
    ];
    const allMatches = matchTasksByKeywords(items, ["tree"], 1);
    expect(allMatches.length).toBeGreaterThan(0);
    const strictMatches = matchTasksByKeywords(items, ["tree", "performance"], 2);
    // Only t2 has both "tree" and "performance"
    expect(strictMatches).toHaveLength(1);
    expect(strictMatches[0].item.id).toBe("t2");
  });

  it("sorts by priority when match scores are equal", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Implement tree search", priority: "low" }),
      makeItem({ id: "t2", title: "Implement tree validation", priority: "critical" }),
    ];
    const matches = matchTasksByKeywords(items, ["tree"]);
    expect(matches[0].item.id).toBe("t2"); // critical first
  });
});
