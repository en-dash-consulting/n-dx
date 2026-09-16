import { describe, it, expect, beforeEach } from "vitest";
import type { PRDDocument, PRDItem } from "../../../src/server/rex-gateway.js";
import {
  computePrdDelta,
  cachedPrdDelta,
  invalidatePrdDelta,
  prdDeltaCacheSize,
  PRD_DELTA_ID_CAP,
} from "../../../src/server/prd-delta.js";

/**
 * The delta is four questions asked of two id-indexed trees. Each category
 * has a fixture that produces exactly it; identical trees produce none; the
 * id lists are capped but the counts never are; and the cache forgets a pair
 * when either side's tree is invalidated.
 */

const KEYS = { anchor: "app", workspace: "feature" };

function item(id: string, extra: Partial<PRDItem> = {}): PRDItem {
  return { id, title: `Item ${id}`, level: "task", status: "pending", ...extra };
}

function doc(items: PRDItem[]): PRDDocument {
  return { schema: "rex/v1", title: "T", items } as PRDDocument;
}

/** Nested tree: an epic with two tasks, one of which has a subtask. */
function nested(): PRDDocument {
  return doc([
    item("e1", { level: "epic", children: [
      item("t1"),
      item("t2", { children: [item("s1", { level: "subtask" })] }),
    ] }),
  ]);
}

describe("computePrdDelta", () => {
  it("reports identical trees as identical, with zero counts and empty lists", () => {
    const d = computePrdDelta(nested(), nested(), KEYS, () => new Date("2026-09-16T00:00:00Z"));
    expect(d).toMatchObject({
      anchor: "app",
      workspace: "feature",
      sources: { anchor: true, workspace: true },
      totals: { anchor: 4, workspace: 4 },
      counts: { onlyHere: 0, onlyAnchor: 0, changed: 0, completedHere: 0 },
      onlyHere: [], onlyAnchor: [], changed: [], completedHere: [],
      truncated: false,
      identical: true,
      computedAt: "2026-09-16T00:00:00.000Z",
    });
  });

  it("onlyHere: ids the workspace has and the anchor lacks, at any depth", () => {
    const ws = nested();
    ws.items[0].children!.push(item("t3"));
    ws.items[0].children![1].children!.push(item("s2", { level: "subtask" }));
    const d = computePrdDelta(nested(), ws, KEYS);
    expect(d.onlyHere).toEqual(["s2", "t3"]);
    expect(d.counts).toEqual({ onlyHere: 2, onlyAnchor: 0, changed: 0, completedHere: 0 });
    expect(d.identical).toBe(false);
  });

  it("onlyAnchor: ids the anchor has and the workspace lacks", () => {
    const anchor = nested();
    anchor.items.push(item("e2", { level: "epic", children: [item("t9")] }));
    const d = computePrdDelta(anchor, nested(), KEYS);
    expect(d.onlyAnchor).toEqual(["e2", "t9"]);
    expect(d.counts).toEqual({ onlyHere: 0, onlyAnchor: 2, changed: 0, completedHere: 0 });
  });

  it("changed: same id, different status, title, priority, description or lastModified — nothing else", () => {
    const base = () => doc([
      item("a"), item("b"), item("c"), item("d"), item("e"), item("f"), item("g"),
    ]);
    const ws = base();
    ws.items[0].status = "in_progress";
    ws.items[1].title = "Renamed";
    ws.items[2].priority = "high";
    ws.items[3].description = "now described";
    ws.items[4].lastModified = "2026-09-16T12:00:00Z";
    // Not compared: tags, acceptance criteria, blockedBy.
    ws.items[5].tags = ["x"];
    ws.items[5].acceptanceCriteria = ["done"];
    ws.items[5].blockedBy = ["a"];
    const d = computePrdDelta(base(), ws, KEYS);
    expect(d.changed).toEqual(["a", "b", "c", "d", "e"]);
    expect(d.counts.changed).toBe(5);
  });

  it("treats an absent field and an undefined field as equal", () => {
    const anchor = doc([item("a", { description: undefined })]);
    const ws = doc([item("a")]);
    expect(computePrdDelta(anchor, ws, KEYS).identical).toBe(true);
  });

  it("completedHere: completed in the workspace and not completed in the anchor — present or absent there", () => {
    const anchor = doc([item("done-both", { status: "completed" }), item("pending-there"), item("gone")]);
    const ws = doc([
      item("done-both", { status: "completed" }),   // completed on both sides → not counted
      item("pending-there", { status: "completed" }), // finished here, open on main
      item("new-done", { status: "completed" }),     // added and finished here
      item("gone", { status: "cancelled" }),          // not completed
    ]);
    const d = computePrdDelta(anchor, ws, KEYS);
    expect(d.completedHere).toEqual(["new-done", "pending-there"]);
    // Overlaps are by design: the four lists are questions, not a partition.
    expect(d.onlyHere).toEqual(["new-done"]);
    expect(d.changed).toEqual(["gone", "pending-there"]);
    expect(d.counts).toEqual({ onlyHere: 1, onlyAnchor: 0, changed: 2, completedHere: 2 });
  });

  it("caps each id list at PRD_DELTA_ID_CAP, flags it, and keeps the counts exact", () => {
    const many = Array.from({ length: PRD_DELTA_ID_CAP + 37 }, (_, i) => item(`n${String(i).padStart(4, "0")}`));
    const d = computePrdDelta(doc([]), doc(many), KEYS);
    expect(d.counts.onlyHere).toBe(PRD_DELTA_ID_CAP + 37);
    expect(d.onlyHere).toHaveLength(PRD_DELTA_ID_CAP);
    expect(d.onlyHere[0]).toBe("n0000");
    expect(d.truncated).toBe(true);
    // The other lists are untouched and the anchor side is empty.
    expect(d.onlyAnchor).toEqual([]);
    expect(d.totals).toEqual({ anchor: 0, workspace: PRD_DELTA_ID_CAP + 37 });
  });

  it("diffs a missing side as an empty tree and says which side was missing", () => {
    const d = computePrdDelta(null, nested(), KEYS);
    expect(d.sources).toEqual({ anchor: false, workspace: true });
    expect(d.counts.onlyHere).toBe(4);
    const e = computePrdDelta(nested(), null, KEYS);
    expect(e.sources).toEqual({ anchor: true, workspace: false });
    expect(e.counts.onlyAnchor).toBe(4);
    expect(computePrdDelta(null, null, KEYS).identical).toBe(true);
  });

  it("agrees with `comm` on the id sets", () => {
    // What the acceptance criterion checks by hand: `comm -23` / `comm -13`
    // over the sorted unique id lists of the two trees. Same computation here,
    // written independently of the module, over trees with real overlap.
    const shared = Array.from({ length: 200 }, (_, i) => item(`shared-${i}`));
    const hereOnly = Array.from({ length: 35 }, (_, i) => item(`branch-${i}`));
    const anchorOnly = Array.from({ length: 109 }, (_, i) => item(`main-${i}`));
    const anchor = doc([item("root", { level: "epic", children: [...shared, ...anchorOnly] })]);
    const ws = doc([item("root", { level: "epic", children: [...shared, ...hereOnly] })]);

    const ids = (d: PRDDocument): string[] => {
      const out: string[] = [];
      const walk = (items: PRDItem[]) => { for (const it of items) { out.push(it.id); if (it.children) walk(it.children); } };
      walk(d.items);
      return [...new Set(out)].sort();
    };
    const comm = (a: string[], b: string[]) => {
      const setB = new Set(b);
      return a.filter((x) => !setB.has(x)); // comm -23 a b
    };
    const wsIds = ids(ws);
    const anchorIds = ids(anchor);
    const d = computePrdDelta(anchor, ws, KEYS);
    expect(d.counts.onlyHere).toBe(comm(wsIds, anchorIds).length);
    expect(d.counts.onlyAnchor).toBe(comm(anchorIds, wsIds).length);
    expect(d.onlyHere).toEqual(comm(wsIds, anchorIds));
    expect(d.onlyAnchor).toEqual(comm(anchorIds, wsIds));
    expect(d.counts).toMatchObject({ onlyHere: 35, onlyAnchor: 109 });
  });
});

