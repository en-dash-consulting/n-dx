import { describe, it, expect } from "vitest";
import { addTask, ChangeCompletionError, ClosedChangeError, completeChange, completeTask, completeWork } from "../../../src/core/change-completion.js";
import type { ApplyOn } from "../../../src/core/apply-policy.js";
import { isOpenChange, specHash, type RuleNode, type V2Tree } from "../../../src/schema/v2-rules.js";
import { ChangeIntentSchema, TaskIntentSchema } from "../../../src/schema/v2.js";

const NOW = new Date("2026-10-08T12:00:00.000Z");
const OLD = "A shopper can pay by card.";
const NEW = "A shopper can pay by card or wallet.";
const opts = (applyOn: ApplyOn = "complete") => ({ applyOn, appliedAt: NOW.toISOString(), now: NOW });

const node = (fields: Record<string, unknown>): RuleNode => ({ title: fields.id as string, slug: fields.id as string, ...fields }) as RuleNode;
const task = (id: string, extra: Record<string, unknown> = {}) => node({ id, type: "task", ...extra });
const change = (extra: Record<string, unknown> = {}) =>
  node({ id: "ch", type: "change", amends: [{ delta: "modified", target: "cap", proposed: NEW, summary: "Add wallets" }], ...extra });
const tree = (...changes: RuleNode[]): V2Tree => ({
  product: [node({ id: "area", type: "area", children: [node({ id: "cap", type: "capability", statement: OLD })] })],
  changes,
});
const statement = (t: V2Tree) => t.product[0].children?.[0].statement;
const theChange = (t: V2Tree) => t.changes.find((c) => c.id === "ch")!;

describe("completeTask", () => {
  it("completes the change and applies it when the last task completes under applyOn complete", () => {
    const input = tree(change({ children: [task("t1", { status: "completed" }), task("t2", { status: "in_progress" })] }));
    const result = completeTask(input, "t2", opts());
    expect(result.completed).toEqual(["t2", "ch"]);
    expect(result.apply?.applied).toBe(true);
    expect(theChange(result.tree)).toMatchObject({ status: "completed", appliedAt: NOW.toISOString() });
    expect(statement(result.tree)).toBe(NEW);
    expect(theChange(input).status).toBeUndefined();
  });

  it("completes but leaves the change open and unapplied under review and release", () => {
    for (const applyOn of ["review", "release"] as const) {
      const result = completeTask(tree(change({ children: [task("t")] })), "t", opts(applyOn));
      expect(result.completed).toEqual(["t", "ch"]);
      expect(result.apply?.applied).toBe(false);
      expect(theChange(result.tree).status).toBe("completed");
      expect(isOpenChange(theChange(result.tree))).toBe(true);
      expect(statement(result.tree)).toBe(OLD);
    }
  });

  it("applies nothing to the product layer for a touches-only change", () => {
    const result = completeTask(tree(change({ amends: undefined, touches: ["cap"], children: [task("t")] })), "t", opts());
    expect(result.apply).toMatchObject({ applied: true, result: { applied: [] } });
    expect(result.tree.product).toEqual(tree().product);
  });

  it("waits for every live task; a cancelled task blocks, a deleted one does not", () => {
    expect(completeTask(tree(change({ children: [task("t"), task("u")] })), "t", opts()).completed).toEqual(["t"]);
    expect(completeTask(tree(change({ children: [task("t"), task("u", { status: "cancelled" })] })), "t", opts()).completed).toEqual(["t"]);
    expect(completeTask(tree(change({ children: [task("t"), task("u", { status: "deleted" })] })), "t", opts()).completed).toEqual(["t", "ch"]);
  });

  it("never sweeps an in_progress change (#368)", () => {
    const result = completeTask(tree(change({ status: "in_progress", children: [task("t")] })), "t", opts());
    expect(result.completed).toEqual(["t"]);
    expect(result.apply).toBeNull();
    expect(theChange(result.tree).status).toBe("in_progress");
  });

  it("checks only the task's own change", () => {
    const other = node({ id: "other", type: "change", touches: ["cap"], children: [task("o", { status: "completed" })] });
    const result = completeTask(tree(change({ children: [task("t"), task("u")] }), other), "t", opts());
    expect(result.completed).toEqual(["t"]);
    expect(result.tree.changes[1].status).toBeUndefined();
  });

  it("holds a change that still needs placement", () => {
    const result = completeTask(tree(change({ needsPlacement: true, children: [task("t")] })), "t", opts());
    expect(result.completed).toEqual(["t"]);
    expect(result.held).toMatchObject({ changeId: "ch" });
    expect(theChange(result.tree).status).toBeUndefined();
  });

  it("reports a refused apply and keeps the change completed and unapplied", () => {
    const stale = change({ amends: [{ delta: "modified", target: "cap", base: "stale", proposed: NEW, summary: "Add wallets" }], children: [task("t")] });
    const result = completeTask(tree(stale), "t", opts());
    expect(result.apply).toMatchObject({ applied: false, error: { name: "ApplyAmendmentsError" } });
    expect(theChange(result.tree).status).toBe("completed");
    expect(theChange(result.tree).appliedAt).toBeUndefined();
  });

  it("refuses a ref that names no live task", () => {
    expect(() => completeTask(tree(change()), "ch", opts())).toThrow(ChangeCompletionError);
  });
});

