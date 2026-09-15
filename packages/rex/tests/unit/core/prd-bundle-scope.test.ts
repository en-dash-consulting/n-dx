/**
 * Unit tests for scoped bundle selection.
 *
 * Scoping is a closure, not a filter, and the closure is the whole risk: a
 * selection that keeps a `blockedBy` edge but omits its target imports into a
 * tree with a dangling dependency, and one that drops the edge loses
 * sequencing information. So the assertions here are about what gets dragged
 * in — transitively, across epics — and about the two invariants that make the
 * fragment importable: every edge resolves inside the bundle, and every
 * included item still has the ancestor chain that places it.
 */

import { describe, it, expect } from "vitest";
import { scopeItems, countItems, BundleError } from "../../../src/core/prd-bundle.js";
import type { PRDItem } from "../../../src/schema/index.js";

const EPIC_A = "aaaaaaaa-0000-4000-8000-000000000001";
const FEATURE_A1 = "aaaaaaaa-0000-4000-8000-000000000002";
const TASK_A1A = "aaaaaaaa-0000-4000-8000-000000000003";
const TASK_A1B = "aaaaaaaa-0000-4000-8000-000000000004";
const SUBTASK_A1B_I = "aaaaaaaa-0000-4000-8000-000000000005";
const FEATURE_A2 = "aaaaaaaa-0000-4000-8000-000000000006";
const TASK_A2A = "aaaaaaaa-0000-4000-8000-000000000007";

const EPIC_B = "bbbbbbbb-0000-4000-8000-000000000001";
const FEATURE_B1 = "bbbbbbbb-0000-4000-8000-000000000002";
const TASK_B1A = "bbbbbbbb-0000-4000-8000-000000000003";
const FEATURE_B2 = "bbbbbbbb-0000-4000-8000-000000000004";

const EPIC_C = "cccccccc-0000-4000-8000-000000000001";
const FEATURE_C1 = "cccccccc-0000-4000-8000-000000000002";
const TASK_C1A = "cccccccc-0000-4000-8000-000000000003";

function item(overrides: Partial<PRDItem> & { id: string; title: string }): PRDItem {
  return { status: "pending", level: "task", ...overrides };
}

/**
 * Three epics wired so the closure has to leave the requested subtree twice.
 *
 * A1a is blocked by a task in epic B, which is itself blocked by a task in
 * epic C. Neither blocker is reachable by walking down from A1, and neither
 * epic shares an ancestor with it below the root — which is the case a filter
 * gets wrong and a closure gets right.
 */
function tree(): PRDItem[] {
  return [
    item({
      id: EPIC_A,
      title: "Epic A",
      level: "epic",
      children: [
        item({
          id: FEATURE_A1,
          title: "Feature A1",
          level: "feature",
          children: [
            item({ id: TASK_A1A, title: "Task A1a", blockedBy: [TASK_B1A] }),
            item({
              id: TASK_A1B,
              title: "Task A1b",
              children: [item({ id: SUBTASK_A1B_I, title: "Subtask A1b-i", level: "subtask" })],
            }),
          ],
        }),
        item({
          id: FEATURE_A2,
          title: "Feature A2",
          level: "feature",
          children: [item({ id: TASK_A2A, title: "Task A2a" })],
        }),
      ],
    }),
    item({
      id: EPIC_B,
      title: "Epic B",
      level: "epic",
      children: [
        item({
          id: FEATURE_B1,
          title: "Feature B1",
          level: "feature",
          children: [item({ id: TASK_B1A, title: "Task B1a", blockedBy: [TASK_C1A] })],
        }),
        item({ id: FEATURE_B2, title: "Feature B2", level: "feature" }),
      ],
    }),
    item({
      id: EPIC_C,
      title: "Epic C",
      level: "epic",
      children: [
        item({
          id: FEATURE_C1,
          title: "Feature C1",
          level: "feature",
          children: [item({ id: TASK_C1A, title: "Task C1a" })],
        }),
      ],
    }),
  ];
}

/** Every id in a tree, so membership can be asserted without caring about shape. */
function ids(items: PRDItem[]): Set<string> {
  const out = new Set<string>();
  for (const entry of items) {
    out.add(entry.id);
    if (entry.children) for (const id of ids(entry.children)) out.add(id);
  }
  return out;
}

/** Map id -> parent id, so placement depth can be asserted. */
function parents(items: PRDItem[], parentId: string | null = null): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const entry of items) {
    out.set(entry.id, parentId);
    if (entry.children) for (const [id, parent] of parents(entry.children, entry.id)) out.set(id, parent);
  }
  return out;
}

/** Every `blockedBy` edge in a tree, as `[source, target]` pairs. */
function edges(items: PRDItem[]): [string, string][] {
  const out: [string, string][] = [];
  for (const entry of items) {
    for (const target of entry.blockedBy ?? []) out.push([entry.id, target]);
    if (entry.children) out.push(...edges(entry.children));
  }
  return out;
}