describe("cachedPrdDelta", () => {
  beforeEach(() => invalidatePrdDelta());

  const pair = { anchorRexDir: "/a/.rex", workspaceRexDir: "/w/.rex", anchorKey: "app", workspaceKey: "feature" };

  it("loads both sides once and serves the pair from cache afterwards", () => {
    const loads: string[] = [];
    const load = (rexDir: string) => { loads.push(rexDir); return rexDir === "/a/.rex" ? doc([item("a")]) : doc([item("b")]); };
    const first = cachedPrdDelta(pair, load);
    const second = cachedPrdDelta(pair, load);
    expect(loads).toEqual(["/a/.rex", "/w/.rex"]);
    expect(second).toBe(first);
    expect(prdDeltaCacheSize()).toBe(1);
  });

  it("forgets every pair a changed tree takes part in — as anchor or as workspace", () => {
    const load = () => doc([]);
    cachedPrdDelta(pair, load);
    cachedPrdDelta({ ...pair, workspaceRexDir: "/x/.rex", workspaceKey: "x" }, load);
    cachedPrdDelta({ ...pair, anchorRexDir: "/other/.rex", anchorKey: "other" }, load);
    expect(prdDeltaCacheSize()).toBe(3);

    invalidatePrdDelta("/w/.rex");   // the workspace side of two pairs
    expect(prdDeltaCacheSize()).toBe(1);
    invalidatePrdDelta("/nowhere");  // touches nothing
    expect(prdDeltaCacheSize()).toBe(1);
    invalidatePrdDelta("/a/.rex");   // the anchor side of the remaining pair
    expect(prdDeltaCacheSize()).toBe(0);
  });

  it("recomputes after invalidation and sees the new tree", () => {
    let version = 1;
    const load = (rexDir: string) => (rexDir === "/w/.rex" ? doc([item(`v${version}`)]) : doc([]));
    expect(cachedPrdDelta(pair, load).onlyHere).toEqual(["v1"]);
    version = 2;
    expect(cachedPrdDelta(pair, load).onlyHere).toEqual(["v1"]); // still cached
    invalidatePrdDelta("/w/.rex");
    expect(cachedPrdDelta(pair, load).onlyHere).toEqual(["v2"]);
  });
});
