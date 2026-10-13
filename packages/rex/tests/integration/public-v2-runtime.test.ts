/**
 * The v2 runtime as hench (stack B) and the dashboard (D1) see it: every
 * import comes from `src/public.ts`, nothing deeper, exercised against the v2
 * fixture copied to a temp dir.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  prdLayout,
  loadPrdModel,
  withPrdModelTransaction,
  PrdLayoutError,
  findNextWork,
  findActionableWork,
  resolveWorkById,
  enclosingChangeIds,
  findNextWorkTask,
  completedWorkIds,
  completeTask,
  completeChange,
  completeWork,
  loadApplyOn,
  completeV2Work,
  buildChangeBrief,
  renderChangeBrief,
  resolveStore,
  PRD_TREE_DIRNAME,
  ChangeLayerStore,
  isChangeLayerStore,
  type PrdModel,
  type WorkUnit,
  type V2Tree,
} from "../../src/public.js";
import { copyV2Fixture } from "../helpers/v2-fixture.js";

const CHANGE = "c0000000-0000-4000-8000-000000000001";
const TASK = "c0000000-0000-4000-8000-000000000002";
const V1_FIXTURE = resolve(import.meta.dirname, "../fixtures/folder-tree/known-prd");
const NOW = new Date("2026-10-12T00:00:00.000Z");
const OPTS = { applyOn: "review" as const, appliedAt: NOW.toISOString(), now: NOW };
const quiet ={ env: {}, warn: () => {} };

let tmp: string;
let rexDir: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "rex-public-v2-"));
  rexDir = await copyV2Fixture(join(tmp, ".rex"), "lf");
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function tree(): Promise<V2Tree> {
  return (await loadPrdModel(rexDir, quiet)).tree;
}

describe("v2 runtime exported from public.ts", () => {
  it("prdLayout and loadPrdModel read the v2 layout", async () => {
    expect(await prdLayout(rexDir)).toBe("v2");
    const model: PrdModel = await loadPrdModel(rexDir, quiet);
    expect(model.layout).toBe("v2");
    expect(model.tree.changes.length).toBeGreaterThan(0);
  });

  it("findNextWork, findActionableWork and resolveWorkById select the fixture's task", async () => {
    const t = await tree();
    const unit: WorkUnit | null = findNextWork(t);
    expect(unit?.node.id).toBe(TASK);
    expect(unit?.change.id).toBe(CHANGE);
    expect(findActionableWork(t).map((u) => u.node.id)).toContain(TASK);
    expect(resolveWorkById(t, TASK)?.node.id).toBe(TASK);
    expect(findNextWork(t, { excludeIds: new Set([TASK]) })?.node.id).not.toBe(TASK);
  });

  it("enclosingChangeIds names the changes whose claim covers a task", async () => {
    const t = await tree();
    expect(enclosingChangeIds(t, TASK)).toEqual([CHANGE]);
    expect(enclosingChangeIds(t, CHANGE)).toEqual([]);
    expect(enclosingChangeIds(t, "no-such-ref")).toEqual([]);
  });

  it("findNextWorkTask answers in v1 item shape; completedWorkIds starts empty", async () => {
    const t = await tree();
    const next = findNextWorkTask(t);
    expect(next?.item.id).toBe(TASK);
    expect(next?.parents.map((p) => p.id)).toEqual([CHANGE]);
    expect(completedWorkIds(t).size).toBe(0);
  });

  it("buildChangeBrief and renderChangeBrief brief the selected unit", async () => {
    const t = await tree();
    const unit = findNextWork(t)!;
    const brief = buildChangeBrief({ tree: t, unit });
    expect(brief.sections.length).toBeGreaterThan(0);
    expect(renderChangeBrief({ tree: t, unit })).toContain("Wire the button");
  });

  it("completeTask completes the task, leaves the in_progress change open, and does not mutate the input", async () => {
    const t = await tree();
    const result = completeTask(t, TASK, OPTS);
    expect(result.completed).toEqual([TASK]);
    expect(result.tree).not.toBe(t);
    expect(completedWorkIds(t).size).toBe(0);
    expect(completedWorkIds(result.tree)).toEqual(new Set([TASK]));
  });

  it("completeChange and completeWork complete a change", async () => {
    const t = await tree();
    expect(completeWork(t, TASK, OPTS).changeId).toBe(CHANGE);
    const taskDone = completeTask(t, TASK, OPTS);
    expect(completeChange(taskDone.tree, CHANGE, OPTS).completed).toContain(CHANGE);
  });

  it("withPrdModelTransaction writes under the lock and refuses a v1 tree", async () => {
    const { result } = await withPrdModelTransaction(rexDir, (model) => ({
      tree: completeTask(model.tree, TASK, OPTS).tree,
      result: "done",
    }));
    expect(result).toBe("done");
    expect(completedWorkIds(await tree()).has(TASK)).toBe(true);

    const v1Dir = join(tmp, "v1", ".rex");
    await cp(V1_FIXTURE, join(v1Dir, PRD_TREE_DIRNAME), { recursive: true });
    expect(await prdLayout(v1Dir)).toBe("v1");
    await expect(withPrdModelTransaction(v1Dir, (model) => ({ tree: model.tree, result: 0 }))).rejects.toBeInstanceOf(PrdLayoutError);
  });

  it("loadApplyOn defaults to complete; completeV2Work completes through a resolved store", async () => {
    await writeFile(join(rexDir, "config.json"), JSON.stringify({ schema: "rex/v1", project: "t", adapter: "file" }));
    expect((await loadApplyOn(rexDir)).applyOn).toBe("complete");
    const store = await resolveStore(rexDir);
    expect(isChangeLayerStore(store)).toBe(true);
    expect(store).toBeInstanceOf(ChangeLayerStore);
    const taskDone = await completeV2Work(store as ChangeLayerStore, TASK);
    expect(taskDone.changeId).toBe(CHANGE);
    expect(taskDone.changeCompleted).toBe(false);
    expect(completedWorkIds(await tree()).has(TASK)).toBe(true);
    const changeDone = await completeV2Work(store as ChangeLayerStore, CHANGE);
    expect(changeDone.changeCompleted).toBe(true);
    expect(completedWorkIds(await tree()).has(CHANGE)).toBe(true);
  });
});
