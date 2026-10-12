import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeProductStatus } from "../../../../src/core/product-status.js";
import { isLossless } from "../../../../src/core/slug-migration.js";
import type { PRDItem } from "../../../../src/schema/v1.js";
import { isAppliedChange, type RuleNode, type V2Tree } from "../../../../src/schema/v2-rules.js";
import { FileStore } from "../../../../src/store/index.js";
import { loadPrdModel } from "../../../../src/store/prd-model-reader.js";
import type { PlanFile } from "../../../../src/migrations/plan-file.js";
import { v1ToV2, v1TreeSource } from "../../../../src/migrations/v1-to-v2/index.js";
import {
  CUT_CHANGE_TITLE,
  STAGING_DIRNAME,
  applyV1ToV2,
  buildV2Tree,
  everyV1Id,
  MigrationApplyError,
  type V1ToV2Plan,
} from "../../../../src/migrations/v1-to-v2/apply.js";

const CUT_AT = "2026-10-12T00:00:00.000Z";

const item = (id: string, level: PRDItem["level"], title: string, children: PRDItem[] = [], extra: Partial<PRDItem> = {}): PRDItem => ({
  id,
  level,
  title,
  status: "completed",
  children,
  ...extra,
});

/** Areas, a capability with history, an unbuilt feature (held), a release umbrella and a review container. */
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
    expect(built.containers.map((c) => c.id).sort()).toEqual(["e2", "e3"]);
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

  it("stamps a release umbrella's plannedRelease, never a review container's", async () => {
    const { tree } = buildV2Tree(TREE, await planOf(TREE));
    expect(byId(tree, "f5")!.plannedRelease).toBe("0.9.0");
    expect(byId(tree, "f3")!.plannedRelease).toBeUndefined();
    expect(byId(tree, "e2")).toBeUndefined();
  });

  it("starts capabilities met or proposed, never revised", async () => {
    const { tree } = buildV2Tree(TREE, await planOf(TREE));
    const statuses = Object.values(computeProductStatus(tree)).map((s) => s.status);
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses).not.toContain("revised");
    expect(computeProductStatus(tree).f1!.status).toBe("met");
  });

  it("records the cut as an applied change that adds every product requirement", async () => {
    const { tree, cut } = buildV2Tree(TREE, await planOf(TREE));
    const node = byId(tree, cut)!;
    expect(node).toMatchObject({ type: "change", title: CUT_CHANGE_TITLE, appliedAt: CUT_AT, status: "completed" });
    expect(isAppliedChange(node)).toBe(true);
    expect(node.amends).toEqual([expect.objectContaining({ target: "f1", delta: "added", under: "e1" })]);
    expect(node.body).toContain("Review findings (e2)");
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

  afterEach(() => rmSync(repo, { recursive: true }));

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
    expect(outcome).toEqual({ status: "already-v2", removed: [join(rexDir, "prd_tree"), join(rexDir, "tree-meta.json")] });
    expect(existsSync(join(rexDir, "prd_tree"))).toBe(false);
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
