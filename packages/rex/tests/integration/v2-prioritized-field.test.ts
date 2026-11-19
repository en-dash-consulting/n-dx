/**
 * The `prioritized` flag on v2 changes: the schema takes it as change intent,
 * `add_item`, `edit_item` and `rex update --prioritized` set and clear it, a
 * clear removes the key rather than writing `false`, and nothing but a change
 * carries it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveStore } from "../../src/store/index.js";
import { handleAddItem, handleEditItem } from "../../src/cli/mcp-tools/index.js";
import { cmdUpdate } from "../../src/cli/commands/update.js";
import { loadPrdModel } from "../../src/store/prd-model-reader.js";
import { indexTree } from "../../src/schema/v2-rules.js";
import { ChangeIntentSchema } from "../../src/schema/v2.js";
import { DEFAULT_CONFIG, type PRDItem } from "../../src/schema/index.js";
import { canBePrioritized, prioritizedRefusal, storedPrioritized } from "../../src/core/prioritized.js";
import { copyV2Fixture, FIXTURE_CHANGE, FIXTURE_TASK } from "../helpers/v2-fixture.js";

const CAPABILITY = "a0000000-0000-4000-8000-000000000002";
const quiet = { env: {}, warn: () => {} };

let tmp: string;
let rexDir: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "rex-v2-prioritized-"));
  rexDir = await copyV2Fixture(join(tmp, ".rex"), "lf");
  await writeFile(join(rexDir, "config.json"), JSON.stringify(DEFAULT_CONFIG("shop")));
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tmp, { recursive: true, force: true });
});

const text = (r: { content: { text: string }[] }) => r.content[0].text;
const add = async (args: Parameters<typeof handleAddItem>[3]) => handleAddItem(await resolveStore(rexDir), tmp, rexDir, args);
const edit = async (args: Parameters<typeof handleEditItem>[2]) => handleEditItem(await resolveStore(rexDir), tmp, args);
const changeMd = () => readFile(join(rexDir, "changes", "add-apple-pay", "index.md"), "utf-8");

async function nodeById(id: string) {
  const model = await loadPrdModel(rexDir, quiet);
  return indexTree(model.tree, { includeTombstones: true }).resolve(id);
}

describe("prioritized in the v2 schema", () => {
  const base = { id: "x", type: "change", title: "T", slug: "t" } as const;
  it("a change accepts a boolean and refuses any other value", () => {
    expect(ChangeIntentSchema.parse({ ...base, prioritized: true }).prioritized).toBe(true);
    expect(ChangeIntentSchema.safeParse(base).success).toBe(true);
    expect(ChangeIntentSchema.safeParse({ ...base, prioritized: "yes" }).success).toBe(false);
  });
});

describe("core/prioritized", () => {
  const item = (fields: Partial<PRDItem> & Record<string, unknown>): PRDItem =>
    ({ id: "i", title: "Item", status: "pending", level: "epic", ...fields }) as PRDItem;

  it("only a v2 change or a v1 epic can carry it", () => {
    expect(canBePrioritized(item({ type: "change", level: "feature" }))).toBe(true);
    expect(canBePrioritized(item({ type: "task", level: "task" }))).toBe(false);
    expect(canBePrioritized(item({ level: "epic" }))).toBe(true);
    expect(canBePrioritized(item({ level: "feature" }))).toBe(false);
    expect(prioritizedRefusal(item({ type: "subtask", level: "subtask" }))).toMatch(/is a subtask/);
  });

  it("stores true and clears to undefined, never false", () => {
    expect(storedPrioritized(true)).toBe(true);
    expect(storedPrioritized(false)).toBeUndefined();
  });
});

describe("prioritized through add_item and edit_item", () => {
  it("add_item stores it on a change after priority, and leaves it out when false", async () => {
    const flagged = JSON.parse(text(await add({ type: "change", title: "Wallets", priority: "high", prioritized: true, touches: [CAPABILITY] })));
    const node = await nodeById(flagged.id);
    expect(node?.prioritized).toBe(true);
    const md = await readFile(join(rexDir, "changes", node!.slug, "index.md"), "utf-8");
    const keys = md.split("---")[1].split("\n").map((l) => l.split(":")[0]).filter(Boolean);
    expect(keys.indexOf("prioritized")).toBe(keys.indexOf("priority") + 1);

    const plain = JSON.parse(text(await add({ type: "change", title: "Plain", prioritized: false, touches: [CAPABILITY] })));
    expect(await nodeById(plain.id)).not.toHaveProperty("prioritized");
  });

  it("add_item refuses it on a task", async () => {
    const res = await add({ type: "task", title: "Test", parentId: FIXTURE_CHANGE, prioritized: true });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/does not carry prioritized/);
  });

  it("edit_item sets it, and false removes the key", async () => {
    const set = await edit({ id: FIXTURE_CHANGE, prioritized: true });
    expect(set.isError).toBeFalsy();
    expect(JSON.parse(text(set)).updatedFields).toEqual(["prioritized"]);
    expect((await nodeById(FIXTURE_CHANGE))?.prioritized).toBe(true);
    expect(await changeMd()).toMatch(/^prioritized: true$/m);

    const cleared = await edit({ id: FIXTURE_CHANGE, prioritized: false });
    expect(cleared.isError).toBeFalsy();
    expect(await nodeById(FIXTURE_CHANGE)).not.toHaveProperty("prioritized");
    expect(await changeMd()).not.toMatch(/^prioritized:/m);
  });

  it("edit_item refuses it on a task", async () => {
    const res = await edit({ id: FIXTURE_TASK, prioritized: true });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/Only a change/);
    expect(await nodeById(FIXTURE_TASK)).not.toHaveProperty("prioritized");
  });
});

describe("rex update --prioritized", () => {
  it("sets it, and --prioritized=false removes it", async () => {
    await cmdUpdate(tmp, FIXTURE_CHANGE, { prioritized: "true" });
    expect((await nodeById(FIXTURE_CHANGE))?.prioritized).toBe(true);
    await cmdUpdate(tmp, FIXTURE_CHANGE, { prioritized: "false" });
    expect(await nodeById(FIXTURE_CHANGE)).not.toHaveProperty("prioritized");
  });

  it("refuses a task and a value that is not a boolean", async () => {
    await expect(cmdUpdate(tmp, FIXTURE_TASK, { prioritized: "true" })).rejects.toThrow(/Only a change/);
    await expect(cmdUpdate(tmp, FIXTURE_CHANGE, { prioritized: "yes" })).rejects.toThrow(/Invalid --prioritized/);
  });
});
