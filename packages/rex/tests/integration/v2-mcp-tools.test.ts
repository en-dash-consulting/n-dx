/**
 * The rex MCP tools on a v2 tree (product/ + changes/), through the workspace
 * the MCP server opens: one test per tool, on a temp copy of the v2 fixture.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openRexWorkspace, type RexWorkspace } from "../../src/cli/mcp-workspace.js";
import { REX_MCP_TOOLS } from "../../src/cli/mcp-tools/index.js";
import { DEFAULT_CONFIG } from "../../src/schema/index.js";
import { applyReshape, type ReshapeProposal } from "../../src/core/reshape.js";
import { ChangeLayerStore } from "../../src/store/change-layer-store.js";
import { loadPrdModel } from "../../src/store/prd-model-reader.js";
import { indexTree } from "../../src/schema/v2-rules.js";
import { copyV2Fixture } from "../helpers/v2-fixture.js";

const CHANGE = "c0000000-0000-4000-8000-000000000001";
const TASK = "c0000000-0000-4000-8000-000000000002";
const quiet = { env: {}, warn: () => {} };

let tmp: string;
let rexDir: string;
let ws: RexWorkspace;

beforeEach(async () => {
  tmp = realpathSync.native(await mkdtemp(join(tmpdir(), "rex-v2-mcp-")));
  execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: tmp });
  rexDir = await copyV2Fixture(join(tmp, ".rex"), "lf");
  // `rex init` writes config.json on a v2 tree too; the fixture carries none.
  await writeFile(join(rexDir, "config.json"), JSON.stringify(DEFAULT_CONFIG("shop")));
  ws =await openRexWorkspace(tmp, "startup", tmp);
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const tool = REX_MCP_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  const res = await tool.run(ws, args);
  return { isError: res.isError === true, text: res.content[0].text };
}
const json = (r: { text: string }) => JSON.parse(r.text);

async function node(id: string) {
  const model = await loadPrdModel(rexDir, quiet);
  return indexTree(model.tree, { includeTombstones: true }).resolve(id);
}

/** A second change, so moves and merges have somewhere to go. */
async function addChange(title: string): Promise<string> {
  const res = await call("add_item", { type: "change", title, touches: ["a0000000-0000-4000-8000-000000000002"] });
  expect(res.isError).toBe(false);
  return json(res).id;
}

/** Apply one reshape merge on the change layer, as `rex reshape --accept` does. */
function reshapeMerge(survivorId: string, mergedIds: string[]) {
  const proposal: ReshapeProposal = { id: "p1", action: { action: "merge", survivorId, mergedIds, reason: "same work" } };
  return ws.store.withTransaction(async (doc) => applyReshape(doc.items, [proposal], { changeLayer: true }));
}

describe("the MCP workspace on a v2 tree", () => {
  it("opens the change-layer store and scaffolds no v1 tree", () => {
    expect(ws.store).toBeInstanceOf(ChangeLayerStore);
    expect(existsSync(join(rexDir, "prd_tree"))).toBe(false);
  });
});