describe("completeChange", () => {
  it("completes and applies a task-less change on its own, in_progress included", () => {
    const result = completeChange(tree(change({ status: "in_progress" })), "ch", opts());
    expect(result.completed).toEqual(["ch"]);
    expect(statement(result.tree)).toBe(NEW);
  });

  it("applies the same product layer, spec hash included, whether or not the change has acceptanceCriteria", () => {
    const plain = completeChange(tree(change()), "ch", opts());
    const withDoneWhen = completeChange(tree(change({ acceptanceCriteria: ["Wallets pay"] })), "ch", opts());
    expect(withDoneWhen.apply?.applied).toBe(true);
    expect(withDoneWhen.tree.product[0].children?.[0].metAt).toBe(specHash({ statement: NEW }));
    expect(withDoneWhen.tree.product).toEqual(plain.tree.product);
  });

  it("refuses while a live task is not completed", () => {
    expect(() => completeChange(tree(change({ children: [task("t", { status: "cancelled" })] })), "ch", opts())).toThrow(/task t is not completed/);
  });

  describe("a change a steward applied before it completed", () => {
    const APPLIED = "2026-10-01T00:00:00.000Z";
    // As apply leaves it: product layer already amended, the change stamped and still in flight.
    const applied = (extra: Record<string, unknown> = {}) =>
      tree(change({ status: "in_progress", appliedAt: APPLIED, children: [task("t", { status: "completed" })], ...extra }));

    it("closes with completedAt, without applying its amendments again", () => {
      const input = applied();
      const result = completeChange(input, "ch", opts());
      expect(result.completed).toEqual(["ch"]);
      expect(theChange(result.tree)).toMatchObject({ status: "completed", completedAt: NOW.toISOString(), appliedAt: APPLIED });
      expect(result.apply).toEqual({ applied: false, reason: `already applied at ${APPLIED}` });
      expect(result.tree.product).toEqual(input.product);
    });

    it("closes through completeWork, and with its last task when pending", () => {
      expect(theChange(completeWork(applied(), "ch", opts()).tree).status).toBe("completed");
      const pending = completeTask(applied({ status: undefined, children: [task("t")] }), "t", opts());
      expect(pending.completed).toEqual(["t", "ch"]);
      expect(theChange(pending.tree).appliedAt).toBe(APPLIED);
      expect(statement(pending.tree)).toBe(OLD);
    });

    it("still refuses while a live task is open, or once cancelled", () => {
      expect(() => completeChange(applied({ children: [task("t")] }), "ch", opts())).toThrow(/task t is not completed/);
      expect(() => completeChange(applied({ status: "cancelled" }), "ch", opts())).toThrow(/Cannot complete change ch: it is cancelled/);
    });
  });
});

