import { describe, it, expect } from "vitest";
import type { V2Tree } from "@n-dx/rex";
import { planQueue, COLD_ONLY_TAGS } from "../../../src/queue/plan-queue.js";
import type { QueuePlan } from "../../../src/queue/plan-queue.js";
import { laneCommand, queueInputFromTree } from "../../../src/cli/commands/plan-queue.js";

type Node = V2Tree["changes"][number];

let seq = 0;
function task(title: string, extra: Partial<Node> = {}): Node {
  return { id: `t-${title}`, type: "task", title, slug: `t-${++seq}`, status: "pending", ...extra } as Node;
}
function change(id: string, children: Node[], extra: Partial<Node> = {}): Node {
  return { id, type: "change", title: `Change ${id}`, slug: id, status: "pending", children, ...extra } as Node;
}

/** The plan for `changes`, as the CLI builds it, with `activeRuns` of `runLimit` in use. */
function plan(changes: Node[], opts: { activeRuns?: number; runLimit?: number; defaultTier?: string } = {}): QueuePlan {
  const input = queueInputFromTree({ product: [], changes }, { defaultTier: opts.defaultTier ?? "standard" });
  return planQueue({
    ...input,
    activeRuns: opts.activeRuns ?? 0,
    runLimit: opts.runLimit ?? 3,
    command: (ids) => laneCommand("ndx", ids),
  });
}

const laneIds = (p: QueuePlan): string[][] => p.lanes.map((l) => l.tasks.map((t) => t.id));
const excludedReason = (p: QueuePlan, id: string): string | undefined => p.excluded.find((t) => t.id === id)?.reason;

/** Every candidate appears exactly once, in a lane or excluded, with a reason. */
function expectEachOnce(p: QueuePlan, ids: string[]): void {
  const seen = [...p.lanes.flatMap((l) => l.tasks), ...p.excluded];
  expect(seen.map((t) => t.id).sort()).toEqual([...ids].sort());
  for (const t of seen) expect(t.reason.length).toBeGreaterThan(0);
}

