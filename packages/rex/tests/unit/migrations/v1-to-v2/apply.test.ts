import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeProductStatus } from "../../../../src/core/product-status.js";
import { findActionableWork } from "../../../../src/core/change-selection.js";
import { checkV2TreeHealth } from "../../../../src/core/health.js";
import { isLossless } from "../../../../src/core/slug-migration.js";
import type { PRDItem } from "../../../../src/schema/v1.js";
import { CUT_HELD_AFTER_CUT_HEADING, checkV2Rules, isAppliedChange, nodeSpec, specHash, type RuleNode, type V2Tree } from "../../../../src/schema/v2-rules.js";
import { FileStore } from "../../../../src/store/index.js";
import { loadPrdModel } from "../../../../src/store/prd-model-reader.js";
import type { PlanFile } from "../../../../src/migrations/plan-file.js";
import { v1ToV2, v1TreeSource } from "../../../../src/migrations/v1-to-v2/index.js";
import {
  CUT_CHANGE_TITLE,
  STAGING_DIRNAME,
  applyV1ToV2,
  buildV2Tree,
  cutContainerIds,
  everyV1Id,
  MigrationApplyError,
  rehearseV1ToV2,
  V1_KINDS,
  type V1ToV2Plan,
} from "../../../../src/migrations/v1-to-v2/apply.js";

// A model the reader cannot read back, or reads back without a node, is a writer or reader defect,
// not something a v1 tree can provoke on demand, so the read-back is made to report a skipped file,
// or to lose the node with id `lose`, when a test asks.
const readBack = vi.hoisted(() => ({ skip: false, lose: undefined as string | undefined }));
vi.mock("../../../../src/store/prd-model-reader.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../../src/store/prd-model-reader.js")>();
  const without = (nodes: RuleNode[], id: string): RuleNode[] =>
    nodes.filter((n) => n.id !== id).map((n) => (n.children ? { ...n, children: without(n.children, id) } : n));
  return {
    ...real,
    loadPrdModel: async (...args: Parameters<typeof real.loadPrdModel>) => {
      let model = await real.loadPrdModel(...args);
      const lose = readBack.lose;
      if (lose !== undefined) model = { ...model, tree: { product: without(model.tree.product, lose), changes: without(model.tree.changes, lose) } };
      if (!readBack.skip) return model;
      return { ...model, warnings: [...model.warnings, { path: "product/area/index.md", message: "unreadable", skipped: true }] };
    },
  };
});

// A removal held up by a handle (the dashboard's watcher, antivirus on Windows) cannot be provoked
// on demand, so `rm` of a path ending in `failRm` throws when a test asks.
const fsFaults = vi.hoisted(() => ({ failRm: undefined as string | undefined }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...real,
    rm: async (...args: Parameters<typeof real.rm>) => {
      const suffix = fsFaults.failRm;
      if (suffix !== undefined && String(args[0]).endsWith(suffix)) {
        throw Object.assign(new Error(`EBUSY: resource busy or locked, rmdir '${String(args[0])}'`), { code: "EBUSY" });
      }
      return real.rm(...args);
    },
  };
});

const CUT_AT = "2026-10-12T00:00:00.000Z";

const item = (id: string, level: PRDItem["level"], title: string, children: PRDItem[] = [], extra: Partial<PRDItem> = {}): PRDItem => ({
  id,
  level,
  title,
  status: "completed",
  children,
  ...extra,
});

/** Areas, a capability with history, an unbuilt feature (held), a release umbrella and a review-sourced epic (an area). */
const TREE: PRDItem[] = [
  item("e1", "epic", "Storage", [
    item("f1", "feature", "Offline cache", [item("t1", "task", "Write the cache", [item("s1", "subtask", "Pick a format")])], {
      description: "Pages stay readable offline.",
    }),
    item("f4", "feature", "Cache eviction", [item("t4", "task", "Evict entries", [], { status: "pending" })], { status: "pending" }),
  ]),
  item("e3", "epic", "ndx 0.9.0", [item("f5", "feature", "Tune offline cache writes", [], { status: "pending" })]),
  item("e2", "epic", "Review findings", [item("f3", "feature", "Lock is never released", [item("t3", "task", "Release it")])], {
    source: "ndx-adversarial-review",
  }),
];

/** Two open release epics, 0.12.0 blockedBy 0.11.0 and carrying a description and criteria. */
const RELEASES: PRDItem[] = [
  item("r11", "epic", "ndx 0.11.0", [
    item("g1", "feature", "Ship the hub", [], { status: "pending" }),
    item("g2", "feature", "Shipped already", []),
  ], { status: "pending" }),
  item("r12", "epic", "ndx 0.12.0", [
    item("g3", "feature", "Sidecar", [], { status: "pending" }),
    item("g4", "feature", "Sidecar docs", [], { status: "pending" }),
  ], {
    status: "pending",
    blockedBy: ["r11"],
    description: "Second soft-freeze release.\nNo new commands.",
    acceptanceCriteria: ["Every lane merged", "Release gate passes"],
  }),
];

/** What {@link RELEASES}' r12 leaves in the cut change's body: its line, and its fields under it. */
const R12_CUT_LINES = [
  "- ndx 0.12.0 (r12): plannedRelease 0.12.0",
  "  Second soft-freeze release.",
  "  No new commands.",
  "  Acceptance criteria:",
  "  - Every lane merged",
  "  - Release gate passes",
].join("\n");

function walk(nodes: readonly RuleNode[], out: RuleNode[] = []): RuleNode[] {
  for (const node of nodes) {
    out.push(node);
    walk(node.children ?? [], out);
  }
  return out;
}

const all = (tree: V2Tree): RuleNode[] => walk([...tree.product, ...tree.changes]);
const byId = (tree: V2Tree, id: string): RuleNode | undefined => all(tree).find((n) => n.id === id);