describe("a change that holds a nested change", () => {
  const inner = (extra: Record<string, unknown> = {}) =>
    node({ id: "in", type: "change", touches: ["cap"], children: [task("t")], ...extra });
  const outer = (...children: RuleNode[]) => change({ children });

  it("refuses to complete the container while a nested change is open, and never applies it", () => {
    const input = tree(outer(inner()));
    expect(() => completeChange(input, "ch", opts())).toThrow(/Cannot complete change ch: change in is not completed/);
    expect(() => completeWork(input, "ch", opts())).toThrow(ChangeCompletionError);
    expect(theChange(input).status).toBeUndefined();
    expect(statement(input)).toBe(OLD);
  });

  it("completes and applies the container once its last nested change completes", () => {
    const result = completeWork(tree(outer(inner())), "t", opts());
    expect(result.completed).toEqual(["t", "in", "ch"]);
    expect(result.applies.map((a) => [a.changeId, a.apply.applied])).toEqual([["in", true], ["ch", true]]);
    expect(result.apply?.applied).toBe(true);
    expect(theChange(result.tree)).toMatchObject({ status: "completed", appliedAt: NOW.toISOString() });
    expect(statement(result.tree)).toBe(NEW);
  });

  it("waits for every live nested change and task; a deleted nested change does not count", () => {
    const sibling = node({ id: "in2", type: "change", touches: ["cap"] });
    expect(completeWork(tree(outer(inner(), sibling)), "t", opts()).completed).toEqual(["t", "in"]);
    expect(completeWork(tree(outer(inner(), task("u"))), "t", opts()).completed).toEqual(["t", "in"]);
    expect(completeWork(tree(outer(inner(), node({ ...sibling, status: "deleted" }))), "t", opts()).completed).toEqual(["t", "in", "ch"]);
  });

  it("completing a container's last task waits for its open nested change", () => {
    const result = completeTask(tree(outer(inner(), task("u"))), "u", opts());
    expect(result.completed).toEqual(["u"]);
    expect(statement(result.tree)).toBe(OLD);
  });

  it("does not sweep an in_progress or unplaced container", () => {
    expect(completeWork(tree(change({ status: "in_progress", children: [inner()] })), "t", opts()).completed).toEqual(["t", "in"]);
    const unplaced = completeWork(tree(change({ needsPlacement: true, children: [inner()] })), "t", opts());
    expect(unplaced.completed).toEqual(["t", "in"]);
    expect(theChange(unplaced.tree).status).toBeUndefined();
  });

  it("completes but does not apply the container while a completed nested change is unapplied", () => {
    const review = completeWork(tree(outer(inner())), "t", opts("review"));
    expect(review.completed).toEqual(["t", "in", "ch"]);
    expect(review.applies.every((a) => !a.apply.applied)).toBe(true);
    expect(statement(review.tree)).toBe(OLD);

    // Under complete, a nested change whose apply was refused keeps the container unapplied too.
    const done = completeWork(tree(outer(inner(), node({ id: "in2", type: "change", touches: ["cap"], status: "completed" }))), "t", opts());
    expect(done.completed).toEqual(["t", "in", "ch"]);
    expect(done.applies.find((a) => a.changeId === "ch")?.apply).toMatchObject({ applied: false, reason: /change in2 is not applied/ });
    expect(theChange(done.tree).appliedAt).toBeUndefined();
    expect(statement(done.tree)).toBe(OLD);
  });
});

