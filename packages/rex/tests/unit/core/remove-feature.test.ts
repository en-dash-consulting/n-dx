import { describe, it, expect } from "vitest";
import {
  preCheckFeatureDeletion,
  removeFeature,
} from "../../../src/core/remove-feature.js";
import type { PRDItem } from "../../../src/schema/index.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeFeature(overrides?: Partial<PRDItem>): PRDItem {
  return {
    id: "f1",
    title: "Test Feature",
    level: "feature",
    status: "pending",
    ...overrides,
  };
}

function makeTree(): PRDItem[] {
  return [
    {
      id: "e1",
      title: "Epic One",
      level: "epic",
      status: "pending",
      children: [
        {
          id: "f-nested",
          title: "Nested Feature",
          level: "feature",
          status: "pending",
          children: [
            {
              id: "t-nested",
              title: "Nested Task",
              level: "task",
              status: "pending",
            },
          ],
        },
      ],
    },
    {
      id: "f1",
      title: "Root Feature",
      level: "feature",
      status: "pending",
      children: [
        {
          id: "t1",
          title: "Task One",
          level: "task",
          status: "pending",
        },
        {
          id: "t2",
          title: "Task Two",
          level: "task",
          status: "completed",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    },
  ];
}

// ── preCheckFeatureDeletion ─────────────────────────────────────────────────

describe("preCheckFeatureDeletion", () => {
  it("returns safe=true for a feature with no external deps or sync metadata", () => {
    const items = makeTree();
    const result = preCheckFeatureDeletion(items, "f1");

    expect(result.safe).toBe(true);
    expect(result.featureId).toBe("f1");
    expect(result.featureTitle).toBe("Root Feature");
    expect(result.subtreeCount).toBe(3); // f1, t1, t2
    expect(result.externalDependents).toHaveLength(0);
    expect(result.syncedItems).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("detects external dependents via blockedBy", () => {
    const items: PRDItem[] = [
      makeFeature({
        id: "f1",
        title: "Feature A",
        children: [
          { id: "t1", title: "Task A", level: "task", status: "pending" },
        ],
      }),
      {
        id: "e1",
        title: "Epic One",
        level: "epic",
        status: "pending",
        children: [
          {
            id: "t-other",
            title: "Other Task",
            level: "task",
            status: "blocked",
            blockedBy: ["t1"],
          },
        ],
      },
    ];

    const result = preCheckFeatureDeletion(items, "f1");

    expect(result.safe).toBe(false);
    expect(result.externalDependents).toHaveLength(1);
    expect(result.externalDependents[0].itemId).toBe("t-other");
    expect(result.externalDependents[0].blockedById).toBe("t1");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("external");
  });

  it("ignores blockedBy references within the same subtree", () => {
    const items: PRDItem[] = [
      makeFeature({
        id: "f1",
        title: "Feature A",
        children: [
          { id: "t1", title: "Task A", level: "task", status: "pending" },
          {
            id: "t2",
            title: "Task B",
            level: "task",
            status: "blocked",
            blockedBy: ["t1"], // internal reference
          },
        ],
      }),
    ];

    const result = preCheckFeatureDeletion(items, "f1");

    expect(result.safe).toBe(true);
    expect(result.externalDependents).toHaveLength(0);
  });

  it("detects synced items with remoteId", () => {
    const items: PRDItem[] = [
      makeFeature({
        id: "f1",
        title: "Feature A",
        remoteId: "notion-page-123",
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
        children: [
          {
            id: "t1",
            title: "Synced Task",
            level: "task",
            status: "pending",
            remoteId: "notion-page-456",
          },
        ],
      }),
    ];

    const result = preCheckFeatureDeletion(items, "f1");

    expect(result.safe).toBe(false);
    expect(result.syncedItems).toHaveLength(2);
    expect(result.syncedItems[0].remoteId).toBe("notion-page-123");
    expect(result.syncedItems[1].remoteId).toBe("notion-page-456");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("synced");
  });

  it("detects both external dependents and synced items", () => {
    const items: PRDItem[] = [
      makeFeature({
        id: "f1",
        title: "Feature A",
        remoteId: "remote-1",
        children: [
          { id: "t1", title: "Task A", level: "task", status: "pending" },
        ],
      }),
      {
        id: "t-other",
        title: "Other Task",
        level: "task",
        status: "blocked",
        blockedBy: ["t1"],
      },
    ];

    const result = preCheckFeatureDeletion(items, "f1");

    expect(result.safe).toBe(false);
    expect(result.externalDependents).toHaveLength(1);
    expect(result.syncedItems).toHaveLength(1);
    expect(result.warnings).toHaveLength(2);
  });

  it("returns not found when feature does not exist", () => {
    const items = makeTree();
    const result = preCheckFeatureDeletion(items, "nonexistent");

    expect(result.safe).toBe(false);
    expect(result.subtreeCount).toBe(0);
    expect(result.warnings[0]).toContain("not found");
  });

  it("returns error when item is not a feature", () => {
    const items = makeTree();
    const result = preCheckFeatureDeletion(items, "e1");

    expect(result.safe).toBe(false);
    expect(result.subtreeCount).toBe(0);
    expect(result.warnings[0]).toContain("epic");
    expect(result.warnings[0]).toContain("not a feature");
  });

  it("counts subtree correctly for feature with no children", () => {
    const items: PRDItem[] = [
      makeFeature({ id: "f1", title: "Bare Feature" }),
    ];

    const result = preCheckFeatureDeletion(items, "f1");

    expect(result.subtreeCount).toBe(1);
    expect(result.safe).toBe(true);
  });

  it("detects multiple external dependents across the tree", () => {
    const items: PRDItem[] = [
      makeFeature({
        id: "f1",
        title: "Feature A",
        children: [
          { id: "t1", title: "Task A", level: "task", status: "pending" },
          { id: "t2", title: "Task B", level: "task", status: "pending" },
        ],
      }),
      {
        id: "t-dep1",
        title: "Dependent 1",
        level: "task",
        status: "blocked",
        blockedBy: ["t1"],
      },
      {
        id: "t-dep2",
        title: "Dependent 2",
        level: "task",
        status: "blocked",
        blockedBy: ["t2"],
      },
      {
        id: "t-dep3",
        title: "Dependent 3",
        level: "task",
        status: "blocked",
        blockedBy: ["t1", "t2"],
      },
    ];

    const result = preCheckFeatureDeletion(items, "f1");

    expect(result.safe).toBe(false);
    // t-dep3 has two refs, both to subtree items
    expect(result.externalDependents).toHaveLength(4);
  });

  it("truncates warnings preview for many dependents", () => {
    const children: PRDItem[] = [
      { id: "t-target", title: "Target", level: "task", status: "pending" },
    ];
    const dependents: PRDItem[] = [];
    for (let i = 0; i < 5; i++) {
      dependents.push({
        id: `dep-${i}`,
        title: `Dependent ${i}`,
        level: "task",
        status: "blocked",
        blockedBy: ["t-target"],
      });
    }

    const items: PRDItem[] = [
      makeFeature({ id: "f1", title: "Feature", children }),
      ...dependents,
    ];

    const result = preCheckFeatureDeletion(items, "f1");

    expect(result.warnings[0]).toContain("+2 more");
  });
});

// ── removeFeature ───────────────────────────────────────────────────────────

describe("removeFeature", () => {
  it("removes a feature and its children", () => {
    const items = makeTree();
    const result = removeFeature(items, "f1");

    expect(result.ok).toBe(true);
    expect(result.deletedIds).toEqual(
      expect.arrayContaining(["f1", "t1", "t2"]),
    );
    expect(result.deletedIds).toHaveLength(3);
    expect(result.detail).toContain("3 item(s) deleted");

    // Feature should be gone from tree
    expect(items.find((i) => i.id === "f1")).toBeUndefined();
    // Epic and its nested feature should remain
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("e1");
  });

  it("cleans up blockedBy references to deleted items", () => {
    const items: PRDItem[] = [
      makeFeature({
        id: "f1",
        title: "Feature A",
        children: [
          { id: "t1", title: "Task A", level: "task", status: "pending" },
        ],
      }),
      {
        id: "t-other",
        title: "Other Task",
        level: "task",
        status: "blocked",
        blockedBy: ["t1", "some-other-id"],
      },
    ];

    const result = removeFeature(items, "f1");

    expect(result.ok).toBe(true);
    expect(result.cleanedRefs).toBe(1);

    // blockedBy should have t1 removed but keep some-other-id
    const other = items.find((i) => i.id === "t-other");
    expect(other?.blockedBy).toEqual(["some-other-id"]);
  });

  it("removes blockedBy array entirely when all refs are cleaned", () => {
    const items: PRDItem[] = [
      makeFeature({
        id: "f1",
        title: "Feature A",
        children: [
          { id: "t1", title: "Task A", level: "task", status: "pending" },
        ],
      }),
      {
        id: "t-other",
        title: "Other Task",
        level: "task",
        status: "blocked",
        blockedBy: ["t1"],
      },
    ];

    const result = removeFeature(items, "f1");

    expect(result.ok).toBe(true);
    expect(result.cleanedRefs).toBe(1);

    const other = items.find((i) => i.id === "t-other");
    expect(other?.blockedBy).toBeUndefined();
  });

  it("fails when feature does not exist", () => {
    const items = makeTree();
    const result = removeFeature(items, "nonexistent");

    expect(result.ok).toBe(false);
    expect(result.deletedIds).toHaveLength(0);
    expect(result.error).toContain("not found");
    expect(result.cleanedRefs).toBe(0);
  });

  it("fails when item is not a feature", () => {
    const items = makeTree();
    const result = removeFeature(items, "e1");

    expect(result.ok).toBe(false);
    expect(result.deletedIds).toHaveLength(0);
    expect(result.error).toContain("not a feature");
    expect(result.error).toContain("epic");
    expect(result.cleanedRefs).toBe(0);
  });

  it("removes feature with no children", () => {
    const items: PRDItem[] = [
      makeFeature({ id: "f1", title: "Bare Feature" }),
    ];

    const result = removeFeature(items, "f1");

    expect(result.ok).toBe(true);
    expect(result.deletedIds).toEqual(["f1"]);
    expect(items).toHaveLength(0);
  });

  it("does not mutate tree on failure", () => {
    const items = makeTree();
    const before = JSON.stringify(items);

    removeFeature(items, "nonexistent");

    expect(JSON.stringify(items)).toBe(before);
  });

  it("reports cleanedRefs=0 when no references to clean", () => {
    const items: PRDItem[] = [
      makeFeature({
        id: "f1",
        title: "Feature A",
        children: [
          { id: "t1", title: "Task A", level: "task", status: "pending" },
        ],
      }),
    ];

    const result = removeFeature(items, "f1");

    expect(result.ok).toBe(true);
    expect(result.cleanedRefs).toBe(0);
  });

  it("handles deeply nested subtrees", () => {
    const items: PRDItem[] = [
      makeFeature({
        id: "f1",
        title: "Deep Feature",
        children: [
          {
            id: "t1",
            title: "Task",
            level: "task",
            status: "pending",
            children: [
              {
                id: "st1",
                title: "Subtask",
                level: "subtask",
                status: "pending",
              },
            ],
          },
        ],
      }),
    ];

    const result = removeFeature(items, "f1");

    expect(result.ok).toBe(true);
    expect(result.deletedIds).toHaveLength(3);
    expect(result.deletedIds).toEqual(
      expect.arrayContaining(["f1", "t1", "st1"]),
    );
  });
});