/** Every file under a directory with its bytes. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) visit(p);
      else out[p.slice(dir.length)] = readFileSync(p, "utf8");
    }
  };
  visit(dir);
  return out;
}

async function planOf(items: PRDItem[]): Promise<V1ToV2Plan> {
  return (await v1ToV2.plan(v1TreeSource(items), { cutAt: CUT_AT, options: { testFiles: [] } })) as V1ToV2Plan;
}

describe("buildV2Tree", () => {
  it("keeps every v1 id, as a node or a listed delivery container", async () => {
    const built = buildV2Tree(TREE, await planOf(TREE));
    expect(isLossless(everyV1Id(TREE, built.tree, built.containers, built.cut))).toBe(true);
    expect(built.containers.map((c) => c.id)).toEqual(["e3"]);
  });

  it("reports a lost id", async () => {
    const built = buildV2Tree(TREE, await planOf(TREE));
    built.tree.changes = built.tree.changes.filter((n) => n.id !== "t1");
    const diff = everyV1Id(TREE, built.tree, built.containers, built.cut);
    expect(diff.lost).toEqual(expect.arrayContaining(["t1", "s1"]));
    expect(isLossless(diff)).toBe(false);
  });

  it("places what the rules placed and holds the rest in the Inbox", async () => {
    const plan = await planOf(TREE);
    const { tree } = buildV2Tree(TREE, plan);
    expect(byId(tree, "f1")).toMatchObject({ type: "capability" });
    expect(byId(tree, "t1")).toMatchObject({ type: "change" });
    expect([...(byId(tree, "t1")!.touches ?? []), ...(byId(tree, "t1")!.amends ?? []).map((a) => a.target)]).toEqual(["f1"]);
    expect(byId(tree, "t1")!.needsPlacement).toBeUndefined();
    for (const [id, entry] of Object.entries(plan.entries)) {
      if (entry.target === "change" && entry.needsPlacement) expect(byId(tree, id)).toMatchObject({ type: "change", needsPlacement: true });
    }
  });

  it("stamps a release umbrella's plannedRelease and keeps a review-sourced epic as an area", async () => {
    const { tree } = buildV2Tree(TREE, await planOf(TREE));
    expect(byId(tree, "f5")!.plannedRelease).toBe("0.9.0");
    expect(byId(tree, "f3")!.plannedRelease).toBeUndefined();
    expect(byId(tree, "e2")).toMatchObject({ type: "area" });
  });

  describe("blockedBy a dissolved container", () => {
    // Containers still open in v1, so the dependency is repointed rather than dropped.
    const WITH_BLOCKER: PRDItem[] = [
      ...TREE.map((i) => (i.id === "e2" || i.id === "e3" ? { ...i, status: "pending" as const } : i)),
      item("e4", "epic", "Follow-ups", [item("f6", "feature", "Tidy the cache", [], { status: "pending", blockedBy: ["e3", "e2"] })]),
    ];

    it("names the container's children, not the container", async () => {
      const { tree, containers } = buildV2Tree(WITH_BLOCKER, await planOf(WITH_BLOCKER));
      const dissolved = new Set(containers.map((c) => c.id));
      expect(dissolved).toEqual(new Set(["e3"]));
      for (const node of all(tree)) {
        for (const ref of node.blockedBy ?? []) expect(dissolved.has(ref)).toBe(false);
      }
      // e2 is an area, a product node: its ref names its open changes, and it has none.
      expect(byId(tree, "f6")!.blockedBy).toEqual(["f5"]);
    });

    it("reports each repoint and drop with the old and new refs, on the build and the cut change", async () => {
      const { tree, blockers, cut } = buildV2Tree(WITH_BLOCKER, await planOf(WITH_BLOCKER));
      expect(blockers).toEqual([
        { kind: "container", node: "f6", from: "e3", to: ["f5"] },
        { kind: "requirement", node: "f6", from: "e2", to: [] },
      ]);
      const body = byId(tree, cut)!.body as string;
      expect(body).toContain("- f6: blockedBy e3 → f5");
      expect(body).toContain("- f6: blockedBy e2 → dropped (no open change: met)");
      expect(cutContainerIds(tree)).toEqual(["e3"]);
    });

    it("is selectable once every child of the container is completed", async () => {
      const items: PRDItem[] = [
        // Every child completed, the epic itself never marked so: the repointed refs all resolve to completed nodes.
        item("r1", "epic", "ndx 0.9.0", [item("f7", "feature", "Shipped thing", [item("t7", "task", "Ship it")])], { status: "pending" }),
        item("f8", "feature", "Next thing", [item("t8", "task", "Do it", [], { status: "pending", blockedBy: ["r1"] })], { status: "pending" }),
      ];
      const { tree } = buildV2Tree(items, await planOf(items));
      const blocked = byId(tree, "t8")!;
      expect(blocked.blockedBy).toEqual(["f7"]);
      // Pending v1 work lands in the Inbox; placing it is the operator's step, not this one's.
      for (const n of all(tree)) delete n.needsPlacement;
      expect(findActionableWork(tree).map((u) => u.node.id)).toContain("t8");
    });

    it("drops a completed container's ref and never repoints at a cancelled or deleted child", async () => {
      const items: PRDItem[] = [
        item("r2", "epic", "ndx 0.8.0", [
          item("f9", "feature", "Shipped", []),
          item("f10", "feature", "Cut from the release", [], { status: "cancelled" }),
        ]),
        item("r3", "epic", "ndx 1.0.0", [
          item("f11", "feature", "Still open", [], { status: "pending" }),
          item("f12", "feature", "Withdrawn", [], { status: "deleted" }),
        ], { status: "pending" }),
        item("f13", "feature", "After 0.8.0", [], { status: "pending", blockedBy: ["r2"] }),
        item("f14", "feature", "After 1.0.0", [], { status: "pending", blockedBy: ["r3"] }),
      ];
      const { tree } = buildV2Tree(items, await planOf(items));
      expect(byId(tree, "f13")!.blockedBy).toBeUndefined();
      expect(byId(tree, "f14")!.blockedBy).toEqual(["f11"]);
    });
  });

  describe("a dissolved container's own fields", () => {
    it("keeps its description and acceptance criteria under its line in the cut change's body", async () => {
      const { tree, cut } = buildV2Tree(RELEASES, await planOf(RELEASES));
      const body = byId(tree, cut)!.body as string;
      expect(body).toContain(R12_CUT_LINES);
      expect(cutContainerIds(tree)).toEqual(["r11", "r12"]);
    });

    it("moves its blockedBy onto its open children, repointed at the other container's open children", async () => {
      const { tree, blockers, cut } = buildV2Tree(RELEASES, await planOf(RELEASES));
      expect(byId(tree, cut)!.body).toContain("- r12: blockedBy r11 → r11, moved onto its open children g3, g4");
      // The repoint keeps a completed child (g2): a met ref, which only g1 holds open.
      expect(byId(tree, "g3")!.blockedBy).toEqual(["g1", "g2"]);
      expect(byId(tree, "g4")!.blockedBy).toEqual(["g1", "g2"]);
      expect(byId(tree, "g1")!.blockedBy).toBeUndefined();
      expect(blockers).toContainEqual({ kind: "container", node: "r12", from: "r11", to: ["r11"], onto: ["g3", "g4"] });
      for (const n of all(tree)) delete n.needsPlacement;
      expect(findActionableWork(tree).map((u) => u.node.id)).not.toContain("g3");
    });
  });

  describe("blockedBy a product node", () => {
    // Features with completed work: capabilities. f1's only open change is t5 itself, so t5's ref to f1 is met.
    const ITEMS: PRDItem[] = [
      item("e1", "epic", "Storage", [
        item("f1", "feature", "Offline cache", [
          item("t1", "task", "Write the cache"),
          item("t5", "task", "Warm the cache", [], { status: "pending", blockedBy: ["f4", "f1"] }),
        ]),
        item("f4", "feature", "Cache eviction", [
          item("t3", "task", "Size the cache"),
          item("t4", "task", "Evict entries", [], { status: "pending" }),
        ], { status: "pending" }),
        item("f15", "feature", "Cache metrics", [
          item("t14", "task", "Add a counter"),
          item("t15", "task", "Count hits", [], { status: "pending" }),
          item("t16", "task", "Count misses", [], { status: "pending" }),
        ], { status: "pending", blockedBy: ["f4"] }),
      ]),
    ];

    it("names a capability's open changes, or drops the ref when none is open", async () => {
      const { tree, blockers } = buildV2Tree(ITEMS, await planOf(ITEMS));
      expect(byId(tree, "f4")).toMatchObject({ type: "capability" });
      expect(byId(tree, "f1")).toMatchObject({ type: "capability" });
      expect(byId(tree, "t5")!.blockedBy).toEqual(["t4"]);
      expect(blockers).toEqual(
        expect.arrayContaining([
          { kind: "requirement", node: "t5", from: "f4", to: ["t4"] },
          { kind: "requirement", node: "t5", from: "f1", to: [] },
        ]),
      );
    });

    it("moves a capability's own blockedBy onto each of its open changes, rewritten", async () => {
      const { tree, blockers } = buildV2Tree(ITEMS, await planOf(ITEMS));
      expect(byId(tree, "f15")).toMatchObject({ type: "capability" });
      for (const node of all(tree)) {
        if (node.type === "area" || node.type === "capability" || node.type === "constraint") expect(node.blockedBy).toBeUndefined();
      }
      expect(byId(tree, "t15")!.blockedBy).toEqual(["t4"]);
      expect(byId(tree, "t16")!.blockedBy).toEqual(["t4"]);
      expect(blockers).toContainEqual({ kind: "requirement", node: "f15", from: "f4", to: ["t4"], onto: ["t15", "t16"] });
    });

    describe("whose pending work is held in the Inbox", () => {
      // f20 is a capability whose pending t21 is held; f21, unbuilt, is held under area e6; f24 is met with nothing open.
      const HELD: PRDItem[] = [
        item("e6", "epic", "Sync", [
          item("f20", "feature", "Offline sync", [
            item("t20", "task", "Write the sync"),
            item("t21", "task", "Retry failed syncs", [], { status: "pending" }),
          ], { status: "pending" }),
          item("f21", "feature", "Sync conflicts", [item("t26", "task", "Merge edits", [], { status: "pending" })], { status: "pending" }),
          item("f24", "feature", "Sync log", [item("t24", "task", "Log each sync")]),
        ]),
        item("e7", "epic", "Sharing", [
          item("f22", "feature", "Shared folders", [
            item("t22", "task", "Share a folder", [], { status: "pending", blockedBy: ["f20"] }),
            item("t23", "task", "Share a sync", [], { status: "pending", blockedBy: ["e6"] }),
            item("t25", "task", "Share the log", [], { status: "pending", blockedBy: ["f24"] }),
          ], { status: "pending" }),
        ]),
      ];
      /** The rules plan, with t21's placement withheld as a model pass or person would. */
      const heldPlan = async (): Promise<V1ToV2Plan> => {
        const plan = await planOf(HELD);
        delete plan.entries.t21!.placement;
        plan.entries.t21!.needsPlacement = true;
        return plan;
      };

      it("names the held changes instead of dropping the ref as met", async () => {
        const { tree, blockers, cut } = buildV2Tree(HELD, await heldPlan());
        expect(byId(tree, "f20")).toMatchObject({ type: "capability" });
        expect(byId(tree, "t22")!.blockedBy).toEqual(["t21"]);
        expect(byId(tree, "t23")!.blockedBy!.sort()).toEqual(["f21", "t21"]);
        expect(blockers).toContainEqual({ kind: "requirement", node: "t22", from: "f20", to: ["t21"] });
        const body = byId(tree, cut)!.body as string;
        expect(body).toContain("- t22: blockedBy f20 → t21");
      });

      it("still drops a ref to a met product node as met", async () => {
        const { tree, blockers, cut } = buildV2Tree(HELD, await heldPlan());
        expect(computeProductStatus(tree).f24!.status).toBe("met");
        expect(byId(tree, "t25")!.blockedBy).toBeUndefined();
        expect(blockers).toContainEqual({ kind: "requirement", node: "t25", from: "f24", to: [] });
        expect(byId(tree, cut)!.body as string).toContain("- t25: blockedBy f24 → dropped (no open change: met)");
      });

      it("leaves the held changes in the Inbox with no target", async () => {
        const { tree } = buildV2Tree(HELD, await heldPlan());
        for (const id of ["t21", "f21"]) {
          const node = byId(tree, id)!;
          expect(node).toMatchObject({ type: "change", needsPlacement: true });
          expect(node.touches).toBeUndefined();
          expect(node.amends).toBeUndefined();
          expect(tree.changes).toContain(node);
        }
      });
    });

    it("leaves no blockedBy ref the v2 rules reject", async () => {
      const { tree } = buildV2Tree(ITEMS, await planOf(ITEMS));
      const work = new Set(all(tree).filter((n) => n.type === "change" || n.type === "task" || n.type === "subtask").map((n) => n.id));
      for (const node of all(tree)) for (const ref of node.blockedBy ?? []) expect(work.has(ref)).toBe(true);
    });
  });

  it("starts capabilities met or proposed, never revised", async () => {
    const { tree } = buildV2Tree(TREE, await planOf(TREE));
    const statuses = Object.values(computeProductStatus(tree)).map((s) => s.status);
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses).not.toContain("revised");
    expect(computeProductStatus(tree).f1!.status).toBe("met");
  });

  it("stamps a met capability's metAt from the spec it writes, not the plan's rules-stage hash", async () => {
    const plan = await planOf(TREE);
    const planned = Object.entries(plan.entries).filter(([, e]) => e.data?.metAt !== undefined);
    expect(planned.length).toBeGreaterThan(0);
    // Unchanged since the rules stage: the two hashes agree.
    const { tree } = buildV2Tree(TREE, plan);
    for (const [id, entry] of planned) expect(byId(tree, id)!.metAt).toBe(entry.data!.metAt);

    // A later pass redrafted the spec, so the plan's metAt is stale; the node must still read met.
    for (const [, entry] of planned) entry.spec = { ...entry.spec!, statement: `${entry.spec!.statement ?? ""} Redrafted.` };
    const redrafted = buildV2Tree(TREE, plan).tree;
    for (const [id, entry] of planned) {
      const node = byId(redrafted, id)!;
      expect(node.metAt).toBe(specHash(nodeSpec(node)));
      expect(node.metAt).not.toBe(entry.data!.metAt);
      expect(computeProductStatus(redrafted)[id]!.status).toBe("met");
    }
  });

  it("records the cut as an applied change that adds every product requirement", async () => {
    const { tree, cut } = buildV2Tree(TREE, await planOf(TREE));
    const node = byId(tree, cut)!;
    expect(node).toMatchObject({ type: "change", title: CUT_CHANGE_TITLE, appliedAt: CUT_AT, status: "completed" });
    expect(isAppliedChange(node)).toBe(true);
    expect(node.amends).toEqual([expect.objectContaining({ target: "f1", delta: "added", under: "e1" })]);
    expect(node.body).not.toContain("Review findings (e2)");
    expect(node.body).toContain("ndx 0.9.0 (e3): plannedRelease 0.9.0");
  });

  it("sends items made after the plan to the Inbox, or under their v1 parent's work", async () => {
    const plan = await planOf(TREE);
    const newer = structuredClone(TREE);
    newer.push(item("e9", "epic", "Brand new epic", [item("f9", "feature", "Its feature")], { status: "pending" }));
    newer[0]!.children![0]!.children![0]!.children!.push(item("s9", "subtask", "Another subtask"));
    const built = buildV2Tree(newer, plan);
    expect(built.late.sort()).toEqual(["e9", "f9", "s9"]);
    expect(byId(built.tree, "e9")).toMatchObject({ type: "change", needsPlacement: true });
    expect(byId(built.tree, "e9")!.children!.map((c) => [c.id, c.type])).toEqual([["f9", "task"]]);
    expect(byId(built.tree, "t1")!.children!.map((c) => c.id).sort()).toEqual(["s1", "s9"]);
    expect(isLossless(everyV1Id(newer, built.tree, built.containers, built.cut))).toBe(true);
  });

  describe("v1 work completed between plan and apply, held in the Inbox", () => {
    const AFTER_CUT = "2026-10-13T00:00:00.000Z";
    const placedAtClose = (tree: V2Tree) => checkV2Rules(tree, { now: new Date("2026-10-20T00:00:00.000Z") }, ["change-placed-at-close"]);

    /** The tree planned at CUT_AT, then held f4 completed in v1 after it. */
    const completedAfterPlan = async () => {
      const plan = await planOf(TREE);
      expect(plan.entries.f4).toMatchObject({ target: "change", needsPlacement: true });
      const newer = structuredClone(TREE);
      const f4 = newer[0]!.children!.find((c) => c.id === "f4")!;
      Object.assign(f4, { status: "completed", completedAt: AFTER_CUT });
      Object.assign(f4.children![0]!, { status: "completed", completedAt: AFTER_CUT });
      return buildV2Tree(newer, plan);
    };

    it("is listed by the cut and warned about, so rex health passes", async () => {
      const { tree, cut } = await completedAfterPlan();
      expect(byId(tree, "f4")).toMatchObject({ needsPlacement: true, appliedAt: AFTER_CUT });
      expect(byId(tree, cut)!.body).toContain(`${CUT_HELD_AFTER_CUT_HEADING}\n\n- Cache eviction (f4)`);
      const findings = placedAtClose(tree);
      expect(findings.map((f) => [f.nodeId, f.severity])).toContainEqual(["f4", "warning"]);
      expect(findings.filter((f) => f.severity === "error")).toEqual([]);
      expect(findings.find((f) => f.nodeId === "f4")!.message).toContain("closed in v1 before the migration was applied");
    });

    it("still errors on a held change completed in v2 after apply", async () => {
      const { tree } = await completedAfterPlan();
      const v2 = { id: "c-v2", type: "change", title: "Closed in v2", slug: "closed-in-v2", needsPlacement: true, status: "completed", completedAt: "2026-10-14T00:00:00.000Z" } as RuleNode;
      tree.changes.push(v2);
      const findings = placedAtClose(tree);
      expect(findings.find((f) => f.nodeId === "c-v2")).toMatchObject({ severity: "error" });
      expect(findings.find((f) => f.nodeId === "f4")).toMatchObject({ severity: "warning" });
    });

    it("leaves the cut's list out when nothing closed after the cut", async () => {
      const { tree, cut } = buildV2Tree(TREE, await planOf(TREE));
      expect(byId(tree, cut)!.body).not.toContain(CUT_HELD_AFTER_CUT_HEADING);
    });

    it("keeps the cut's container list readable after the held list", async () => {
      const { tree, containers } = await completedAfterPlan();
      expect(cutContainerIds(tree)).toEqual(containers.map((c) => c.id));
    });
  });

  it("re-fits a planned item whose parent is gone, and reports plan entries no longer in the tree", async () => {
    const plan = await planOf(TREE);
    const moved = structuredClone(TREE);
    // f1 (a capability) is deleted; its history t1 and the subtask follow the plan without it.
    const storage = moved[0]!;
    storage.children = storage.children!.filter((c) => c.id !== "f1");
    storage.children.push(item("t1", "task", "Write the cache", [item("s1", "subtask", "Pick a format")]));
    const built = buildV2Tree(moved, plan);
    expect(built.gone).toEqual(["f1"]);
    expect(byId(built.tree, "t1")).toMatchObject({ type: "change", needsPlacement: true });
    expect(isLossless(everyV1Id(moved, built.tree, built.containers, built.cut))).toBe(true);
  });
});

