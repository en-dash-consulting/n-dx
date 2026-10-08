import { describe, it, expect } from "vitest";
import type { ItemLevel, ItemStatus, PRDItem } from "../../../../src/schema/v1.js";
import { formatPlanFile, parsePlanFile } from "../../../../src/migrations/plan-file.js";
import { findMigration, MIGRATIONS } from "../../../../src/migrations/registry.js";
import { v1ToV2, v1TreeSource, V1_TREE_SOURCE_KIND } from "../../../../src/migrations/v1-to-v2/index.js";

function item(id: string, level: ItemLevel, title: string, children: PRDItem[] = [], status: ItemStatus = "completed", extra: Partial<PRDItem> = {}): PRDItem {
  return { id, level, title, status, children, ...extra };
}

/** Built fresh on each call, so two plans share no objects. */
const tree = (): PRDItem[] => [
  item("e1", "epic", "Rex", [
    item("f1", "feature", "Task selection", [item("t1", "task", "Add priority ordering", [], "completed", { completedAt: "2026-09-01T00:00:00.000Z" })], "completed", {
      description: "Picks the next actionable task by priority and dependencies.",
      acceptanceCriteria: ["Blocked tasks are skipped"],
    }),
    item("f2", "feature", "Fix claim leak across worktrees", [item("t2", "task", "Release on exit")], "pending"),
  ]),
  item("e2", "epic", "ndx 0.9.0", [item("f3", "feature", "Prepare task", [], "pending", { loe: "m" as unknown as number })]),
];

const CUT = "2026-10-08T00:00:00.000Z";
const options = { testFiles: ["packages/rex/tests/unit/core/blocked-tasks-skipped.test.ts"] };

describe("v1-to-v2 migration", () => {
  it("plans an unchanged tree twice into byte-identical plan files", async () => {
    const a = await v1ToV2.plan(v1TreeSource(tree()), { cutAt: CUT, options });
    const b = await v1ToV2.plan(v1TreeSource(tree()), { cutAt: CUT, options });
    expect(formatPlanFile(b)).toBe(formatPlanFile(a));
  });

  it("keys one entry per v1 item by its id, joining classification, data and specs", async () => {
    const plan = await v1ToV2.plan(v1TreeSource(tree()), { cutAt: CUT, options });
    expect(Object.keys(plan.entries)).toEqual(["e1", "f1", "t1", "f2", "t2", "e2", "f3"]);
    expect(plan.header).toMatchObject({ migration: "v1-to-v2", from: "v1", to: "v2", source: { kind: V1_TREE_SOURCE_KIND } });
    expect(plan.entries.f1).toMatchObject({ target: "capability", spec: { capability: "f1" } });
    expect(plan.entries.f1?.data?.criteria).toBeUndefined();
    expect(plan.entries.t1?.data?.appliedAt).toBe("2026-09-01T00:00:00.000Z");
    expect(plan.entries.f3?.data?.legacyLoe?.bucket).toBe("m");
    expect(plan.entries.e2?.target).toBe("release");
    expect(plan.summary.counts.capability).toBe(1);
    expect(plan.summary.legacyLoe).toBe(1);
  });

  it("writes a plan file the reader accepts and returns equal", async () => {
    const plan = await v1ToV2.plan(v1TreeSource(tree()), { cutAt: CUT, options });
    expect(parsePlanFile(formatPlanFile(plan))).toEqual(JSON.parse(formatPlanFile(plan)));
  });

  it("changes the source digest when an item moves, though no item's own fields changed", async () => {
    const moved = tree();
    const f2 = moved[0]!.children!.pop()!;
    moved[1]!.children!.push(f2);
    const a = await v1ToV2.plan(v1TreeSource(tree()), { cutAt: CUT });
    const b = await v1ToV2.plan(v1TreeSource(moved), { cutAt: CUT });
    expect(b.header.source.digest).not.toBe(a.header.source.digest);
  });

  it("gives an item the same content hash whatever its children", () => {
    const hashOf = (items: PRDItem[], id: string) => (v1TreeSource(items).read() as { items: { id: string; hash: string }[] }).items.find((i) => i.id === id)?.hash;
    const pruned = tree();
    pruned[0]!.children![0]!.children = [];
    expect(hashOf(pruned, "f1")).toBe(hashOf(tree(), "f1"));
    expect(hashOf(pruned, "e1")).toBe(hashOf(tree(), "e1"));
  });
});

describe("migration registry", () => {
  it("finds v1-to-v2 by id and lists each id once", () => {
    expect(findMigration("v1-to-v2")).toBe(v1ToV2);
    expect(findMigration("nope")).toBeUndefined();
    const ids = MIGRATIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has no apply yet", () => {
    expect(v1ToV2.apply).toBeUndefined();
  });
});
