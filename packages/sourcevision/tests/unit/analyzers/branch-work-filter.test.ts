import { describe, it, expect } from "vitest";

import {
  classifyBranchPattern,
  isWithinBranchLifecycle,
  filterItemsByBranchScope,
} from "../../../src/analyzers/branch-work-filter.js";
import type {
  BranchWorkRecordItem,
} from "../../../src/schema/v1.js";
import type {
  BranchLifecycle,
} from "../../../src/analyzers/branch-work-filter.js";

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

function makeLifecycle(
  overrides: Partial<BranchLifecycle> = {},
): BranchLifecycle {
  return {
    branchName: overrides.branchName ?? "feature/add-auth",
    baseBranch: overrides.baseBranch ?? "main",
    // Use explicit undefined check — null is a valid value for createdAt
    // (?? treats null as nullish and would replace it with the default)
    createdAt: overrides.createdAt === undefined ? "2026-02-20T00:00:00.000Z" : overrides.createdAt,
    pattern: overrides.pattern ?? "feature",
  };
}

// ---------------------------------------------------------------------------
// classifyBranchPattern
// ---------------------------------------------------------------------------

describe("classifyBranchPattern", () => {
  // Feature branch patterns
  it("classifies 'feature/...' as feature", () => {
    expect(classifyBranchPattern("feature/add-auth")).toBe("feature");
  });

  it("classifies 'feat/...' as feature", () => {
    expect(classifyBranchPattern("feat/new-ui")).toBe("feature");
  });

  it("classifies 'feature-...' as feature", () => {
    expect(classifyBranchPattern("feature-add-auth")).toBe("feature");
  });

  // Hotfix branch patterns
  it("classifies 'hotfix/...' as hotfix", () => {
    expect(classifyBranchPattern("hotfix/fix-login")).toBe("hotfix");
  });

  it("classifies 'hotfix-...' as hotfix", () => {
    expect(classifyBranchPattern("hotfix-fix-login")).toBe("hotfix");
  });

  // Bugfix branch patterns
  it("classifies 'bugfix/...' as bugfix", () => {
    expect(classifyBranchPattern("bugfix/fix-crash")).toBe("bugfix");
  });

  it("classifies 'fix/...' as bugfix", () => {
    expect(classifyBranchPattern("fix/null-pointer")).toBe("bugfix");
  });

  // Release branch patterns
  it("classifies 'release/...' as release", () => {
    expect(classifyBranchPattern("release/v2.0")).toBe("release");
  });

  it("classifies 'release-...' as release", () => {
    expect(classifyBranchPattern("release-v2.0")).toBe("release");
  });

  // Main/master branches
  it("classifies 'main' as main", () => {
    expect(classifyBranchPattern("main")).toBe("main");
  });

  it("classifies 'master' as main", () => {
    expect(classifyBranchPattern("master")).toBe("main");
  });

  // Other patterns
  it("classifies unknown patterns as other", () => {
    expect(classifyBranchPattern("my-branch")).toBe("other");
  });

  it("classifies 'develop' as other", () => {
    expect(classifyBranchPattern("develop")).toBe("other");
  });

  it("is case-insensitive", () => {
    expect(classifyBranchPattern("Feature/Add-Auth")).toBe("feature");
    expect(classifyBranchPattern("HOTFIX/urgent")).toBe("hotfix");
  });

  it("handles empty string as other", () => {
    expect(classifyBranchPattern("")).toBe("other");
  });
});

// ---------------------------------------------------------------------------
// isWithinBranchLifecycle
// ---------------------------------------------------------------------------

