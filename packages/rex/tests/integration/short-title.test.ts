/**
 * The optional short title on PRD items: the v2 schema takes it as intent,
 * both stores round-trip it, and `add_item`, `edit_item`, `rex add` and
 * `rex update` set and clear it, refusing one another open item already shows
 * as its name and accepting one only completed items show.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveStore, resolveRexPaths } from "../../src/store/index.js";
import { handleAddItem, handleEditItem, handleGetItem } from "../../src/cli/mcp-tools/index.js";
import { cmdUpdate } from "../../src/cli/commands/update.js";
import { cmdAddChange } from "../../src/cli/commands/add-change.js";
import { loadPrdModel } from "../../src/store/prd-model-reader.js";
import { indexTree } from "../../src/schema/v2-rules.js";
import { ChangeIntentSchema, SubtaskIntentSchema, TaskIntentSchema } from "../../src/schema/v2.js";
import { changeLayerFromItems, changeLayerItems } from "../../src/core/layer-projection.js";
import { copyV2Fixture, FIXTURE_CHANGE, FIXTURE_TASK, markChangeApplied } from "../helpers/v2-fixture.js";
import { readPRD, writePRD } from "../helpers/rex-dir-test-support.js";
import type { PRDDocument } from "../../src/schema/index.js";

const CAPABILITY = "a0000000-0000-4000-8000-000000000002";
const quiet = { env: {}, warn: () => {} };
const text = (r: { content: { text: string }[] }) => r.content[0].text;

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "rex-short-title-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tmp, { recursive: true, force: true });
});

describe("shortTitle in the v2 schema", () => {
  const base = { id: "x", title: "T", slug: "t" };
  it.each([
    ["change", ChangeIntentSchema],
    ["task", TaskIntentSchema],
    ["subtask", SubtaskIntentSchema],
  ] as const)("a %s accepts a string short title and refuses any other value", (type, schema) => {
    expect(schema.parse({ ...base, type, shortTitle: "Wallets" }).shortTitle).toBe("Wallets");
    expect(schema.safeParse({ ...base, type }).success).toBe(true);
    expect(schema.safeParse({ ...base, type, shortTitle: 3 }).success).toBe(false);
  });
});

describe("shortTitle on a v2 tree", () => {
  let rexDir: string;
  beforeEach(async () => {
    rexDir = await copyV2Fixture(join(tmp, ".rex"), "lf");
  });

  const add = async (args: Parameters<typeof handleAddItem>[3]) => handleAddItem(await resolveStore(rexDir), tmp, rexDir, args);
  const edit = async (args: Parameters<typeof handleEditItem>[2]) => handleEditItem(await resolveStore(rexDir), tmp, args);
  const getItem = async (id: string) => JSON.parse(text(await handleGetItem(await resolveStore(rexDir), rexDir, { id }))).item;
  async function nodeById(id: string) {
    const model = await loadPrdModel(rexDir, quiet);
    return indexTree(model.tree, { includeTombstones: true }).resolve(id);
  }

  it("add_item stores it as frontmatter right after the slug, and get_item returns it", async () => {
    const res = await add({ type: "change", title: "Let shoppers pay with a phone wallet", shortTitle: " Wallets ", summary: "Pay by phone.", touches: [CAPABILITY] });
    expect(res.isError).toBeFalsy();
    const { id } = JSON.parse(text(res));
    expect(await getItem(id)).toMatchObject({ id, shortTitle: "Wallets", title: "Let shoppers pay with a phone wallet" });

    const md = await readFile(join(rexDir, "changes", (await nodeById(id))!.slug, "index.md"), "utf-8");
    const keys = md.split("---")[1].split("\n").map((l) => l.split(":")[0]).filter(Boolean);
    expect(keys.indexOf("shortTitle")).toBe(keys.indexOf("slug") + 1);
    expect(keys.indexOf("shortTitle")).toBeLessThan(keys.indexOf("summary"));
  });

  it("add_item refuses a short title an open item shows as its name, naming that item", async () => {
    // CH-1 "Add Apple Pay" is in progress and has no short title, so its title is its name.
    const res = await add({ type: "change", title: "Something else", shortTitle: "add apple pay", touches: [CAPABILITY] });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("Add Apple Pay");
    expect(text(res)).toContain("CH-1");
    expect(text(res)).toContain(FIXTURE_CHANGE);
    const model = await loadPrdModel(rexDir, quiet);
    expect(indexTree(model.tree).entries.some((e) => e.node.title === "Something else")).toBe(false);
  });

  it("add_item accepts a short title only a completed item shows", async () => {
    await markChangeApplied(rexDir, FIXTURE_CHANGE);
    const res = await add({ type: "change", title: "Apple Pay, round two", shortTitle: "Add Apple Pay", touches: [CAPABILITY] });
    expect(res.isError).toBeFalsy();
    expect((await nodeById(JSON.parse(text(res)).id))?.shortTitle).toBe("Add Apple Pay");
  });

  it("edit_item sets a short title, an empty string removes it, and the rest of the intent is untouched", async () => {
    const set = await edit({ id: FIXTURE_CHANGE, shortTitle: "Apple Pay" });
    expect(set.isError).toBeFalsy();
    expect(JSON.parse(text(set)).updatedFields).toEqual(["shortTitle"]);
    expect(await nodeById(FIXTURE_CHANGE)).toMatchObject({ shortTitle: "Apple Pay", title: "Add Apple Pay", intent: "Shoppers on iPhone abandon at the card form." });

    const cleared = await edit({ id: FIXTURE_CHANGE, shortTitle: "" });
    expect(cleared.isError).toBeFalsy();
    expect(await nodeById(FIXTURE_CHANGE)).not.toHaveProperty("shortTitle");
    expect(await readFile(join(rexDir, "changes", "add-apple-pay", "index.md"), "utf-8")).not.toMatch(/^shortTitle:/m);
  });

  it("edit_item refuses the name of another open item and keeps the item's own", async () => {
    const refused = await edit({ id: FIXTURE_CHANGE, shortTitle: "Wire the button" });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain(FIXTURE_TASK);
    expect(await nodeById(FIXTURE_CHANGE)).not.toHaveProperty("shortTitle");

    // Its own title as its short title collides with nothing.
    expect((await edit({ id: FIXTURE_CHANGE, shortTitle: "Add Apple Pay" })).isError).toBeFalsy();
  });

  it("rex update --short-title sets, refuses and clears it", async () => {
    await cmdUpdate(tmp, FIXTURE_TASK, { "short-title": "Button", quiet: "true" });
    expect((await nodeById(FIXTURE_TASK))?.shortTitle).toBe("Button");
    await expect(cmdUpdate(tmp, FIXTURE_TASK, { "short-title": "Add Apple Pay", quiet: "true" })).rejects.toThrow(/Add Apple Pay/);
    expect((await nodeById(FIXTURE_TASK))?.shortTitle).toBe("Button");
    await cmdUpdate(tmp, FIXTURE_TASK, { "short-title": "", quiet: "true" });
    expect(await nodeById(FIXTURE_TASK)).not.toHaveProperty("shortTitle");
  });

  it("rex add --short-title sets it, and refuses an open item's name", async () => {
    await cmdAddChange(tmp, "task", { title: "Style the button", parent: FIXTURE_CHANGE, "short-title": "Styling" });
    const model = await loadPrdModel(rexDir, quiet);
    expect(indexTree(model.tree).entries.find((e) => e.node.title === "Style the button")?.node.shortTitle).toBe("Styling");
    await expect(cmdAddChange(tmp, "task", { title: "Another", parent: FIXTURE_CHANGE, "short-title": "styling" })).rejects.toThrow(/Style the button/);
  });

  it("survives the v1 projection both ways", async () => {
    const model = await loadPrdModel(rexDir, quiet);
    const tree = structuredClone(model.tree);
    indexTree(tree).resolve(FIXTURE_CHANGE)!.shortTitle = "Apple Pay";
    const items = changeLayerItems(tree.changes);
    expect(items[0].shortTitle).toBe("Apple Pay");
    expect(changeLayerFromItems(items, tree.changes).changes[0].shortTitle).toBe("Apple Pay");
  });
});

describe("shortTitle on a v1 folder tree", () => {
  beforeEach(() => {
    writePRD(tmp, {
      schema: "rex/v1",
      title: "test",
      items: [
        {
          id: "epic-1", title: "Epic", level: "epic", status: "pending",
          children: [
            {
              id: "feature-1", title: "Feature", level: "feature", status: "pending",
              children: [
                { id: "task-a", title: "Add the refund button", level: "task", status: "pending" },
                { id: "task-b", title: "Refunds", level: "task", status: "blocked" },
                { id: "task-c", title: "Gift cards", level: "task", status: "completed" },
              ],
            },
          ],
        },
      ],
    } as PRDDocument);
  });

  const find = (id: string) => {
    const walk = (items: PRDDocument["items"]): PRDDocument["items"][number] | undefined => {
      for (const i of items) {
        if (i.id === id) return i;
        const hit = i.children && walk(i.children);
        if (hit) return hit;
      }
      return undefined;
    };
    return walk(readPRD(tmp).items);
  };

  it("rex update round-trips it through the folder tree and refuses a blocked item's name", async () => {
    await cmdUpdate(tmp, "task-a", { "short-title": "Refund button", quiet: "true" });
    expect(find("task-a")?.shortTitle).toBe("Refund button");
    expect(find("task-a")?.title).toBe("Add the refund button");

    await expect(cmdUpdate(tmp, "task-a", { "short-title": "refunds", quiet: "true" })).rejects.toThrow(/Refunds.*task-b|task-b/);
    expect(find("task-a")?.shortTitle).toBe("Refund button");
  });

  it("edit_item accepts a completed item's name and clears with an empty string", async () => {
    const store = await resolveStore(resolveRexPaths(tmp).rexDir);
    const accepted = await handleEditItem(store, tmp, { id: "task-a", shortTitle: "Gift cards" });
    expect(accepted.isError).toBeFalsy();
    expect(find("task-a")?.shortTitle).toBe("Gift cards");

    const cleared = await handleEditItem(store, tmp, { id: "task-a", shortTitle: "" });
    expect(cleared.isError).toBeFalsy();
    expect(find("task-a")).not.toHaveProperty("shortTitle");
  });

  it("add_item stores it and refuses an open item's name", async () => {
    const { rexDir } = resolveRexPaths(tmp);
    const store = await resolveStore(rexDir);
    const ok = await handleAddItem(store, tmp, rexDir, { title: "Issue store credit", level: "task", parentId: "feature-1", shortTitle: "Credit" });
    expect(ok.isError).toBeFalsy();
    expect(find(JSON.parse(text(ok)).id)?.shortTitle).toBe("Credit");

    const refused = await handleAddItem(store, tmp, rexDir, { title: "Other", level: "task", parentId: "feature-1", shortTitle: "Add the refund button" });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain("task-a");
  });
});
