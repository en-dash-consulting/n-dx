import { describe, it, expect } from "vitest";
import type { ItemLevel, ItemStatus, PRDItem } from "../../../../src/schema/v1.js";
import { v1ToV2, v1TreeSource } from "../../../../src/migrations/v1-to-v2/index.js";
import { renderPlanSummary, type V1ToV2Plan } from "../../../../src/migrations/v1-to-v2/plan-summary.js";

function item(id: string, level: ItemLevel, title: string, children: PRDItem[] = [], status: ItemStatus = "completed", extra: Partial<PRDItem> = {}): PRDItem {
  return { id, level, title, status, children, ...extra };
}

const tree = (): PRDItem[] => [
  item("e1", "epic", "Rex", [
    item("f1", "feature", "Task selection", [item("t1", "task", "Add priority ordering", [], "completed", { completedAt: "2026-09-01T00:00:00.000Z" })], "completed", {
      description: "Picks the next actionable task by priority and dependencies.",
      acceptanceCriteria: ["Blocked tasks are skipped"],
    }),
    item("f2", "feature", "PRD storage isolation", [], "pending"),
  ]),
  item("e2", "epic", "ndx 0.9.0", [item("f3", "feature", "Prepare task", [], "pending")]),
];

const CUT = "2026-10-08T00:00:00.000Z";

const plan = async (items: PRDItem[] = tree()): Promise<V1ToV2Plan> => v1ToV2.plan(v1TreeSource(items), { cutAt: CUT });

describe("renderPlanSummary", () => {
  it("lists every v1 item with its target", async () => {
    const text = renderPlanSummary(await plan());
    const items = text.slice(text.indexOf("## Items"));
    for (const id of ["e1", "f1", "t1", "f2", "e2", "f3"]) expect(items).toContain(`\`${id}\``);
    expect(items).toMatch(/\| `e1` \| epic \| Rex \| area \|/);
    expect(items).toMatch(/\| `e2` \| epic \| ndx 0\.9\.0 \| release \|/);
  });

  it("lists the proposed areas with their notes, and the proposed constraints", async () => {
    const summary = (await plan()).summary;
    const text = renderPlanSummary(await plan());

    expect(text).toContain("## Proposed areas");
    for (const area of summary.areas) {
      expect(text).toContain(area.title);
      for (const note of area.notes) expect(text).toContain(note);
    }
    expect(text).toContain("## Proposed constraints");
    expect(summary.constraints.length).toBeGreaterThan(0);
    for (const constraint of summary.constraints) expect(text).toContain(constraint.title);
  });

  it("records the cut time and the passes that ran, and reads no clock of its own", async () => {
    const text = renderPlanSummary(await plan());
    expect(text).toContain(`- Cut at: ${CUT}`);
    expect(text).toContain("- Passes: rules");
    expect(renderPlanSummary(await plan())).toBe(text);
  });

  it("names each dissolved release epic and what it becomes", async () => {
    const text = renderPlanSummary(await plan());
    expect(text).toContain("## Dissolved release epics");
    expect(text).toMatch(/\| ndx 0\.9\.0 \| `e2` \| 0\.9\.0 \|/);
  });

  it("leads with a refusal when a pass is incomplete, so it is not read past", async () => {
    const incomplete = await plan();
    incomplete.header.passes.push({ name: "text", model: "m", incomplete: { error: "seam down" } });
    const text = renderPlanSummary(incomplete);
    expect(text).toContain("**Do not apply this plan.**");
    expect(text).toContain("text (m) — incomplete: seam down");
    expect(text.indexOf("Do not apply")).toBeLessThan(text.indexOf("## Counts"));
  });

  it("escapes a pipe in a title rather than splitting the row", async () => {
    const text = renderPlanSummary(await plan([item("e1", "epic", "Pipes | and | more", [], "pending")]));
    expect(text).toContain("Pipes \\| and \\| more");
    const row = text.split("\n").find((l) => l.startsWith("| `e1` |"))!;
    expect(row.match(/(?<!\\)\|/g)).toHaveLength(7); // six columns
  });

  it("escapes a backslash in a title so it cannot turn the next pipe into an escaped one", async () => {
    const text = renderPlanSummary(await plan([item("e1", "epic", "Paths C:\\ and D:\\", [], "pending")]));
    expect(text).toContain("Paths C:\\\\ and D:\\\\");
    const row = text.split("\n").find((l) => l.startsWith("| `e1` |"))!;
    // `D:\\ |` must still end the cell: the literal backslash is doubled, so the pipe after it is a boundary, not `\|`.
    expect(row).toContain("D:\\\\ | area |");
    expect(row.split(" | ")).toHaveLength(6);
  });
});