describe("isWithinBranchLifecycle", () => {
  const branchCreatedAt = "2026-02-20T00:00:00.000Z";

  it("returns true for item completed after branch creation", () => {
    expect(
      isWithinBranchLifecycle("2026-02-21T10:00:00.000Z", branchCreatedAt),
    ).toBe(true);
  });

  it("returns true for item completed exactly at branch creation", () => {
    expect(
      isWithinBranchLifecycle("2026-02-20T00:00:00.000Z", branchCreatedAt),
    ).toBe(true);
  });

  it("returns false for item completed before branch creation", () => {
    expect(
      isWithinBranchLifecycle("2026-02-19T23:59:59.000Z", branchCreatedAt),
    ).toBe(false);
  });

  it("returns true when branchCreatedAt is null (no git info)", () => {
    expect(
      isWithinBranchLifecycle("2026-02-15T10:00:00.000Z", null),
    ).toBe(true);
  });

  it("returns false when completedAt is empty string", () => {
    expect(
      isWithinBranchLifecycle("", branchCreatedAt),
    ).toBe(false);
  });

  it("returns false for invalid completedAt timestamp", () => {
    expect(
      isWithinBranchLifecycle("not-a-date", branchCreatedAt),
    ).toBe(false);
  });

  it("handles invalid branchCreatedAt by including the item", () => {
    expect(
      isWithinBranchLifecycle("2026-02-21T10:00:00.000Z", "not-a-date"),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// filterItemsByBranchScope — basic filtering
// ---------------------------------------------------------------------------

describe("filterItemsByBranchScope", () => {
  it("includes items completed after branch creation", () => {
    const lifecycle = makeLifecycle({
      createdAt: "2026-02-20T00:00:00.000Z",
    });
    const items = [
      makeItem({
        id: "t1",
        completedAt: "2026-02-21T10:00:00.000Z",
      }),
    ];

    const result = filterItemsByBranchScope(items, lifecycle);

    expect(result.included).toHaveLength(1);
    expect(result.included[0].id).toBe("t1");
    expect(result.excluded).toHaveLength(0);
  });

  it("excludes items completed before branch creation", () => {
    const lifecycle = makeLifecycle({
      createdAt: "2026-02-20T00:00:00.000Z",
    });
    const items = [
      makeItem({
        id: "t1",
        completedAt: "2026-02-19T10:00:00.000Z",
      }),
    ];

    const result = filterItemsByBranchScope(items, lifecycle);

    expect(result.included).toHaveLength(0);
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0].id).toBe("t1");
    expect(result.excluded[0].reason).toBe("before_branch_creation");
  });

  it("returns all items when branch creation time is unknown", () => {
    const lifecycle = makeLifecycle({ createdAt: null });
    const items = [
      makeItem({ id: "t1", completedAt: "2026-01-01T00:00:00.000Z" }),
      makeItem({ id: "t2", completedAt: "2026-02-25T00:00:00.000Z" }),
    ];

    const result = filterItemsByBranchScope(items, lifecycle);

    expect(result.included).toHaveLength(2);
    expect(result.excluded).toHaveLength(0);
  });

  it("handles empty items array", () => {
    const lifecycle = makeLifecycle();
    const result = filterItemsByBranchScope([], lifecycle);

    expect(result.included).toHaveLength(0);
    expect(result.excluded).toHaveLength(0);
  });

  it("preserves item data through filtering", () => {
    const lifecycle = makeLifecycle({
      createdAt: "2026-02-20T00:00:00.000Z",
    });
    const item = makeItem({
      id: "t1",
      title: "Add auth flow",
      level: "task",
      completedAt: "2026-02-21T10:00:00.000Z",
      priority: "high",
      tags: ["auth", "security"],
      parentChain: [{ id: "e1", title: "Auth Epic", level: "epic" }],
    });

    const result = filterItemsByBranchScope([item], lifecycle);

    expect(result.included[0]).toEqual(item);
  });

  it("returns lifecycle in result", () => {
    const lifecycle = makeLifecycle();
    const result = filterItemsByBranchScope([], lifecycle);

    expect(result.lifecycle).toBe(lifecycle);
  });

  // ---------------------------------------------------------------------------
  // Main branch exclusion
  // ---------------------------------------------------------------------------

  it("excludes all items when branch pattern is main", () => {
    const lifecycle = makeLifecycle({
      branchName: "main",
      pattern: "main",
      createdAt: null,
    });
    const items = [
      makeItem({ id: "t1", completedAt: "2026-02-21T10:00:00.000Z" }),
    ];

    const result = filterItemsByBranchScope(items, lifecycle);

    expect(result.included).toHaveLength(0);
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0].reason).toBe("on_main_branch");
  });

  it("excludes all items when branch is master", () => {
    const lifecycle = makeLifecycle({
      branchName: "master",
      pattern: "main",
      createdAt: null,
    });
    const items = [
      makeItem({ id: "t1", completedAt: "2026-02-21T10:00:00.000Z" }),
    ];

    const result = filterItemsByBranchScope(items, lifecycle);

    expect(result.included).toHaveLength(0);
    expect(result.excluded[0].reason).toBe("on_main_branch");
  });

  // ---------------------------------------------------------------------------
  // Mixed scenarios
  // ---------------------------------------------------------------------------

  it("separates items into included and excluded correctly", () => {
    const lifecycle = makeLifecycle({
      createdAt: "2026-02-20T00:00:00.000Z",
    });
    const items = [
      makeItem({ id: "before-1", completedAt: "2026-02-18T10:00:00.000Z" }),
      makeItem({ id: "after-1", completedAt: "2026-02-21T10:00:00.000Z" }),
      makeItem({ id: "before-2", completedAt: "2026-02-19T23:00:00.000Z" }),
      makeItem({ id: "after-2", completedAt: "2026-02-22T10:00:00.000Z" }),
    ];

    const result = filterItemsByBranchScope(items, lifecycle);

    expect(result.included).toHaveLength(2);
    expect(result.included.map((i) => i.id)).toEqual(["after-1", "after-2"]);
    expect(result.excluded).toHaveLength(2);
    expect(result.excluded.map((i) => i.id)).toEqual(["before-1", "before-2"]);
  });

  // ---------------------------------------------------------------------------
  // Feature and hotfix branch patterns
  // ---------------------------------------------------------------------------

  it("includes all valid items for feature branches", () => {
    const lifecycle = makeLifecycle({
      branchName: "feature/add-auth",
      pattern: "feature",
      createdAt: "2026-02-20T00:00:00.000Z",
    });
    const items = [
      makeItem({ id: "t1", completedAt: "2026-02-21T10:00:00.000Z" }),
    ];

    const result = filterItemsByBranchScope(items, lifecycle);

    expect(result.included).toHaveLength(1);
  });

  it("includes all valid items for hotfix branches", () => {
    const lifecycle = makeLifecycle({
      branchName: "hotfix/fix-login",
      pattern: "hotfix",
      createdAt: "2026-02-20T00:00:00.000Z",
    });
    const items = [
      makeItem({ id: "t1", completedAt: "2026-02-21T10:00:00.000Z" }),
    ];

    const result = filterItemsByBranchScope(items, lifecycle);

    expect(result.included).toHaveLength(1);
  });

  it("includes all valid items for bugfix branches", () => {
    const lifecycle = makeLifecycle({
      branchName: "bugfix/fix-crash",
      pattern: "bugfix",
      createdAt: "2026-02-20T00:00:00.000Z",
    });
    const items = [
      makeItem({ id: "t1", completedAt: "2026-02-21T10:00:00.000Z" }),
    ];

    const result = filterItemsByBranchScope(items, lifecycle);

    expect(result.included).toHaveLength(1);
  });

  it("includes all valid items for release branches", () => {
    const lifecycle = makeLifecycle({
      branchName: "release/v2.0",
      pattern: "release",
      createdAt: "2026-02-20T00:00:00.000Z",
    });
    const items = [
      makeItem({ id: "t1", completedAt: "2026-02-21T10:00:00.000Z" }),
    ];

    const result = filterItemsByBranchScope(items, lifecycle);

    expect(result.included).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  it("does not mutate input items", () => {
    const lifecycle = makeLifecycle({
      createdAt: "2026-02-20T00:00:00.000Z",
    });
    const original = makeItem({
      id: "t1",
      completedAt: "2026-02-21T10:00:00.000Z",
    });
    const items = [original];

    filterItemsByBranchScope(items, lifecycle);

    // Original array and object unchanged
    expect(items).toHaveLength(1);
    expect(items[0]).toBe(original);
  });

  it("handles items at the exact branch creation boundary", () => {
    const lifecycle = makeLifecycle({
      createdAt: "2026-02-20T12:00:00.000Z",
    });
    const items = [
      makeItem({
        id: "exact",
        completedAt: "2026-02-20T12:00:00.000Z",
      }),
      makeItem({
        id: "one-ms-before",
        completedAt: "2026-02-20T11:59:59.999Z",
      }),
      makeItem({
        id: "one-ms-after",
        completedAt: "2026-02-20T12:00:00.001Z",
      }),
    ];

    const result = filterItemsByBranchScope(items, lifecycle);

    expect(result.included.map((i) => i.id)).toEqual(["exact", "one-ms-after"]);
    expect(result.excluded.map((i) => i.id)).toEqual(["one-ms-before"]);
  });

  it("handles items with invalid completedAt timestamps", () => {
    const lifecycle = makeLifecycle({
      createdAt: "2026-02-20T00:00:00.000Z",
    });
    const items = [
      makeItem({ id: "bad-date", completedAt: "not-a-date" }),
    ];

    const result = filterItemsByBranchScope(items, lifecycle);

    expect(result.included).toHaveLength(0);
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0].reason).toBe("invalid_timestamp");
  });
});
