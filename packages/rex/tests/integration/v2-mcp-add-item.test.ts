/**
 * `add_item` and `get_item` against a v2 tree (product/ + changes/), and the
 * v1 refusals of v2-only input.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStore, ensureRexDir } from "../../src/store/index.js";
import { SCHEMA_VERSION } from "../../src/schema/index.js";
import { handleAddItem, handleGetItem } from "../../src/cli/mcp-tools/index.js";
import { loadPrdModel } from "../../src/store/prd-model-reader.js";
import { withPrdModelTransaction } from "../../src/store/prd-model-transaction.js";
import { indexTree } from "../../src/schema/v2-rules.js";
import { copyV2Fixture } from "../helpers/v2-fixture.js";

const CAPABILITY = "a0000000-0000-4000-8000-000000000002";
const CHANGE = "c0000000-0000-4000-8000-000000000001";
const quiet = { env: {}, warn: () => {} };

let tmp: string;
let rexDir: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "rex-v2-add-"));
  rexDir = await copyV2Fixture(join(tmp, ".rex"), "lf");
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const add = (args: Parameters<typeof handleAddItem>[3]) => handleAddItem(createStore("file", rexDir), tmp, rexDir, args);
const text = (r: { content: { text: string }[] }) => r.content[0].text;

async function nodeById(id: string) {
  const model = await loadPrdModel(rexDir, quiet);
  return indexTree(model.tree, { includeTombstones: true }).resolve(id);
}

async function setState(id: string, fields: Record<string, unknown>) {
  await withPrdModelTransaction(rexDir, (model) => {
    const tree = structuredClone(model.tree);
    Object.assign(indexTree(tree, { includeTombstones: true }).resolve(id)!, fields);
    return { tree, result: undefined };
  });
}

describe("add_item on a v2 tree", () => {
  it("refuses a level-only call with a message naming type", async () => {
    const res = await add({ title: "Old habit", level: "epic" });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/pass type \(change, task, subtask\) instead of level "epic"/);
  });

  it("creates a change in the Inbox when no type is given", async () => {
    const res = await add({ title: "Something to sort out" });
    expect(res.isError).toBeFalsy();
    const { id, type, needsPlacement } = JSON.parse(text(res));
    expect({ type, needsPlacement }).toEqual({ type: "change", needsPlacement: true });
    const model = await loadPrdModel(rexDir, quiet);
    expect(model.tree.changes.find((c) => c.id === id)).toMatchObject({ type: "change", title: "Something to sort out", needsPlacement: true });
  });

  it("creates a change with acceptanceCriteria that get_item returns", async () => {
    const res = await add({ type: "change", title: "Wallets", touches: [CAPABILITY], acceptanceCriteria: ["Wallets pay", "Cards still pay"] });
    const { id, needsPlacement } = JSON.parse(text(res));
    expect(needsPlacement).toBeUndefined();
    const got = await handleGetItem(createStore("file", rexDir), rexDir, { id });
    expect(got.isError).toBeFalsy();
    const { item, parentChain } = JSON.parse(text(got));
    expect(item).toMatchObject({ id, type: "change", touches: [CAPABILITY], acceptanceCriteria: ["Wallets pay", "Cards still pay"] });
    expect(parentChain).toEqual([]);
  });

  it("adds a task under an open change; get_item names the change in the parent chain", async () => {
    const res = await add({ type: "task", title: "Test on Safari", parentId: "CH-1" });
    expect(res.isError).toBeFalsy();
    const { id } = JSON.parse(text(res));
    const { parentChain } = JSON.parse(text(await handleGetItem(createStore("file", rexDir), rexDir, { id })));
    expect(parentChain).toEqual([{ id: CHANGE, title: "Add Apple Pay", type: "change" }]);
  });

  it.each([
    ["completed", { status: "completed" }],
    ["applied", { status: "completed", appliedAt: "2026-10-08T00:00:00.000Z" }],
    ["cancelled", { status: "cancelled" }],
  ])("refuses a task under a %s change and suggests a follow-up change with discoveredFrom", async (state, fields) => {
    await setState(CHANGE, fields);
    const res = await add({ type: "task", title: "Late work", parentId: CHANGE });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain(`it is ${state}`);
    expect(text(res)).toContain(`discoveredFrom: { item: "${CHANGE}" }`);

    const follow = await add({ title: "Late work", discoveredFrom: { item: CHANGE } });
    const { id } = JSON.parse(text(follow));
    expect(await nodeById(id)).toMatchObject({ type: "change", discoveredFrom: { item: CHANGE }, needsPlacement: true });
  });
});

describe("add_item on a v1 tree", () => {
  beforeEach(async () => {
    rexDir = join(tmp, "v1", ".rex");
    await ensureRexDir(rexDir);
    await createStore("file", rexDir).saveDocument({ schema: SCHEMA_VERSION, title: "v1", items: [] });
  });

  it("refuses a type with no v1 level, naming the v1 layout", async () => {
    const res = await handleAddItem(createStore("file", rexDir), join(tmp, "v1"), rexDir, { title: "C", type: "change" });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/v1 layout.*no level for type "change"/);
  });

  it("refuses v2-only fields and a call with neither type nor level", async () => {
    const store = createStore("file", rexDir);
    const touches = await handleAddItem(store, join(tmp, "v1"), rexDir, { title: "E", level: "epic", touches: ["x"] });
    expect(text(touches)).toMatch(/v1 layout.*no touches/);
    const bare = await handleAddItem(store, join(tmp, "v1"), rexDir, { title: "E" });
    expect(bare.isError).toBe(true);
    expect(text(bare)).toMatch(/v1 layout.*pass level/);
  });

  it("reads a type with a v1 level as that level", async () => {
    const store = createStore("file", rexDir);
    const epic = JSON.parse(text(await handleAddItem(store, join(tmp, "v1"), rexDir, { title: "E", level: "epic" })));
    const res = await handleAddItem(store, join(tmp, "v1"), rexDir, { title: "T", type: "task", parentId: epic.id });
    expect(JSON.parse(text(res))).toMatchObject({ level: "task", title: "T" });
  });
});
