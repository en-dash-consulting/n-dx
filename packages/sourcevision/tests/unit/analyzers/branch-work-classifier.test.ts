import { describe, it, expect } from "vitest";

import {
  classifyItems,
  classifyItem,
  isBreakingChange,
  inferSignificance,
} from "../../../src/analyzers/branch-work-classifier.js";
import type {
  BranchWorkRecordItem,
  BranchWorkEpicSummary,
} from "../../../src/schema/v1.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(
  overrides: Partial<BranchWorkRecordItem> = {},
): BranchWorkRecordItem {
  return {
    id: overrides.id ?? "task-1",
    title: overrides.title ?? "Test task",
    level: overrides.level ?? "task",
    completedAt: overrides.completedAt ?? "2026-02-24T10:00:00.000Z",
    parentChain: overrides.parentChain ?? [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isBreakingChange — tag-based detection
// ---------------------------------------------------------------------------

describe("isBreakingChange", () => {
  it("detects 'breaking' tag", () => {
    const item = makeItem({ tags: ["breaking"] });
    expect(isBreakingChange(item)).toBe(true);
  });

  it("detects 'breaking-change' tag", () => {
    const item = makeItem({ tags: ["breaking-change"] });
    expect(isBreakingChange(item)).toBe(true);
  });

  it("detects 'breaking_change' tag", () => {
    const item = makeItem({ tags: ["breaking_change"] });
    expect(isBreakingChange(item)).toBe(true);
  });

  it("detects case-insensitive tag match", () => {
    const item = makeItem({ tags: ["BREAKING"] });
    expect(isBreakingChange(item)).toBe(true);
  });

  it("detects 'breaking change' in title", () => {
    const item = makeItem({ title: "This is a breaking change" });
    expect(isBreakingChange(item)).toBe(true);
  });

  it("detects 'breaking change' in description", () => {
    const item = makeItem({
      description: "Introduces a breaking change to the API",
    });
    expect(isBreakingChange(item)).toBe(true);
  });

  it("detects 'remove API' pattern in title", () => {
    const item = makeItem({ title: "Remove legacy API endpoints" });
    expect(isBreakingChange(item)).toBe(true);
  });

  it("detects 'removes endpoint' pattern in description", () => {
    const item = makeItem({
      description: "This removes endpoint /api/v1/users",
    });
    expect(isBreakingChange(item)).toBe(true);
  });

  it("detects 'deprecate' in title", () => {
    const item = makeItem({ title: "Deprecate v1 authentication flow" });
    expect(isBreakingChange(item)).toBe(true);
  });

  it("detects 'deprecated' in description", () => {
    const item = makeItem({
      description: "The old handler is now deprecated",
    });
    expect(isBreakingChange(item)).toBe(true);
  });

  it("detects 'backward incompatible' in description", () => {
    const item = makeItem({
      description: "This is a backward incompatible change",
    });
    expect(isBreakingChange(item)).toBe(true);
  });

  it("detects 'backwards incompatible' in description", () => {
    const item = makeItem({
      description: "Backwards incompatible refactor of the schema",
    });
    expect(isBreakingChange(item)).toBe(true);
  });

  it("detects 'migration required' in acceptance criteria", () => {
    const item = makeItem({
      acceptanceCriteria: ["Migration guide provided for consumers"],
    });
    expect(isBreakingChange(item)).toBe(true);
  });

  it("detects 'breaking' keyword in acceptance criteria", () => {
    const item = makeItem({
      acceptanceCriteria: ["No breaking changes to public API"],
    });
    // "breaking" keyword match — this is about breaking changes even if negated
    // The classifier is intentionally simple: keyword presence = flagged
    expect(isBreakingChange(item)).toBe(true);
  });

  it("returns false for normal items with no breaking signals", () => {
    const item = makeItem({
      title: "Add login form",
      description: "Implement the login form component",
      tags: ["ui", "auth"],
    });
    expect(isBreakingChange(item)).toBe(false);
  });

  it("returns false for items with no metadata", () => {
    const item = makeItem();
    expect(isBreakingChange(item)).toBe(false);
  });

  it("returns false for items with empty tags", () => {
    const item = makeItem({ tags: [] });
    expect(isBreakingChange(item)).toBe(false);
  });

  it("detects 'remove support' pattern in title", () => {
    const item = makeItem({ title: "Remove support for Node 14" });
    expect(isBreakingChange(item)).toBe(true);
  });

  it("detects 'remove feature' pattern in title", () => {
    const item = makeItem({ title: "Remove feature flag system" });
    expect(isBreakingChange(item)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// inferSignificance — level, priority, scope-based classification
// ---------------------------------------------------------------------------

describe("inferSignificance", () => {
  it("classifies epic-level items as major", () => {
    const item = makeItem({ level: "epic" });
    expect(inferSignificance(item, [])).toBe("major");
  });

  it("classifies feature-level items as minor", () => {
    const item = makeItem({ level: "feature" });
    expect(inferSignificance(item, [])).toBe("minor");
  });

  it("classifies task-level items as patch by default", () => {
    const item = makeItem({ level: "task" });
    expect(inferSignificance(item, [])).toBe("patch");
  });

  it("classifies subtask-level items as patch by default", () => {
    const item = makeItem({ level: "subtask" });
    expect(inferSignificance(item, [])).toBe("patch");
  });

  it("elevates critical priority tasks to major", () => {
    const item = makeItem({ level: "task", priority: "critical" });
    expect(inferSignificance(item, [])).toBe("major");
  });

  it("elevates high priority tasks to minor", () => {
    const item = makeItem({ level: "task", priority: "high" });
    expect(inferSignificance(item, [])).toBe("minor");
  });

  it("keeps medium priority tasks at patch", () => {
    const item = makeItem({ level: "task", priority: "medium" });
    expect(inferSignificance(item, [])).toBe("patch");
  });

  it("elevates tasks with API-related acceptance criteria to minor", () => {
    const item = makeItem({
      level: "task",
      acceptanceCriteria: ["New public API endpoint for user creation"],
    });
    expect(inferSignificance(item, [])).toBe("minor");
  });

  it("elevates tasks with schema-related acceptance criteria to minor", () => {
    const item = makeItem({
      level: "task",
      acceptanceCriteria: ["Database schema updated with new columns"],
    });
    expect(inferSignificance(item, [])).toBe("minor");
  });

  it("elevates tasks with interface-related acceptance criteria to minor", () => {
    const item = makeItem({
      level: "task",
      acceptanceCriteria: ["Public interface exported from package"],
    });
    expect(inferSignificance(item, [])).toBe("minor");
  });

  it("elevates tasks with contract-related acceptance criteria to minor", () => {
    const item = makeItem({
      level: "task",
      acceptanceCriteria: ["API contract documented in OpenAPI spec"],
    });
    expect(inferSignificance(item, [])).toBe("minor");
  });

  it("elevates tasks under large epics to minor", () => {
    const item = makeItem({
      level: "task",
      parentChain: [{ id: "epic-1", title: "Big Epic", level: "epic" }],
    });
    const epicSummaries: BranchWorkEpicSummary[] = [
      { id: "epic-1", title: "Big Epic", completedCount: 8 },
    ];
    expect(inferSignificance(item, epicSummaries)).toBe("minor");
  });

  it("does not elevate tasks under small epics", () => {
    const item = makeItem({
      level: "task",
      parentChain: [{ id: "epic-1", title: "Small Epic", level: "epic" }],
    });
    const epicSummaries: BranchWorkEpicSummary[] = [
      { id: "epic-1", title: "Small Epic", completedCount: 2 },
    ];
    expect(inferSignificance(item, epicSummaries)).toBe("patch");
  });

  it("takes highest applicable significance when multiple signals match", () => {
    // High priority + API acceptance criteria → both signal minor, should be minor
    const item = makeItem({
      level: "task",
      priority: "high",
      acceptanceCriteria: ["New API endpoint created"],
    });
    expect(inferSignificance(item, [])).toBe("minor");
  });

  it("critical priority overrides feature-level minor to major", () => {
    // Feature is normally minor, but critical priority → major
    const item = makeItem({ level: "feature", priority: "critical" });
    expect(inferSignificance(item, [])).toBe("major");
  });
});

// ---------------------------------------------------------------------------
// classifyItem — combined classification
// ---------------------------------------------------------------------------

describe("classifyItem", () => {
  it("sets both breakingChange and changeSignificance", () => {
    const item = makeItem({
      title: "Remove legacy API",
      tags: ["breaking"],
    });

    const classified = classifyItem(item, []);
    expect(classified.breakingChange).toBe(true);
    expect(classified.changeSignificance).toBe("major");
  });

  it("breaking items are always at least major significance", () => {
    const item = makeItem({
      level: "subtask",
      description: "This is a breaking change to the interface",
    });

    const classified = classifyItem(item, []);
    expect(classified.breakingChange).toBe(true);
    expect(classified.changeSignificance).toBe("major");
  });

  it("non-breaking items preserve inferred significance", () => {
    const item = makeItem({
      level: "task",
      title: "Add unit tests",
    });

    const classified = classifyItem(item, []);
    expect(classified.breakingChange).toBe(false);
    expect(classified.changeSignificance).toBe("patch");
  });

  it("preserves all original item fields", () => {
    const item = makeItem({
      id: "task-42",
      title: "Specific task",
      level: "task",
      priority: "high",
      tags: ["backend"],
      description: "Do the thing",
      acceptanceCriteria: ["It works"],
      parentChain: [
        { id: "epic-1", title: "My Epic", level: "epic" },
      ],
    });

    const classified = classifyItem(item, []);
    expect(classified.id).toBe("task-42");
    expect(classified.title).toBe("Specific task");
    expect(classified.priority).toBe("high");
    expect(classified.tags).toEqual(["backend"]);
    expect(classified.description).toBe("Do the thing");
    expect(classified.acceptanceCriteria).toEqual(["It works"]);
    expect(classified.parentChain).toEqual([
      { id: "epic-1", title: "My Epic", level: "epic" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// classifyItems — batch classification
// ---------------------------------------------------------------------------

describe("classifyItems", () => {
  it("classifies all items in the array", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({ id: "t1", title: "Add login", level: "task" }),
      makeItem({ id: "t2", title: "Remove API", tags: ["breaking"] }),
      makeItem({ id: "t3", level: "epic", title: "Auth System" }),
    ];

    const classified = classifyItems(items, []);
    expect(classified).toHaveLength(3);
    expect(classified[0].changeSignificance).toBe("patch");
    expect(classified[0].breakingChange).toBe(false);
    expect(classified[1].breakingChange).toBe(true);
    expect(classified[1].changeSignificance).toBe("major");
    expect(classified[2].changeSignificance).toBe("major");
  });

  it("returns empty array for empty input", () => {
    const classified = classifyItems([], []);
    expect(classified).toEqual([]);
  });

  it("passes epic summaries to significance inference", () => {
    const items: BranchWorkRecordItem[] = [
      makeItem({
        id: "t1",
        level: "task",
        title: "One of many tasks",
        parentChain: [{ id: "epic-1", title: "Big Epic", level: "epic" }],
      }),
    ];
    const epicSummaries: BranchWorkEpicSummary[] = [
      { id: "epic-1", title: "Big Epic", completedCount: 10 },
    ];

    const classified = classifyItems(items, epicSummaries);
    expect(classified[0].changeSignificance).toBe("minor");
  });

  it("does not mutate original items", () => {
    const original = makeItem({ id: "t1", title: "Test" });
    const items = [original];

    classifyItems(items, []);
    expect(original.changeSignificance).toBeUndefined();
    expect(original.breakingChange).toBeUndefined();
  });
});