describe("planQueue", () => {
  it("groups tasks of one parent change into one lane with its exact command", () => {
    const p = plan([change("A", [task("a1"), task("a2")], { touches: ["cap-1"] })]);
    expect(laneIds(p)).toEqual([["t-a1", "t-a2"]]);
    expect(p.lanes[0].command).toBe("ndx work --task=t-a1 --auto . && ndx work --task=t-a2 --auto .");
    expect(p.lanes[0].changeId).toBe("A");
    expectEachOnce(p, ["t-a1", "t-a2"]);
  });

  it("caps a lane at 3 tasks and gives the overflow a reason", () => {
    const p = plan([change("A", ["1", "2", "3", "4"].map((n) => task(`a${n}`)), { touches: ["cap-1"] })]);
    expect(laneIds(p)).toEqual([["t-a1", "t-a2", "t-a3"]]);
    expect(excludedReason(p, "t-a4")).toMatch(/3-task lane cap/);
    expectEachOnce(p, ["t-a1", "t-a2", "t-a3", "t-a4"]);
  });

  it("excludes a heavy task, whether its tier is its own, its change's or the default", () => {
    const own = plan([change("A", [task("a1", { run: { tier: "heavy" } }), task("a2")], { touches: ["x"] })]);
    expect(laneIds(own)).toEqual([["t-a2"]]);
    expect(excludedReason(own, "t-a1")).toMatch(/tier heavy \(task\.run\.tier\)/);

    const fromChange = plan([change("A", [task("a1")], { touches: ["x"], run: { tier: "heavy" } })]);
    expect(excludedReason(fromChange, "t-a1")).toMatch(/tier heavy \(change\.run\.tier\)/);

    const ownWins = plan([change("A", [task("a1", { run: { tier: "light" } })], { run: { tier: "heavy" } })]);
    expect(laneIds(ownWins)).toEqual([["t-a1"]]);

    const byDefault = plan([change("A", [task("a1")])], { defaultTier: "heavy" });
    expect(excludedReason(byDefault, "t-a1")).toMatch(/tier heavy \(default\)/);
  });

  it.each(COLD_ONLY_TAGS)("excludes a task tagged %s with a reason naming the tag", (tag) => {
    const p = plan([change("A", [task("a1", { tags: [tag] }), task("a2")], { touches: ["x"] })]);
    expect(laneIds(p)).toEqual([["t-a2"]]);
    expect(excludedReason(p, "t-a1")).toContain(`tagged ${tag}`);
  });

  it("reads a cold-only tag on the parent change as the task's", () => {
    const p = plan([change("A", [task("a1")], { tags: ["migration"] })]);
    expect(p.lanes).toEqual([]);
    expect(excludedReason(p, "t-a1")).toContain("tagged migration");
  });

  it("runs a dependency chain in dependency order inside one lane", () => {
    // a1 waits on a2, a2 on a3: only a3 is ready, the others follow it.
    const p = plan([
      change("A", [
        task("a1", { blockedBy: ["t-a2"] }),
        task("a2", { blockedBy: ["t-a3"] }),
        task("a3"),
      ], { touches: ["x"] }),
    ]);
    expect(laneIds(p)).toEqual([["t-a3", "t-a2", "t-a1"]]);
    expect(p.lanes[0].tasks[1].reason).toContain("after t-a3");
    expectEachOnce(p, ["t-a1", "t-a2", "t-a3"]);
  });

  it("leaves out a blocked task whose blocker is not in a lane", () => {
    const p = plan([change("A", [task("a1", { tags: ["migration"] }), task("a2", { blockedBy: ["t-a1"] })])]);
    expect(p.lanes).toEqual([]);
    expect(excludedReason(p, "t-a2")).toMatch(/waits on t-a1/);
  });

  it("does not offer a task blocked by work outside its change", () => {
    const p = plan([
      change("A", [task("a1")], { touches: ["x"] }),
      change("B", [task("b1", { blockedBy: ["t-a1"] })], { touches: ["y"] }),
    ]);
    expectEachOnce(p, ["t-a1"]);
  });

  it("pairs changes with disjoint touches and keeps overlapping ones apart", () => {
    const p = plan([
      change("A", [task("a1")], { touches: ["cap-1", "cap-2"], priority: "high" }),
      change("B", [task("b1")], { touches: ["cap-2"], priority: "medium" }),
      change("C", [task("c1")], { touches: ["cap-3"], priority: "low" }),
    ]);
    expect(laneIds(p)).toEqual([["t-a1"], ["t-c1"]]);
    expect(excludedReason(p, "t-b1")).toMatch(/touches cap-2, as change A/);
    expectEachOnce(p, ["t-a1", "t-b1", "t-c1"]);
  });

  it("never pairs a change with no touches with another lane", () => {
    const first = plan([
      change("A", [task("a1")], { priority: "high" }),
      change("B", [task("b1")], { touches: ["cap-1"], priority: "low" }),
    ]);
    expect(laneIds(first)).toEqual([["t-a1"]]);
    expect(excludedReason(first, "t-b1")).toMatch(/lane 1 \(change A\) has no touches/);

    const later = plan([
      change("A", [task("a1")], { touches: ["cap-1"], priority: "high" }),
      change("B", [task("b1")], { priority: "low" }),
    ]);
    expect(laneIds(later)).toEqual([["t-a1"]]);
    expect(excludedReason(later, "t-b1")).toMatch(/change B has no touches/);
  });

  it("offers no more lanes than the free run slots", () => {
    const changes = ["A", "B", "C"].map((id, i) => change(id, [task(`${id}1`)], { touches: [`cap-${i}`] }));
    const one = plan(changes, { activeRuns: 2, runLimit: 3 });
    expect(one.lanes).toHaveLength(1);
    expect(one.excluded.every((t) => /no free run slot/.test(t.reason))).toBe(true);
    expect(one).toMatchObject({ activeRuns: 2, runLimit: 3 });
  });

  it("with the run limit full, offers no lanes and says why", () => {
    const p = plan([change("A", [task("a1")], { touches: ["x"] })], { activeRuns: 3, runLimit: 3 });
    expect(p.lanes).toEqual([]);
    expect(p.summary).toMatch(/3 runs active of a limit of 3/);
    expect(excludedReason(p, "t-a1")).toMatch(/no free run slot: 3 active of 3/);
  });

  it("passes over claimed and non-actionable tasks, as selection does", () => {
    const input = queueInputFromTree(
      { product: [], changes: [change("A", [task("a1"), task("a2"), task("a3", { status: "completed" })])] },
      { excludeIds: new Set(["t-a1"]), defaultTier: "standard" },
    );
    expect(input.tasks.map((t) => t.id)).toEqual(["t-a2"]);
  });
});
