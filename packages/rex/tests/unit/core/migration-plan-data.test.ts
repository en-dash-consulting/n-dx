import { describe, it, expect } from "vitest";
import type { ItemLevel, ItemStatus, LogEntry, PRDItem } from "../../../src/schema/v1.js";
import { classifyV1Tree } from "../../../src/core/migration-plan.js";
import {
  buildPlanData,
  cleanLogEntries,
  dropCorrupt,
  legacyLoeRationale,
} from "../../../src/core/migration-plan-data.js";

let seq = 0;
function item(level: ItemLevel, title: string, extra: Partial<PRDItem> = {}, children: PRDItem[] = [], status: ItemStatus = "completed"): PRDItem {
  seq += 1;
  return { id: `${level}-${seq}`, level, title, status, children, ...extra };
}

const dataFor = (tree: PRDItem[], options = {}) => buildPlanData(tree, classifyV1Tree(tree), options);

describe("criteria ids and aliases", () => {
  it("numbers criteria c1..cn in source order", () => {
    const task = item("task", "Do it", { acceptanceCriteria: ["first", "second"] });
    const data = dataFor([item("epic", "Area", {}, [item("feature", "Thing", {}, [task])])]);
    expect(data.items[task.id]!.criteria).toEqual([
      { id: "c1", text: "first" },
      { id: "c2", text: "second" },
    ]);
  });

  it("aliases a dissolved release umbrella to its first child change", () => {
    const child = item("feature", "Keep the thing");
    const umbrella = item("epic", "ndx 0.9.0", {}, [child, item("feature", "Other")]);
    const data = dataFor([umbrella]);
    expect(data.items[child.id]!.aliases).toEqual([umbrella.id]);
  });
});

describe("shippedIn backfill", () => {
  const releases = [
    { version: "0.8.0", date: "2026-09-01T00:00:00Z" },
    { version: "0.7.0", date: "2026-08-01T00:00:00Z" },
  ];
  const mk = () => item("task", "Ship", { completedAt: "2026-08-15T00:00:00Z" });

  it("takes the first release tagged after completion", () => {
    const t = mk();
    expect(dataFor([t], { releases }).items[t.id]!.shippedIn).toEqual({ version: "0.8.0", source: "release-tag" });
  });

  it("lets PR merge data override the tag", () => {
    const t = mk();
    const data = dataFor([t], { releases, prMerges: { [t.id]: "0.7.1" } });
    expect(data.items[t.id]!.shippedIn).toEqual({ version: "0.7.1", source: "pr-merge" });
  });

  it("leaves an item completed after the last tag unshipped", () => {
    const t = item("task", "Late", { completedAt: "2026-10-01T00:00:00Z" });
    expect(dataFor([t], { releases }).items[t.id]).toBeUndefined();
  });
});

describe("data problem flags", () => {
  it("flags each class and counts it", () => {
    const tagged = item("task", "Tagged", { tags: ["ac: it works"] });
    const dupA = item("task", "Same");
    const dupB = item("task", "same");
    const parent = item("task", "Parented", { parentId: "x" });
    const stale = item("task", "Stale", { description: "TODO: wire this later" });
    const data = dataFor([item("epic", "Area", {}, [item("feature", "Thing", {}, [tagged, dupA, dupB, parent, stale])])]);
    expect(data.items[tagged.id]!.flags).toContain("criteria-in-tags");
    expect(data.items[dupA.id]!.flags).toContain("duplicate-title");
    expect(data.items[dupB.id]!.flags).toContain("duplicate-title");
    expect(data.items[parent.id]!.flags).toContain("legacy-parent-id");
    expect(data.items[stale.id]!.flags).toContain("stale-description");
    expect(data.flagCounts).toEqual({ "criteria-in-tags": 1, "duplicate-title": 2, "legacy-parent-id": 1, "stale-description": 1 });
  });

  it("does not flag an unrelated item", () => {
    const t = item("task", "Clean", { tags: ["web"], description: "Does a thing." });
    expect(dataFor([t]).items[t.id]).toBeUndefined();
  });
});

describe("legacy loe", () => {
  it("drops the numeric loe and prefixes loeRationale with the bucket", () => {
    const t = item("task", "Sized", { loe: "xl" });
    const data = dataFor([t]);
    expect(data.items[t.id]!.legacyLoe).toEqual({ bucket: "xl", loeRationale: "Legacy estimate: xl" });
    expect(data.legacyLoe).toBe(1);
  });

  it("keeps an existing rationale after the prefix and never maps to weeks", () => {
    expect(legacyLoeRationale("m", "touches three files")).toBe("Legacy estimate: m. touches three files");
    const t = item("task", "Sized", { loe: "M", loeRationale: "why" });
    const legacy = dataFor([t]).items[t.id]!.legacyLoe!;
    expect(legacy.loeRationale.startsWith("Legacy estimate: m")).toBe(true);
    expect(JSON.stringify(legacy)).not.toMatch(/week/i);
  });

  it("ignores a numeric loe", () => {
    const t = item("task", "Sized", { loe: 2 });
    expect(dataFor([t]).items[t.id]).toBeUndefined();
  });
});

describe('"[object Object]" values', () => {
  it("counts recommendationMeta and log values and drops them", () => {
    const t = item("task", "Rec", { recommendationMeta: "[object Object]" });
    const u = item("task", "Rec2", { recommendationMeta: { a: "[object Object]", b: "ok" } });
    const log: LogEntry[] = [
      { timestamp: "t", event: "e", detail: "[object Object]" },
      { timestamp: "t", event: "e2" },
    ];
    const data = dataFor([t, u], { logEntries: log });
    expect(data.corrupt).toEqual({ recommendationMeta: 2, logEntries: 1 });
    expect(data.items[t.id]!.droppedMeta).toBe(1);

    expect(dropCorrupt(u.recommendationMeta)).toEqual({ b: "ok" });
    expect(dropCorrupt(t.recommendationMeta)).toBeUndefined();
    const cleaned = cleanLogEntries(log);
    expect(cleaned.dropped).toBe(1);
    expect(cleaned.entries[0]).toEqual({ timestamp: "t", event: "e" });
    expect(cleaned.entries[1]).toBe(log[1]);
  });
});

describe("determinism", () => {
  it("gives an identical plan data for an unchanged tree", () => {
    const tree = [
      item("epic", "ndx 0.9.0", {}, [item("feature", "A", { acceptanceCriteria: ["x"], loe: "s" }), item("feature", "A")]),
    ];
    const opts = { releases: [{ version: "0.9.0", date: "2026-10-01T00:00:00Z" }] };
    expect(JSON.stringify(dataFor(tree, opts))).toBe(JSON.stringify(dataFor(tree, opts)));
  });
});