describe("applyV1ToV2", () => {
  let repo: string;
  let rexDir: string;
  const store = () => new FileStore(rexDir);
  const load = () => store().loadDocument();

  beforeEach(async () => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), "rex-migrate-apply-")));
    rexDir = join(repo, ".rex");
    mkdirSync(rexDir);
    writeFileSync(join(rexDir, "config.json"), JSON.stringify({ schema: "rex/v1", project: "shop", adapter: "file" }));
    await store().saveDocument({ schema: "rex/v1", title: "Shop", items: TREE });
  });

  afterEach(() => {
    readBack.skip = false;
    readBack.lose = undefined;
    rmSync(repo, { recursive: true });
  });

  it("writes the v2 tree and removes prd_tree/ and tree-meta.json in the same transaction", async () => {
    const plan = await planOf((await load()).items);
    expect(existsSync(join(rexDir, "tree-meta.json"))).toBe(true);
    const outcome = await applyV1ToV2(rexDir, plan, { load });

    expect(outcome.status).toBe("applied");
    expect(existsSync(join(rexDir, "prd_tree"))).toBe(false);
    expect(existsSync(join(rexDir, "tree-meta.json"))).toBe(false);
    expect(existsSync(join(rexDir, STAGING_DIRNAME))).toBe(false);
    const model = await loadPrdModel(rexDir);
    expect(model).toMatchObject({ layout: "v2", title: "Shop" });
    expect(model.warnings).toEqual([]);
    if (outcome.status !== "applied") return;
    expect(isLossless(everyV1Id(TREE, model.tree, outcome.built.containers, outcome.built.cut))).toBe(true);
    expect(outcome.v1Items).toBe(walkItems(TREE).length);
  });

  it("keeps a release epic's description, criteria and blockedBy through the write and read-back", async () => {
    await store().saveDocument({ schema: "rex/v1", title: "Shop", items: structuredClone([...TREE, ...RELEASES]) });
    const outcome = await applyV1ToV2(rexDir, await planOf((await load()).items), { load });
    expect(outcome.status).toBe("applied");
    if (outcome.status !== "applied") return;
    const { tree } = await loadPrdModel(rexDir);
    expect(byId(tree, outcome.built.cut)!.body).toContain(R12_CUT_LINES);
    expect(byId(tree, "g3")!.blockedBy).toEqual(["g1", "g2"]);
  });

  it("stores held changes in the reserved Inbox folder", async () => {
    const plan = await planOf((await load()).items);
    await applyV1ToV2(rexDir, plan, { load });
    const model = await loadPrdModel(rexDir);
    const held = model.tree.changes.filter((n) => n.needsPlacement);
    expect(held.length).toBeGreaterThan(0);
    for (const node of held) expect(existsSync(join(rexDir, "changes", "inbox", node.slug, "index.md"))).toBe(true);
  });

  it("round-trips: what it writes reads back and writes byte-identically", async () => {
    const plan = await planOf((await load()).items);
    await applyV1ToV2(rexDir, plan, { load });
    const before = snapshot(rexDir);
    const model = await loadPrdModel(rexDir);
    const { withPrdModelTransaction } = await import("../../../../src/store/prd-model-transaction.js");
    const { written } = await withPrdModelTransaction(rexDir, (m) => ({ tree: m.tree, result: null }));
    expect(written.written).toEqual([]);
    expect(snapshot(rexDir)).toEqual(before);
    expect(model.tree.changes.some((n) => n.title === CUT_CHANGE_TITLE && isAppliedChange(n))).toBe(true);
  });

  it.each([
    ["prd.json", "{}"],
    ["prd.md", "# Shop\n"],
    ["prd_main_2026-01-01.json", "{}"],
  ])("refuses, writing nothing, while legacy %s sits beside the tree", async (name, body) => {
    const plan = await planOf((await load()).items);
    writeFileSync(join(rexDir, name), body);
    const before = snapshot(rexDir);
    await expect(applyV1ToV2(rexDir, plan, { load })).rejects.toThrow(/Legacy PRD source.*Nothing was written/s);
    await expect(rehearseV1ToV2(rexDir, plan, { load })).rejects.toThrow(MigrationApplyError);
    expect(snapshot(rexDir)).toEqual(before);
    expect(existsSync(join(rexDir, "product"))).toBe(false);
  });

  it("refuses a prd.json even beside a prd.json.migrated marker, which the v1 read fallback ignores", async () => {
    const plan = await planOf((await load()).items);
    writeFileSync(join(rexDir, "prd.json.migrated"), "{}");
    writeFileSync(join(rexDir, "prd.json"), "{}");
    await expect(applyV1ToV2(rexDir, plan, { load })).rejects.toThrow(/prd\.json\. Applying/);
    expect(existsSync(join(rexDir, "prd_tree"))).toBe(true);
  });

  it("applies when only a prd.json.migrated marker is left", async () => {
    const plan = await planOf((await load()).items);
    writeFileSync(join(rexDir, "prd.json.migrated"), "{}");
    expect((await applyV1ToV2(rexDir, plan, { load })).status).toBe("applied");
  });

  it("leaves no way for a PRD-touching command to recreate prd_tree/ after apply", async () => {
    const plan = await planOf((await load()).items);
    await applyV1ToV2(rexDir, plan, { load });
    const { ensureLegacyPrdMigrated } = await import("../../../../src/store/ensure-legacy-prd-migrated.js");
    expect((await ensureLegacyPrdMigrated(repo)).migrated).toBe(false);
    expect(existsSync(join(rexDir, "prd_tree"))).toBe(false);
  });

  it("is a no-op on the migrated tree", async () => {
    const plan = await planOf((await load()).items);
    await applyV1ToV2(rexDir, plan, { load });
    const before = snapshot(rexDir);
    expect(await applyV1ToV2(rexDir, plan, { load })).toEqual({ status: "already-v2", removed: [] });
    expect(await applyV1ToV2(rexDir, undefined, { load })).toEqual({ status: "already-v2", removed: [] });
    expect(snapshot(rexDir)).toEqual(before);
  });

  it("finishes an apply interrupted after the switch by removing the v1 files left beside the v2 tree", async () => {
    const plan = await planOf((await load()).items);
    const v1 = snapshot(rexDir);
    await applyV1ToV2(rexDir, plan, { load });
    for (const [path, text] of Object.entries(v1)) {
      if (!path.startsWith("/prd_tree") && path !== "/tree-meta.json") continue;
      mkdirSync(join(rexDir, path, ".."), { recursive: true });
      writeFileSync(join(rexDir, path), text);
    }
    const outcome = await applyV1ToV2(rexDir, plan, { load });
    expect(outcome).toEqual({ status: "already-v2", removed: [join(rexDir, "prd_tree"), join(rexDir, "tree-meta.json")], proof: "plan" });
    expect(existsSync(join(rexDir, "prd_tree"))).toBe(false);
  });

  describe("a failed removal after the switch", () => {
    afterEach(() => {
      fsFaults.failRm = undefined;
    });

    it("says the v2 tree is in place, names the leftover and asks for a re-run, which removes it", async () => {
      const plan = await planOf((await load()).items);
      const clean = join(repo, "clean-rex");
      for (const [path, text] of Object.entries(snapshot(rexDir))) {
        mkdirSync(join(clean, path, ".."), { recursive: true });
        writeFileSync(join(clean, path), text);
      }
      await applyV1ToV2(clean, plan, { load: () => new FileStore(clean).loadDocument() });

      fsFaults.failRm = "/prd_tree";
      const message = await applyV1ToV2(rexDir, plan, { load }).then(
        () => "applied",
        (err: unknown) => (err instanceof MigrationApplyError ? err.message : `unexpected: ${String(err)}`),
      );
      expect(message).toContain("The v2 tree is in place");
      expect(message).toContain("EBUSY");
      expect(message).toContain(`Left: ${join(rexDir, "prd_tree")}.`);
      expect(message).toContain("Run ndx migrate --apply again");
      expect(existsSync(join(rexDir, "product"))).toBe(true);
      expect(existsSync(join(rexDir, "tree-meta.json"))).toBe(false);

      fsFaults.failRm = undefined;
      expect(await applyV1ToV2(rexDir, plan, { load })).toEqual({ status: "already-v2", removed: [join(rexDir, "prd_tree")], proof: "plan" });
      expect(snapshot(rexDir)).toEqual(snapshot(clean));
    });
  });

  describe("a prd_tree/ beside the v2 tree", () => {
    const NEW_EPIC = "11111111-1111-4111-8111-111111111111";
    const withNewEpic = (): PRDItem[] => [...TREE, item(NEW_EPIC, "epic", "Billing", [], { status: "pending" })];

    /** Write `items` as a v1 tree in a scratch rex dir and copy its prd_tree/ and tree-meta.json beside the v2 tree. */
    async function restoreV1(items: PRDItem[]): Promise<void> {
      const scratch = join(repo, "scratch-rex");
      mkdirSync(scratch);
      await new FileStore(scratch).saveDocument({ schema: "rex/v1", title: "Shop", items });
      for (const [path, text] of Object.entries(snapshot(scratch))) {
        if (!path.startsWith("/prd_tree") && path !== "/tree-meta.json") continue;
        mkdirSync(join(rexDir, path, ".."), { recursive: true });
        writeFileSync(join(rexDir, path), text);
      }
      rmSync(scratch, { recursive: true });
    }

    async function migrated(): Promise<V1ToV2Plan> {
      const plan = await planOf((await load()).items);
      await applyV1ToV2(rexDir, plan, { load });
      return plan;
    }

    it.each([
      ["a plan whose source differs", true],
      ["no plan", false],
    ])("holding an item the v2 tree lacks is refused and kept, with %s, naming the item", async (_label, withPlan) => {
      const plan = await migrated();
      await restoreV1(withNewEpic());
      const before = snapshot(rexDir);
      const given = withPlan ? plan : undefined;
      await expect(applyV1ToV2(rexDir, given, { load })).rejects.toThrow(MigrationApplyError);
      await expect(applyV1ToV2(rexDir, given, { load })).rejects.toThrow(new RegExp(`${NEW_EPIC}.*Kept`, "s"));
      expect(snapshot(rexDir)).toEqual(before);
      expect(existsSync(join(rexDir, "prd_tree"))).toBe(true);
      expect(existsSync(join(rexDir, "tree-meta.json"))).toBe(true);
      // The dry run says apply would refuse, the same way.
      await expect(rehearseV1ToV2(rexDir, given, { load })).rejects.toThrow(new RegExp(`${NEW_EPIC}.*Kept`, "s"));
    });

    it("whose items were edited since the plan is refused and kept, though every id is in the v2 tree", async () => {
      const plan = await migrated();
      const edited = structuredClone(TREE);
      edited[0]!.title = "Storage, renamed after the cut";
      await restoreV1(edited);
      await expect(applyV1ToV2(rexDir, plan, { load })).rejects.toThrow(/differs from the tree the plan was made from.*Kept/s);
      expect(existsSync(join(rexDir, "prd_tree"))).toBe(true);
    });

    it("is removed with no plan when every id it holds is in the v2 tree, dissolved containers included", async () => {
      await migrated();
      await restoreV1(TREE);
      expect(await rehearseV1ToV2(rexDir, undefined, { load })).toEqual({
        status: "already-v2",
        removed: [join(rexDir, "prd_tree"), join(rexDir, "tree-meta.json")],
        proof: "ids",
      });
      expect(await applyV1ToV2(rexDir, undefined, { load })).toEqual({
        status: "already-v2",
        removed: [join(rexDir, "prd_tree"), join(rexDir, "tree-meta.json")],
        proof: "ids",
      });
      expect(existsSync(join(rexDir, "prd_tree"))).toBe(false);
    });

    it("that matches the plan's source is what the dry run says apply would remove", async () => {
      const plan = await migrated();
      await restoreV1(TREE);
      expect(await rehearseV1ToV2(rexDir, plan, { load })).toEqual({
        status: "already-v2",
        removed: [join(rexDir, "prd_tree"), join(rexDir, "tree-meta.json")],
        proof: "plan",
      });
      expect(existsSync(join(rexDir, "prd_tree"))).toBe(true);
    });
  });

  it("clears a changes/ an apply interrupted before the switch left, and applies", async () => {
    const plan = await planOf((await load()).items);
    mkdirSync(join(rexDir, "changes", "half-moved"), { recursive: true });
    writeFileSync(join(rexDir, "changes", "half-moved", "index.md"), "---\nid: x\n---\n");
    mkdirSync(join(rexDir, STAGING_DIRNAME, "product"), { recursive: true });
    await applyV1ToV2(rexDir, plan, { load });
    expect(existsSync(join(rexDir, "changes", "half-moved"))).toBe(false);
    expect(existsSync(join(rexDir, STAGING_DIRNAME))).toBe(false);
  });

  it("writes nothing when the v2 tree cannot be written", async () => {
    const items = structuredClone(TREE);
    // A change whose loe is neither weeks nor a legacy bucket fails the v2 intent check.
    items[1]!.children![0]!.loe = "a lot" as never;
    await store().saveDocument({ schema: "rex/v1", title: "Shop", items });
    const plan = await planOf((await load()).items);
    const before = snapshot(rexDir);
    await expect(applyV1ToV2(rexDir, plan, { load })).rejects.toThrow();
    expect(snapshot(rexDir)).toEqual(before);
  });

  it("refuses a tree that reads back without a v1 id, and writes nothing", async () => {
    const plan = await planOf((await load()).items);
    const before = snapshot(rexDir);
    readBack.lose = "s1";
    const message = /Not every v1 id is in the v2 tree read back, of \d+ items: missing 1 \(s1\)\. Nothing was written\./;
    await expect(applyV1ToV2(rexDir, plan, { load })).rejects.toThrow(message);
    await expect(rehearseV1ToV2(rexDir, plan, { load })).rejects.toThrow(message);
    expect(snapshot(rexDir)).toEqual(before);
  });

  it("counts the v2 rule findings on the tree it wrote by rule, as rex health finds them", async () => {
    const plan = await planOf((await load()).items);
    const rehearsal = await rehearseV1ToV2(rexDir, plan, { load });
    const outcome = await applyV1ToV2(rexDir, plan, { load });
    if (rehearsal.status !== "rehearsed" || outcome.status !== "applied") throw new Error("expected a rehearsal and an apply");

    const findings = checkV2TreeHealth((await loadPrdModel(rexDir)).tree);
    expect(findings.length).toBeGreaterThan(0);
    const rules = [...new Set(findings.map((f) => f.rule))];
    const count = (rule: string, severity: string): number => findings.filter((f) => f.rule === rule && f.severity === severity).length;
    expect([...outcome.rules].sort((a, b) => a.rule.localeCompare(b.rule))).toEqual(
      rules.sort().map((rule) => ({ rule, errors: count(rule, "error"), warnings: count(rule, "warning") })),
    );
    expect(rehearsal.rules).toEqual(outcome.rules);
  });

  it("refuses a v1 tree that holds an id twice, and writes nothing", async () => {
    const plan = await planOf((await load()).items);
    const before = snapshot(rexDir);
    const loadWithDuplicate = async () => {
      const doc = await load();
      doc.items[0]!.children!.push(item("t1", "task", "A second item with t1's id"));
      return doc;
    };
    await expect(applyV1ToV2(rexDir, plan, { load: loadWithDuplicate })).rejects.toThrow(/holds 1 id more than once \(t1\)/);
    expect(snapshot(rexDir)).toEqual(before);
  });

  describe("rehearseV1ToV2", () => {
    it("writes nothing, not even the lock", async () => {
      const plan = await planOf((await load()).items);
      const before = snapshot(rexDir);
      const entries = readdirSync(rexDir).sort();
      const outcome = await rehearseV1ToV2(rexDir, plan, { load });
      expect(outcome.status).toBe("rehearsed");
      expect(snapshot(rexDir)).toEqual(before);
      expect(readdirSync(rexDir).sort()).toEqual(entries);
    });

    it("reports the files it wrote to a temporary directory and removes the directory", async () => {
      const plan = await planOf((await load()).items);
      // A private temp root, so another process's rehearsal cannot make this pass or fail.
      const scratchRoot = join(repo, "tmp");
      mkdirSync(scratchRoot);
      const vars = ["TMPDIR", "TEMP", "TMP"] as const;
      const saved = vars.map((v) => process.env[v]);
      for (const v of vars) process.env[v] = scratchRoot;
      let outcome: Awaited<ReturnType<typeof rehearseV1ToV2>>;
      try {
        expect(tmpdir()).toBe(scratchRoot);
        outcome = await rehearseV1ToV2(rexDir, plan, { load });
      } finally {
        vars.forEach((v, i) => (saved[i] === undefined ? delete process.env[v] : (process.env[v] = saved[i])));
      }
      if (outcome.status !== "rehearsed") throw new Error("expected a rehearsal");
      expect(outcome.files).toBeGreaterThan(0);
      expect(readdirSync(scratchRoot)).toEqual([]);
    });

    it("refuses a model that does not read back, as apply does, and writes nothing under the project", async () => {
      const plan = await planOf((await load()).items);
      const before = snapshot(rexDir);
      const entries = readdirSync(rexDir).sort();
      readBack.skip = true;
      const message = /The written v2 tree does not read back: product\/area\/index\.md: unreadable\. Nothing was written\./;
      await expect(rehearseV1ToV2(rexDir, plan, { load })).rejects.toThrow(message);
      await expect(applyV1ToV2(rexDir, plan, { load })).rejects.toThrow(message);
      expect(snapshot(rexDir)).toEqual(before);
      expect(readdirSync(rexDir).sort()).toEqual(entries);
    });

    it("counts per kind what becomes each v2 type, summing to the v1 total", async () => {
      const plan = await planOf((await load()).items);
      const outcome = await rehearseV1ToV2(rexDir, plan, { load });
      if (outcome.status !== "rehearsed") throw new Error("expected a rehearsal");
      const total = V1_KINDS.reduce((n, k) => n + outcome.kinds[k].total, 0);
      expect(total).toBe(walkItems(TREE).length);
      for (const kind of V1_KINDS) {
        const t = outcome.kinds[kind];
        expect(Object.values(t.become).reduce((n, c) => n + c, 0)).toBe(t.total);
      }
      // e1 and the review-sourced e2 are areas; e3 is a release umbrella.
      expect(outcome.kinds.epic.become).toMatchObject({ area: 2, release: 1 });
      // Held changes are the Inbox changes the real apply writes.
      const held = V1_KINDS.reduce((n, k) => n + outcome.kinds[k].held, 0);
      expect(held).toBe(outcome.built.inbox);
    });

    it("counts dropped metadata and log values", async () => {
      const tree = structuredClone(TREE);
      tree[0]!.children![0]!.recommendationMeta = { a: "[object Object]", b: "ok" } as never;
      tree[0]!.children![0]!.children![0]!.log = ["[object Object]", "[object Object]", "kept"] as never;
      const plan = await planOf(tree);
      const outcome = await rehearseV1ToV2(rexDir, plan, { load: async () => ({ title: "Shop", items: tree }) });
      if (outcome.status !== "rehearsed") throw new Error("expected a rehearsal");
      expect(outcome.kinds.feature.droppedMeta).toBe(1);
      expect(outcome.kinds.task.droppedLog).toBe(2);
      expect(outcome.kinds.epic).toMatchObject({ droppedMeta: 0, droppedLog: 0 });
    });

    it("refuses what apply refuses: a plan whose model pass stopped, and no plan", async () => {
      const plan = await planOf((await load()).items);
      const stopped: PlanFile = { ...plan, header: { ...plan.header, passes: [...plan.header.passes, { name: "text", model: "m", incomplete: { error: "rate limited" } }] } };
      await expect(rehearseV1ToV2(rexDir, stopped, { load })).rejects.toThrow(/text pass stopped \(rate limited\)/);
      await expect(rehearseV1ToV2(rexDir, undefined, { load })).rejects.toThrow(MigrationApplyError);
    });

    it("on a migrated tree reports nothing to apply and lists what apply would remove", async () => {
      const plan = await planOf((await load()).items);
      await applyV1ToV2(rexDir, plan, { load });
      mkdirSync(join(rexDir, "prd_tree"));
      const outcome = await rehearseV1ToV2(rexDir, plan, { load });
      expect(outcome).toEqual({ status: "already-v2", removed: [join(rexDir, "prd_tree")], proof: "empty" });
      expect(existsSync(join(rexDir, "prd_tree"))).toBe(true);
    });
  });

  it("refuses a plan whose model pass stopped, and writes nothing", async () => {
    const plan = await planOf((await load()).items);
    const stopped: PlanFile = { ...plan, header: { ...plan.header, passes: [...plan.header.passes, { name: "text", model: "m", incomplete: { error: "rate limited" } }] } };
    const before = snapshot(rexDir);
    await expect(applyV1ToV2(rexDir, stopped, { load })).rejects.toThrow(MigrationApplyError);
    await expect(applyV1ToV2(rexDir, stopped, { load })).rejects.toThrow(/text pass stopped \(rate limited\)/);
    expect(snapshot(rexDir)).toEqual(before);
  });
});

function walkItems(items: readonly PRDItem[], out: PRDItem[] = []): PRDItem[] {
  for (const i of items) {
    out.push(i);
    walkItems(i.children ?? [], out);
  }
  return out;
}