describe("scopeItems", () => {
  it("pulls the requested item and every descendant beneath it", () => {
    const scoped = scopeItems(tree(), FEATURE_A1);

    for (const id of [FEATURE_A1, TASK_A1A, TASK_A1B, SUBTASK_A1B_I]) {
      expect(scoped.reasons.get(id)).toBe("requested");
    }
    expect(scoped.counts.requested).toBe(4);
  });

  it("walks the transitive blockedBy closure across epics", () => {
    const scoped = scopeItems(tree(), FEATURE_A1);

    // B1a is a direct blocker; C1a is only reachable through it.
    expect(scoped.reasons.get(TASK_B1A)).toBe("dependency");
    expect(scoped.reasons.get(TASK_C1A)).toBe("dependency");
    expect(scoped.counts.dependency).toBe(2);
  });

  it("includes the ancestor containers of everything it selected", () => {
    const scoped = scopeItems(tree(), FEATURE_A1);

    expect(scoped.reasons.get(EPIC_A)).toBe("ancestor");
    expect(scoped.reasons.get(FEATURE_B1)).toBe("ancestor");
    expect(scoped.reasons.get(EPIC_B)).toBe("ancestor");
    expect(scoped.reasons.get(FEATURE_C1)).toBe("ancestor");
    expect(scoped.reasons.get(EPIC_C)).toBe("ancestor");
    expect(scoped.counts.ancestor).toBe(5);
  });

  it("leaves out siblings the closure never needed", () => {
    const present = ids(scopeItems(tree(), FEATURE_A1).items);

    expect(present.has(FEATURE_A2)).toBe(false);
    expect(present.has(TASK_A2A)).toBe(false);
    expect(present.has(FEATURE_B2)).toBe(false);
    expect(present.size).toBe(11);
    expect(countItems(scopeItems(tree(), FEATURE_A1).items)).toBe(11);
  });

  it("keeps every item at its original depth", () => {
    const placement = parents(scopeItems(tree(), FEATURE_A1).items);

    expect(placement.get(EPIC_A)).toBeNull();
    expect(placement.get(FEATURE_A1)).toBe(EPIC_A);
    expect(placement.get(SUBTASK_A1B_I)).toBe(TASK_A1B);
    // The pulled blocker keeps its own chain rather than being re-parented.
    expect(placement.get(TASK_B1A)).toBe(FEATURE_B1);
    expect(placement.get(FEATURE_B1)).toBe(EPIC_B);
    expect(placement.get(EPIC_B)).toBeNull();
  });

  it("leaves no blockedBy edge pointing outside the selection", () => {
    const scoped = scopeItems(tree(), FEATURE_A1);
    const present = ids(scoped.items);

    const all = edges(scoped.items);
    expect(all).toHaveLength(2);
    for (const [, target] of all) expect(present.has(target)).toBe(true);
    expect(scoped.droppedEdges).toEqual([]);
  });

  it("does not mutate the document it scoped", () => {
    const source = tree();
    const before = JSON.stringify(source);
    scopeItems(source, FEATURE_A1);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("scopes to a whole epic, which is just its own subtree plus what it needs", () => {
    const scoped = scopeItems(tree(), EPIC_A);

    expect(scoped.counts.requested).toBe(7);
    // Epic A has no parent; the four containers place the two pulled blockers.
    expect(scoped.counts.ancestor).toBe(4);
    expect(scoped.counts.dependency).toBe(2);
    expect(ids(scoped.items).has(FEATURE_B2)).toBe(false);
  });

  it("scopes to a leaf task without dragging its siblings along", () => {
    const scoped = scopeItems(tree(), TASK_A1B);

    expect(ids(scoped.items)).toEqual(
      new Set([EPIC_A, FEATURE_A1, TASK_A1B, SUBTASK_A1B_I]),
    );
    expect(scoped.counts.dependency).toBe(0);
  });

  it("drops a blockedBy edge whose target does not exist, and says which", () => {
    const source = tree();
    const missing = "00000000-0000-4000-8000-00000000dead";
    source[0].children![0].children![1].blockedBy = [missing];

    const scoped = scopeItems(source, FEATURE_A1);

    expect(scoped.droppedEdges).toEqual([
      { id: TASK_A1B, title: "Task A1b", blockedBy: missing },
    ]);
    // The edge is gone rather than left dangling, and the field with it.
    const kept = scoped.items[0].children![0].children!.find((c) => c.id === TASK_A1B);
    expect(kept?.blockedBy).toBeUndefined();
  });

  it("keeps the resolvable half of a mixed blockedBy list", () => {
    const source = tree();
    const missing = "00000000-0000-4000-8000-00000000dead";
    source[0].children![0].children![0].blockedBy = [TASK_B1A, missing];

    const scoped = scopeItems(source, FEATURE_A1);

    const kept = scoped.items[0].children![0].children!.find((c) => c.id === TASK_A1A);
    expect(kept?.blockedBy).toEqual([TASK_B1A]);
    expect(scoped.droppedEdges.map((edge) => edge.blockedBy)).toEqual([missing]);
  });

  it("refuses an id that is not in the document", () => {
    expect(() => scopeItems(tree(), "00000000-0000-4000-8000-000000000000")).toThrow(BundleError);
  });
});
