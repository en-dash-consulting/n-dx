import { describe, expect, it } from "vitest";
import { diffPlanFiles } from "../../../src/migrations/plan-diff.js";
import type { PlanFile } from "../../../src/migrations/plan-file.js";

function plan(entries: Record<string, unknown> = {}): PlanFile {
  return {
    format: "ndx-migration-plan", version: 1,
    header: {
      migration: "v1-to-v2", from: "v1", to: "v2",
      source: { kind: "rex-v1-tree", digest: "source" },
      cutAt: "2026-10-08T00:00:00.000Z", passes: [{ name: "rules" }],
    },
    entries, summary: {}, answers: {},
  };
}
const entry = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, target: "task", ...extra });

describe("migration plan diff", () => {
  it("names each added, dropped and moved entry in a sentence", () => {
    const before = plan({ old: entry("old"), moved: entry("moved", { parent: "area-a" }) });
    const after = plan({ added: entry("added"), moved: entry("moved", { parent: "area-b" }) });
    expect(diffPlanFiles(before, after)).toContain('Dropped "old" (old), a task at the layer root.');
    expect(diffPlanFiles(before, after)).toContain('Added "added" (added), a task at the layer root.');
    expect(diffPlanFiles(before, after)).toContain('Moved "moved" (moved) from task under area-a to task under area-b.');
    expect(diffPlanFiles(before, after)).toContain("Entries: 1 added, 1 dropped, 1 moved, 0 changed.");
  });

  it("counts each kind from entries, without trusting stale summary counts", () => {
    const before = plan({ a: entry("a", { target: "area" }), c: entry("c", { target: "capability" }) });
    const after = plan({ a: entry("a", { target: "area" }), c: entry("c", { target: "constraint" }), t: entry("t") });
    before.summary = { counts: { area: 99 } };
    const output = diffPlanFiles(before, after);
    expect(output).toContain("Counts by kind: area 1 → 1; capability 1 → 0; constraint 0 → 1; change 0 → 0; task 0 → 1; subtask 0 → 0; release 0 → 0.");
  });

  it("counts corrupt metadata once from the entries, never adding summary totals", () => {
    const before = plan({ a: entry("a", { data: { droppedMeta: 2, droppedLog: 1 } }) });
    const after = plan({ a: entry("a", { data: { droppedMeta: 3, droppedLog: 2 } }), b: entry("b", { data: { droppedMeta: 1, droppedLog: 4 } }) });
    after.summary = { corrupt: { recommendationMeta: 4, logEntries: 6 } };
    const output = diffPlanFiles(before, after);
    expect(output).toContain("Corrupt metadata to drop: recommendationMeta 2 → 4; log entries 1 → 6.");
    expect(output.match(/Corrupt metadata/g)).toHaveLength(1);
    expect(output).not.toMatch(/droppedMeta|droppedLog/);
  });

  it("reports no differences for identical plans, including reordered object keys", () => {
    const before = plan({ a: entry("a", { spec: { statement: "One", criteria: [] } }) });
    const after = structuredClone(before);
    after.entries.a = { spec: { criteria: [], statement: "One" }, target: "task", title: "a", id: "a" };
    expect(diffPlanFiles(before, after)).toBe("No differences between migration plans.\n");
    expect(diffPlanFiles(plan(), plan())).toBe("No differences between migration plans.\n");
  });

  it("does not confuse a changed decision with an unchanged entry or an answer-cache change", () => {
    const before = plan({ a: entry("a", { spec: { statement: "One" } }) });
    const after = structuredClone(before);
    after.entries.a = entry("a", { spec: { statement: "Two" } });
    expect(diffPlanFiles(before, after)).toContain('Changed "a" (a): spec.');
    const cacheOnly = structuredClone(before);
    cacheOnly.answers.text = { a: { model: "new-model", hash: "new-hash", answer: "new answer" } };
    expect(diffPlanFiles(before, cacheOnly)).toBe("No differences between migration plans.\n");
  });

  it.each([
    { target: "change" }, { parent: "new-parent" }, { placement: "new-capability" },
    { needsPlacement: true }, { relation: "amends" },
  ])("reports movement when the destination decision changes: %j", (decision) => {
    const output = diffPlanFiles(plan({ a: entry("a") }), plan({ a: entry("a", decision) }));
    expect(output).toContain('Moved "a" (a)');
    expect(output).toContain("1 moved, 0 changed");
  });

  it("includes other changed fields on a moved entry and does not mutate either plan", () => {
    const before = plan({ a: entry("a") });
    const after = plan({ a: entry("a", { parent: "p", title: "Renamed" }) });
    const original = structuredClone([before, after]);
    expect(diffPlanFiles(before, after)).toContain("Also changed: title.");
    expect([before, after]).toEqual(original);
  });

  it("escapes newlines in titles so a title cannot impersonate another diff line", () => {
    expect(diffPlanFiles(plan(), plan({ a: entry("a", { title: "A\nDropped everything" }) }))).toContain('"A\\nDropped everything"');
  });

  it("names a removed null-valued decision and preserves destinations even while held", () => {
    const before = plan({ a: entry("a", { note: null, needsPlacement: true, placement: "old" }) });
    const after = plan({ a: entry("a", { needsPlacement: true, placement: "new" }) });
    const output = diffPlanFiles(before, after);
    expect(output).toContain('held for placement; touches "old"');
    expect(output).toContain('held for placement; touches "new"');
    expect(output).toContain("Also changed: note.");
  });

  it("reports plan-wide decisions and incomplete passes, but ignores cut time and source digest alone", () => {
    const before = plan();
    const after = structuredClone(before);
    after.header.cutAt = "2026-10-09T00:00:00.000Z";
    after.header.source.digest = "new-source";
    expect(diffPlanFiles(before, after)).toBe("No differences between migration plans.\n");
    after.summary = { constraints: [{ title: "New constraint", appliesTo: "all" }] };
    expect(diffPlanFiles(before, after)).toContain("Plan summary changed: constraints.");
    after.header.passes.push({ name: "text", model: "m", incomplete: { error: "offline" } });
    expect(diffPlanFiles(before, after)).toContain("After plan is incomplete: text.");
  });

  it.each([
    null, { a: null }, { a: entry("different-id") }, { a: entry("a", { target: "unknown" }) },
    { a: entry("a", { data: { droppedMeta: -1 } }) },
    { a: entry("a", { relation: "touches\nDropped everything" }) },
  ])("refuses malformed entries instead of reporting a misleading diff: %j", (entries) => {
    const malformed = plan();
    malformed.entries = entries as PlanFile["entries"];
    expect(() => diffPlanFiles(plan(), malformed)).toThrow(/entry|entries/i);
  });

  it("refuses incompatible migrations", () => {
    const after = plan();
    after.header.migration = "something-else";
    expect(() => diffPlanFiles(plan(), after)).toThrow(/same migration/);
  });
});