describe("completeWork", () => {
  const STARTED = "2026-10-08T09:00:00.000Z";
  const subtask = (id: string, extra: Record<string, unknown> = {}) => node({ id, type: "subtask", ...extra });

  it("completes a task, its change and applies, stamping both as a v1 status update does", () => {
    const input = tree(change({ children: [task("t", { status: "in_progress", startedAt: STARTED, activeIntervals: [{ start: STARTED }] })] }));
    const result = completeWork(input, "t", { ...opts(), resolutionType: "code-change", resolutionDetail: "wired" });
    expect(result.completed).toEqual(["t", "ch"]);
    expect(result.changeId).toBe("ch");
    expect(result.apply?.applied).toBe(true);
    const done = theChange(result.tree);
    expect(done.children?.[0]).toMatchObject({
      status: "completed",
      completedAt: NOW.toISOString(),
      endedAt: NOW.toISOString(),
      startedAt: STARTED,
      activeIntervals: [{ start: STARTED, end: NOW.toISOString() }],
      resolutionType: "code-change",
      resolutionDetail: "wired",
    });
    expect(done).toMatchObject({ status: "completed", startedAt: NOW.toISOString(), endedAt: NOW.toISOString(), appliedAt: NOW.toISOString() });
    expect(done.resolutionType).toBeUndefined();
  });

  it("completes a change through completeChange", () => {
    const result = completeWork(tree(change({ status: "in_progress" })), "ch", opts());
    expect(result).toMatchObject({ completed: ["ch"], changeId: "ch", apply: { applied: true } });
  });

  it("completes a subtask, and its pending task with it when it was the last live subtask", () => {
    const open = tree(change({ children: [task("t", { children: [subtask("s1"), subtask("s2")] })] }));
    expect(completeWork(open, "s1", opts()).completed).toEqual(["s1"]);
    const last = tree(change({ children: [task("t", { children: [subtask("s1", { status: "completed" }), subtask("s2")] })] }));
    const result = completeWork(last, "s2", opts());
    expect(result.completed).toEqual(["s2", "t", "ch"]);
    expect(result.changeId).toBe("ch");
    expect(result.apply?.applied).toBe(true);
  });

  it("does not complete an in_progress task with its last subtask (#368)", () => {
    const input = tree(change({ children: [task("t", { status: "in_progress", children: [subtask("s")] })] }));
    expect(completeWork(input, "s", opts()).completed).toEqual(["s"]);
  });

  it("refuses a change that still needs placement, but completes its task and holds the change", () => {
    expect(() => completeWork(tree(change({ needsPlacement: true })), "ch", opts())).toThrow(/Cannot complete change ch: it still needs placement/);
    const result = completeWork(tree(change({ needsPlacement: true, children: [task("t")] })), "t", opts());
    expect(result.completed).toEqual(["t"]);
    expect(result.held?.changeId).toBe("ch");
  });

  it("refuses a product node or an unknown ref", () => {
    expect(() => completeWork(tree(change()), "cap", opts())).toThrow(ChangeCompletionError);
    expect(() => completeWork(tree(change()), "nope", opts())).toThrow(/No live task, change or subtask "nope"/);
  });
});

