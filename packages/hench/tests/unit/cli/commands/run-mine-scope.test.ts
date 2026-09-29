/**
 * `--mine` must narrow what a run *acts on*, not only what it shows.
 *
 * When the interactive menu came back empty under `--mine`, hench counted the
 * deferred and failing tasks across the whole PRD and offered to reset them.
 * Answering "y" to a prompt raised by an empty list of *your* tasks reset
 * everybody's — and committed it under your name. The count and the reset are
 * now both scoped to the resolved identity, using selection's own
 * `matchesAssignee` rule so "yours" means the same thing here as it does when
 * a task is selected.
 *
 * The second half is what the operator is told. An empty `--mine` result used
 * to print "No actionable tasks found in PRD", and `--loop` reported "All tasks
 * complete" — neither naming the identity `resolveActor` produced, which is the
 * single most likely thing to be wrong, and both describing the whole project
 * when they had only looked at one slice of it.
 *
 * @see packages/hench/src/cli/commands/run.ts
 */

import { describe, it, expect, vi } from "vitest";
import {
  countTasksByStatus,
  resetDeferredTasks,
  formatNoAssignedTasksLines,
} from "../../../../src/cli/commands/run.js";
import type { PRDItem } from "../../../../src/prd/rex-gateway.js";

const ALICE = "alice <alice@example.com>";
const BOB = "bob <bob@example.com>";

function item(overrides: Partial<PRDItem> & { id: string; title: string }): PRDItem {
  return { status: "pending", level: "task", ...overrides } as PRDItem;
}

/**
 *   epic-alice (assignee: alice)
 *     task-inherited   deferred — alice's by inheritance, carries no field
 *   epic-open
 *     task-own         failing  — alice's by its own field
 *     task-bob         deferred — bob's
 *     task-nobody      deferred — unassigned
 */
function tree(): PRDItem[] {
  return [
    item({
      id: "epic-alice",
      title: "Alice's Epic",
      level: "epic",
      assignee: ALICE,
      children: [item({ id: "task-inherited", title: "Inherited", status: "deferred" })],
    }),
    item({
      id: "epic-open",
      title: "Open Epic",
      level: "epic",
      children: [
        item({ id: "task-own", title: "Own", status: "failing", assignee: ALICE }),
        item({ id: "task-bob", title: "Bob's", status: "deferred", assignee: BOB }),
        item({ id: "task-nobody", title: "Nobody's", status: "deferred" }),
      ],
    }),
  ];
}

/** Records which ids were written, so "reset nothing extra" is checkable. */
function buildStore(items: PRDItem[] = tree()) {
  const updated: string[] = [];
  return {
    updated,
    store: {
      loadDocument: vi.fn(async () => ({ items })),
      updateItem: vi.fn(async (id: string) => {
        updated.push(id);
      }),
    },
  };
}

describe("countTasksByStatus scoped to --mine", () => {
  const DEFERRED_OR_FAILING = ["deferred", "failing"];

  it("counts every deferred/failing task when no identity is given", () => {
    expect(countTasksByStatus(tree(), DEFERRED_OR_FAILING)).toBe(4);
  });

  it("counts only the identity's tasks, own field or inherited", () => {
    // task-inherited (via epic-alice) + task-own. Not bob's, not the unassigned.
    expect(countTasksByStatus(tree(), DEFERRED_OR_FAILING, ALICE)).toBe(2);
  });

  it("counts only the other identity's tasks for that identity", () => {
    expect(countTasksByStatus(tree(), DEFERRED_OR_FAILING, BOB)).toBe(1);
  });

  it("counts nothing for an identity with no items", () => {
    expect(countTasksByStatus(tree(), DEFERRED_OR_FAILING, "nobody <n@example.com>")).toBe(0);
  });
});

describe("resetDeferredTasks scoped to --mine", () => {
  it("resets every deferred/failing task when no identity is given", async () => {
    const { store, updated } = buildStore();
    expect(await resetDeferredTasks(store as never)).toBe(4);
    expect(updated.sort()).toEqual(
      ["task-bob", "task-inherited", "task-nobody", "task-own"],
    );
  });

  it("resets only the identity's tasks, and writes to nothing else", async () => {
    const { store, updated } = buildStore();
    const count = await resetDeferredTasks(store as never, { assignee: ALICE });

    expect(count).toBe(2);
    expect(updated.sort()).toEqual(["task-inherited", "task-own"]);
    // The defect this test exists for: bob's and the unassigned task were reset
    // by an offer raised from an empty list of alice's tasks.
    expect(updated).not.toContain("task-bob");
    expect(updated).not.toContain("task-nobody");
  });

  it("reaches a task assigned only through its epic", async () => {
    const { store, updated } = buildStore();
    await resetDeferredTasks(store as never, { assignee: ALICE });
    expect(updated).toContain("task-inherited");
  });

  it("writes nothing for an identity that owns nothing", async () => {
    const { store, updated } = buildStore();
    expect(await resetDeferredTasks(store as never, { assignee: "ghost <g@example.com>" })).toBe(0);
    expect(updated).toEqual([]);
  });

  it("a scoped dry run counts the identity's tasks and writes nothing", async () => {
    const { store, updated } = buildStore();
    expect(await resetDeferredTasks(store as never, { assignee: ALICE, dryRun: true })).toBe(2);
    expect(updated).toEqual([]);
  });

  it("the count it reports is the count it resets", async () => {
    // The offer quotes countTasksByStatus and then calls this; if the two rules
    // ever diverge the operator is told one number and given another.
    const items = tree();
    const { store } = buildStore(items);
    expect(await resetDeferredTasks(store as never, { assignee: ALICE })).toBe(
      countTasksByStatus(items, ["deferred", "failing"], ALICE),
    );
  });
});

describe("formatNoAssignedTasksLines", () => {
  it("names the resolved identity", () => {
    const lines = formatNoAssignedTasksLines(ALICE, 7);
    expect(lines[0]).toContain(ALICE);
  });

  it("says how many actionable tasks exist without the filter", () => {
    const lines = formatNoAssignedTasksLines(ALICE, 7).join("\n");
    expect(lines).toContain("7 actionable task(s) exist without --mine");
  });

  it("distinguishes an empty PRD from an empty slice of a full one", () => {
    const none = formatNoAssignedTasksLines(ALICE, 0).join("\n");
    const some = formatNoAssignedTasksLines(ALICE, 3).join("\n");
    expect(none).toContain("No actionable tasks exist without --mine either");
    expect(some).toContain("3 actionable task(s) exist without --mine");
    expect(none).not.toEqual(some);
  });

  it("never claims the project is finished", () => {
    // The --loop path said "All tasks complete" when --mine matched nothing on
    // the very first iteration.
    for (const count of [0, 1, 42]) {
      const text = formatNoAssignedTasksLines(ALICE, count).join("\n");
      expect(text).not.toMatch(/all tasks.*complete/i);
    }
  });

  it("carries the epic scope into the first line when given", () => {
    expect(formatNoAssignedTasksLines(ALICE, 2, " in the specified epic")[0]).toContain(
      "in the specified epic",
    );
  });
});
