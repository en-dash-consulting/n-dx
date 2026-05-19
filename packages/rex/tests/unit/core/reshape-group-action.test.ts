/**
 * Unit tests for the `GroupAction` / `applyGroup` reshape operation.
 *
 * Verifies:
 *  - Container is created and items are moved under it
 *  - Renamed titles are applied
 *  - Hierarchy-mismatch fallback: container inserted at root, items still moved
 *  - Empty itemIds records an error and is not added to applied
 */

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { applyReshape } from "../../../src/core/reshape.js";
import type { GroupAction, ReshapeProposal } from "../../../src/core/reshape.js";
import type { PRDItem } from "../../../src/schema/index.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEpic(id: string, title: string, children?: PRDItem[]): PRDItem {
  return { id, title, level: "epic", status: "pending", children };
}

function makeFeature(id: string, title: string, children?: PRDItem[]): PRDItem {
  return { id, title, level: "feature", status: "pending", children };
}

function makeTask(id: string, title: string): PRDItem {
  return { id, title, level: "task", status: "pending" };
}

function groupProposal(action: Omit<GroupAction, "action">): ReshapeProposal {
  return {
    id: randomUUID(),
    action: { action: "group", ...action },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// Helper to find an item by ID anywhere in the tree
function findById(arr: PRDItem[], id: string): PRDItem | undefined {
  for (const item of arr) {
    if (item.id === id) return item;
    if (item.children) {
      const found = findById(item.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

describe("applyGroup — basic container creation", () => {
  it("creates a container and moves tasks under it (task → feature container)", () => {
    // Tasks are grouped under a new feature container.
    // LEVEL_HIERARCHY: task can live under "feature" or "epic".
    // Original parent is a feature; new container is also a feature.
    // → task can be child of feature ✓
    const task1 = makeTask("task-1", "Login (abc)");
    const task2 = makeTask("task-2", "Login (def)");
    const feature = makeFeature("feat-parent", "Auth Feature", [task1, task2]);
    const items: PRDItem[] = [makeEpic("epic-1", "Auth", [feature])];

    const containerId = randomUUID();
    const proposal = groupProposal({
      containerId,
      containerTitle: "Login",
      containerLevel: "feature", // tasks go under a feature container
      itemIds: ["task-1", "task-2"],
      reason: "hash-suffix-distinct-cases-container",
    });

    const result = applyReshape(items, [proposal]);

    expect(result.errors).toHaveLength(0);
    expect(result.applied).toHaveLength(1);

    const container = findById(items, containerId);
    expect(container).toBeDefined();
    expect(container!.title).toBe("Login");
    expect(container!.level).toBe("feature");

    // Both tasks should now be children of the container
    const containerChildren = container!.children ?? [];
    expect(containerChildren.map((c) => c.id)).toContain("task-1");
    expect(containerChildren.map((c) => c.id)).toContain("task-2");
  });

  it("applies per-item renamedTitles", () => {
    const task1 = makeTask("task-1", "Login (abc)");
    const task2 = makeTask("task-2", "Login (def)");
    const feature = makeFeature("feat-parent", "Auth Feature", [task1, task2]);
    const items: PRDItem[] = [makeEpic("epic-1", "Auth", [feature])];

    const containerId = randomUUID();
    const proposal = groupProposal({
      containerId,
      containerTitle: "Login",
      containerLevel: "feature",
      itemIds: ["task-1", "task-2"],
      renamedTitles: { "task-1": "Login — mobile", "task-2": "Login — web" },
      reason: "hash-suffix-distinct-cases-container",
    });

    const result = applyReshape(items, [proposal]);

    expect(result.errors).toHaveLength(0);

    const t1 = findById(items, "task-1");
    const t2 = findById(items, "task-2");
    expect(t1?.title).toBe("Login — mobile");
    expect(t2?.title).toBe("Login — web");
  });
});

describe("applyGroup — hierarchy fallback (container at root)", () => {
  it("pushes container to root when hierarchy prevents insertion under original parent", () => {
    // To force the fallback: place tasks directly under an epic (valid per LEVEL_HIERARCHY:
    // task can be under epic or feature). Then try to insert a "feature" container under
    // the epic, but request an "epic" container level — epic cannot be child of epic →
    // insertChild returns false → container goes to root.
    const task1 = makeTask("task-1", "Fix (abc)");
    const task2 = makeTask("task-2", "Fix (def)");
    const epic = makeEpic("epic-1", "Work", [task1, task2]);
    const items: PRDItem[] = [epic];

    const containerId = randomUUID();
    // containerLevel = "epic" cannot be inserted under epic-1 (epic-under-epic invalid)
    const proposal = groupProposal({
      containerId,
      containerTitle: "Fix",
      containerLevel: "epic",
      itemIds: ["task-1", "task-2"],
      reason: "hash-suffix-distinct-cases-container",
    });

    const result = applyReshape(items, [proposal]);

    // Should still be applied (container at root because hierarchy mismatch → root fallback)
    expect(result.applied).toHaveLength(1);

    // Container should be at root level
    const containerAtRoot = items.find((i) => i.id === containerId);
    expect(containerAtRoot).toBeDefined();
    expect(containerAtRoot!.level).toBe("epic");
  });
});

describe("applyGroup — error cases", () => {
  it("records an error when an itemId does not exist", () => {
    const task1 = makeTask("task-1", "Login (abc)");
    const feat = makeFeature("feat-parent", "Auth", [task1]);
    const items: PRDItem[] = [makeEpic("epic-1", "Root", [feat])];

    const containerId = randomUUID();
    const proposal = groupProposal({
      containerId,
      containerTitle: "Login",
      containerLevel: "feature",
      itemIds: ["task-1", "nonexistent-id"],
      reason: "hash-suffix-distinct-cases-container",
    });

    const result = applyReshape(items, [proposal]);

    expect(result.errors).toHaveLength(1);
    expect(result.applied).toHaveLength(0);
    expect(result.errors[0].error).toContain("nonexistent-id");
  });

  it("records an error for empty itemIds", () => {
    const items: PRDItem[] = [makeEpic("epic-1", "Auth")];

    const proposal = groupProposal({
      containerId: randomUUID(),
      containerTitle: "Empty group",
      containerLevel: "feature",
      itemIds: [],
      reason: "test",
    });

    const result = applyReshape(items, [proposal]);

    expect(result.errors).toHaveLength(1);
    expect(result.applied).toHaveLength(0);
  });
});