describe("rex MCP tools on a v2 tree", () => {
  it("edit_item edits a change's intent and keeps the v1 field names, adding type and displayId", async () => {
    const res = await call("edit_item", { id: CHANGE, description: "Wallets convert better.", priority: "critical" });
    expect(res.isError, res.text).toBe(false);
    const { id, updatedFields, item } = json(res);
    expect({ id, updatedFields }).toEqual({ id: CHANGE, updatedFields: ["description", "priority"] });
    expect(item).toMatchObject({ id: CHANGE, title: "Add Apple Pay", description: "Wallets convert better.", priority: "critical", type: "change", displayId: "CH-1" });
    expect(await node(CHANGE)).toMatchObject({ intent: "Wallets convert better.", priority: "critical" });
  });

  it("edit_item refuses a level change, naming the v2 layout", async () => {
    const res = await call("edit_item", { id: TASK, level: "subtask" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/v2 layout/);
    expect((await node(TASK))?.type).toBe("task");
  });

  it("move_item reparents a task to another change and refuses a change under a task", async () => {
    const other = await addChange("Add Google Pay");
    const res = await call("move_item", { id: TASK, parentId: other });
    expect(res.isError, res.text).toBe(false);
    expect(json(res)).toMatchObject({ id: TASK, previousParentId: CHANGE, newParentId: other, type: "task" });
    const model = await loadPrdModel(rexDir, quiet);
    expect(model.tree.changes.find((c) => c.id === other)?.children?.map((c) => c.id)).toEqual([TASK]);

    const refused = await call("move_item", { id: CHANGE, parentId: TASK });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/change cannot move under a task/);
  });

  it("merge_items merges sibling changes and refuses tasks", async () => {
    const other = await addChange("Apple Pay, again");
    const res = await call("merge_items", { sourceIds: [CHANGE, other], targetId: CHANGE });
    expect(res.isError, res.text).toBe(false);
    expect(json(res).absorbedIds).toEqual([other]);
    const model = await loadPrdModel(rexDir, quiet);
    expect(model.tree.changes.map((c) => c.id)).not.toContain(other);
    expect(await node(CHANGE)).toMatchObject({ touches: ["a0000000-0000-4000-8000-000000000002"], amends: [expect.objectContaining({ delta: "modified" })] });

    const amending = await addChange("Add Apple Pay on the web");
    const kept = await call("merge_items", { sourceIds: [CHANGE, amending], targetId: amending });
    expect(kept.isError).toBe(true);
    expect(kept.text).toMatch(/carries amendments/);

    const task2 = json(await call("add_item", { type: "task", title: "Style the button", parentId: CHANGE })).id;
    const refused = await call("merge_items", { sourceIds: [TASK, task2], targetId: TASK });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/merges changes only/);
  });

  it("merge_items keeps the absorbed change's id, display id and aliases as aliases on the target", async () => {
    const other = await addChange("Apple Pay, again");
    await ws.store.updateItem(other, { displayId: "CH-7", aliases: ["CH-old"] } as never);
    const res = await call("merge_items", { sourceIds: [CHANGE, other], targetId: CHANGE });
    expect(res.isError, res.text).toBe(false);
    const aliases = ((await node(CHANGE)) as { aliases?: string[] }).aliases ?? [];
    expect([...aliases].sort()).toEqual([other, "CH-7", "CH-old"].sort());
    const got = await call("get_item", { id: other });
    expect(got.isError, got.text).toBe(false);
    expect(json(got).item.id).toBe(CHANGE);
  });

  describe("merging across the Inbox boundary", () => {
    const inboxDir = (): string => join(rexDir, "changes", "inbox");
    const addInboxChange = async (title: string): Promise<string> => {
      const res = await call("add_item", { type: "change", title });
      expect(res.isError, res.text).toBe(false);
      return json(res).id;
    };

    it("merge_items of a placed change into an Inbox change places the target, keeps its task selected and its files out of changes/inbox/", async () => {
      const placed = await addChange("Saved cards");
      const task = json(await call("add_item", { type: "task", title: "Store the token", parentId: placed, tags: ["stored"] })).id;
      const inbox = await addInboxChange("Remember my card");
      expect(await node(inbox)).toMatchObject({ needsPlacement: true });

      const res = await call("merge_items", { sourceIds: [placed, inbox], targetId: inbox });
      expect(res.isError, res.text).toBe(false);

      const merged = (await node(inbox)) as { needsPlacement?: boolean; touches?: string[] };
      expect(merged.needsPlacement).toBeUndefined();
      expect(merged.touches).toEqual(["a0000000-0000-4000-8000-000000000002"]);
      expect(existsSync(inboxDir()) ? readdirSync(inboxDir()) : []).toEqual([]);

      const next = await call("get_next_task", { tags: ["stored"] });
      expect(next.isError, next.text).toBe(false);
      expect(json(next).item.id).toBe(task);
    });

    it("merging a spike, which names no target, into an Inbox change keeps the target in the Inbox", async () => {
      const spike = await addInboxChange("Investigate card vaults");
      await ws.store.updateItem(spike, { spike: true, needsPlacement: undefined } as never);
      expect(await node(spike)).not.toHaveProperty("needsPlacement");
      const inbox = await addInboxChange("Remember my card");
      const res = await call("merge_items", { sourceIds: [spike, inbox], targetId: inbox });
      expect(res.isError, res.text).toBe(false);
      expect(await node(inbox)).toMatchObject({ needsPlacement: true });
    });

    it("a merge whose changes all need placement keeps the target in the Inbox", async () => {
      const a = await addInboxChange("Remember my card");
      const b = await addInboxChange("Remember my card again");
      const res = await call("merge_items", { sourceIds: [a, b], targetId: a });
      expect(res.isError, res.text).toBe(false);
      expect(await node(a)).toMatchObject({ needsPlacement: true });
      expect(readdirSync(inboxDir())).toHaveLength(1);
    });
  });

  it("reorganize merging two similar changes keeps the absorbed change's touches, ids and aliases on the target", async () => {
    const giftCards = "a0000000-0000-4000-8000-000000000003";
    await writeFile(
      join(rexDir, "product", "checkout", "gift-cards.md"),
      `---\nid: "${giftCards}"\ntype: "capability"\ntitle: "Gift cards"\nslug: "gift-cards"\ndisplayId: "A1.2"\nstatement: "A shopper can pay with a gift card."\n---\n`,
    );
    const a = await addChange("Add gift card checkout");
    const b = await addChange("Add gift card checkout");
    await ws.store.updateItem(b, { displayId: "CH-9", aliases: ["CH-gift"], touches: [giftCards] } as never);
    const res = await call("reorganize", { accept: "all", mode: "fast" });
    expect(res.isError, res.text).toBe(false);
    const model = await loadPrdModel(rexDir, quiet);
    const ids = model.tree.changes.map((c) => c.id);
    expect(ids.filter((id) => id === a || id === b)).toHaveLength(1);
    const [target, absorbed] = ids.includes(a) ? [a, b] : [b, a];
    const node2 = (await node(target)) as { touches?: string[]; aliases?: string[] };
    expect([...(node2.touches ?? [])].sort()).toEqual(["a0000000-0000-4000-8000-000000000002", giftCards]);
    expect(node2.aliases).toEqual(expect.arrayContaining([absorbed]));
    if (absorbed === b) expect(node2.aliases).toEqual(expect.arrayContaining(["CH-9", "CH-gift"]));
  });

  it("reorganize never merges away a change that carries amendments", async () => {
    // Same title as the fixture's amending change, and richer (two tasks), so
    // the detector picks it as the target and the amending change as absorbed.
    const richer = await addChange("Add Apple Pay");
    for (const title of ["One", "Two"]) {
      expect((await call("add_item", { type: "task", title, parentId: richer })).isError).toBe(false);
    }
    const res = await call("reorganize", { accept: "all", mode: "fast" });
    expect(res.isError, res.text).toBe(false);
    const model = await loadPrdModel(rexDir, quiet);
    expect(model.tree.changes.map((c) => c.id)).toContain(CHANGE);
    expect(await node(CHANGE)).toMatchObject({ amends: [expect.objectContaining({ delta: "modified" })] });
  });

  it("reshape merging two changes keeps the absorbed change's touches, id, display id and aliases on the survivor", async () => {
    const giftCards = "a0000000-0000-4000-8000-000000000003";
    await writeFile(
      join(rexDir, "product", "checkout", "gift-cards.md"),
      `---\nid: "${giftCards}"\ntype: "capability"\ntitle: "Gift cards"\nslug: "gift-cards"\ndisplayId: "A1.2"\nstatement: "A shopper can pay with a gift card."\n---\n`,
    );
    const other = await addChange("Apple Pay, again");
    await ws.store.updateItem(other, { displayId: "CH-7", aliases: ["CH-old"], touches: [giftCards] } as never);
    const outcome = await reshapeMerge(CHANGE, [other]);
    expect(outcome.errors).toEqual([]);
    const survivor = (await node(CHANGE)) as { touches?: string[]; aliases?: string[] };
    expect(survivor.touches).toEqual([giftCards]);
    expect([...(survivor.aliases ?? [])].sort()).toEqual([other, "CH-7", "CH-old"].sort());
  });

  it("reshape refuses a merge that would absorb a change carrying amendments, and writes nothing", async () => {
    const plain = await addChange("Apple Pay, again");
    const before = await loadPrdModel(rexDir, quiet);
    const outcome = await reshapeMerge(plain, [CHANGE]);
    expect(outcome.errors).toEqual([{ proposal: expect.anything(), error: expect.stringMatching(/^Skipped: .*carries amendments/) }]);
    expect(outcome.applied).toEqual([]);
    expect(outcome.deletedIds).toEqual([]);
    const after = await loadPrdModel(rexDir, quiet);
    expect(after.tree.changes.map((c) => c.id).sort()).toEqual(before.tree.changes.map((c) => c.id).sort());
    expect(await node(CHANGE)).toMatchObject({ amends: [expect.objectContaining({ delta: "modified" })] });
  });

  it("claim_task claims a task, and refuses a change that has tasks", async () => {
    const res = await call("claim_task", { id: TASK });
    expect(res.isError, res.text).toBe(false);
    expect(json(res)).toMatchObject({ id: TASK, title: "Wire the button", claimed: true, type: "task" });

    const refused = await call("claim_task", { id: CHANGE });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/claim one of its tasks/);

    const lone = await addChange("Add a gift card");
    expect((await call("claim_task", { id: lone })).isError).toBe(false);
  });

  it("claim_task claims a change whose only task is deleted, as selection treats it", async () => {
    await ws.store.updateItem(TASK, { status: "deleted" });
    const res = await call("claim_task", { id: CHANGE });
    expect(res.isError, res.text).toBe(false);
    expect(json(res)).toMatchObject({ id: CHANGE, claimed: true, type: "change" });
  });

  it("release_task gives back a claim on a v2 task", async () => {
    await call("claim_task", { id: TASK });
    const res = await call("release_task", { id: TASK });
    expect(res.isError, res.text).toBe(false);
    expect(json(res)).toEqual({ id: TASK, released: true });
  });

  it("verify_criteria maps a v2 task's acceptance criteria", async () => {
    const res = await call("verify_criteria", { taskId: TASK });
    expect(res.isError, res.text).toBe(false);
    expect(res.text).toContain("The button appears on Safari only");
  });

  it("facets lists the distribution over the change layer", async () => {
    const res = await call("facets");
    expect(res.isError, res.text).toBe(false);
    expect(json(res)).toHaveProperty("facets");
    expect((await call("facets", { itemId: TASK })).isError).toBe(false);
  });

  it("health scores the change layer", async () => {
    const res = await call("health");
    expect(res.isError, res.text).toBe(false);
    expect(json(res)).toHaveProperty("overall");
  });

  it("reorganize detects and applies on the change layer", async () => {
    const detect = await call("reorganize", { mode: "fast" });
    expect(detect.isError, detect.text).toBe(false);
    expect(json(detect).structural).toHaveProperty("proposals");
    const apply = await call("reorganize", { mode: "fast", accept: "all" });
    expect(apply.isError, apply.text).toBe(false);
    expect(json(apply)).toHaveProperty("applied");
  });

  it("reorganize proposes no v1 level collapse of changes nested two deep", async () => {
    const mid = await addChange("Tidy the card form");
    const leaf = await addChange("Tidy the card form further");
    expect((await call("move_item", { id: mid, parentId: CHANGE })).isError).toBe(false);
    expect((await call("move_item", { id: leaf, parentId: mid })).isError).toBe(false);
    const detect = json(await call("reorganize", { mode: "fast" }));
    expect(detect.structural.proposals.filter((p: { type: string }) => p.type === "collapse")).toEqual([]);
  });

  it("get_token_usage rolls up over the change layer", async () => {
    const res = await call("get_token_usage", { id: TASK });
    expect(res.isError, res.text).toBe(false);
    expect(json(res)).toMatchObject({ id: TASK, tokens: { runCount: 0 } });
    expect(json(await call("get_token_usage")).items.map((i: { id: string }) => i.id)).toEqual(expect.arrayContaining([CHANGE, TASK]));
  });

  it("get_next_task and update_task_status do not crash on the store", async () => {
    expect((await call("get_next_task")).isError).toBe(false);
    const res = await call("update_task_status", { id: TASK, status: "in_progress" });
    expect(res.isError, res.text).toBe(false);
  });
});