describe("addTask split rule", () => {
  const inFlight = (extra: Record<string, unknown> = {}) =>
    change({ status: "in_progress", startedAt: "2026-10-07T09:00:00.000Z", acceptanceCriteria: ["Wallets pay"], requirements: [{ id: "r" }], touches: ["cap"], ...extra });

  it("moves the criteria to the new first task, which takes over the in-flight work", () => {
    const result = addTask(tree(inFlight()), "ch", task("t", { acceptanceCriteria: ["Own"] }), NOW);
    expect(result.split).toEqual({ changeId: "ch", taskId: "t", movedCriteria: ["Wallets pay"] });
    const c = theChange(result.tree);
    expect(c.status).toBe("pending");
    expect(c).not.toHaveProperty("acceptanceCriteria");
    expect(c).toMatchObject({ requirements: [{ id: "r" }], touches: ["cap"], amends: [{ target: "cap" }] });
    expect(c.children?.[0]).toMatchObject({ status: "in_progress", startedAt: "2026-10-07T09:00:00.000Z", acceptanceCriteria: ["Own", "Wallets pay"] });
  });

  it("splits without criteria when the change has none", () => {
    const result = addTask(tree(inFlight({ acceptanceCriteria: undefined })), "ch", task("t"), NOW);
    expect(result.split?.movedCriteria).toEqual([]);
    expect(theChange(result.tree).children?.[0]).not.toHaveProperty("acceptanceCriteria");
  });

  it("moves a typed list: both nodes still parse against their intent schemas", () => {
    // The fixture's bare `{ id: "r" }` requirement is not a full Requirement; drop it to parse.
    const typed = inFlight({ requirements: undefined });
    expect(ChangeIntentSchema.parse(typed).acceptanceCriteria).toEqual(["Wallets pay"]);
    const result = addTask(tree(typed), "ch", task("t"), NOW);
    const c = theChange(result.tree);
    expect(ChangeIntentSchema.parse(c).acceptanceCriteria).toBeUndefined();
    expect(TaskIntentSchema.parse(c.children?.[0]).acceptanceCriteria).toEqual(["Wallets pay"]);
  });

  it("treats a change whose only tasks are deleted as task-less", () => {
    expect(addTask(tree(inFlight({ children: [task("gone", { status: "deleted" })] })), "ch", task("t"), NOW).split).not.toBeNull();
  });

  it("closes the change's open interval at the split and opens one on the task", () => {
    const closed = { start: "2026-10-06T09:00:00.000Z", end: "2026-10-06T10:00:00.000Z" };
    const open = { start: "2026-10-07T09:00:00.000Z" };
    const result = addTask(tree(inFlight({ activeIntervals: [closed, open] })), "ch", task("t"), NOW);
    const c = theChange(result.tree);
    expect(c.activeIntervals).toEqual([closed, { ...open, end: NOW.toISOString() }]);
    expect(c.activeIntervals?.some((iv) => iv.end === undefined)).toBe(false);
    expect(c.children?.[0].activeIntervals).toEqual([{ start: NOW.toISOString() }]);
  });

  it("opens no interval on the task when the change had none open", () => {
    const closed = { start: "2026-10-06T09:00:00.000Z", end: "2026-10-06T10:00:00.000Z" };
    for (const intervals of [undefined, [closed]]) {
      const result = addTask(tree(inFlight({ activeIntervals: intervals })), "ch", task("t"), NOW);
      expect(theChange(result.tree).activeIntervals).toEqual(intervals);
      expect(theChange(result.tree).children?.[0]).not.toHaveProperty("activeIntervals");
    }
  });

  it("refuses a task under a closed change, naming its state and suggesting a follow-up change", () => {
    const cases: [RuleNode[], string][] = [
      [[change({ status: "completed" })], "completed"],
      [[change({ status: "completed", appliedAt: NOW.toISOString() })], "applied"],
      [[change({ appliedAt: NOW.toISOString() })], "applied"],
      [[change({ status: "cancelled" })], "cancelled"],
      [[change({ status: "deleted" })], "deleted"],
      [[node({ id: "outer", type: "change", status: "deleted", children: [change()] })], "deleted"],
    ];
    for (const [changes, state] of cases) {
      let error: unknown;
      try {
        addTask(tree(...changes), "ch", task("t"), NOW);
      } catch (e) {
        error = e;
      }
      expect(error, state).toBeInstanceOf(ClosedChangeError);
      expect((error as ClosedChangeError).state).toBe(state);
      expect((error as Error).message).toContain(`it is ${state}`);
      expect((error as Error).message).toContain('discoveredFrom: { item: "ch" }');
    }
  });

  it("does not split a pending change or one that already has a task", () => {
    for (const c of [inFlight({ status: "pending" }), inFlight({ children: [task("u")] })]) {
      const result = addTask(tree(c), "ch", task("t"), NOW);
      expect(result.split).toBeNull();
      expect(theChange(result.tree).acceptanceCriteria).toEqual(["Wallets pay"]);
      expect(theChange(result.tree).children?.at(-1)).toMatchObject({ id: "t" });
      expect(theChange(result.tree).children?.at(-1)?.status).toBeUndefined();
    }
  });
});
