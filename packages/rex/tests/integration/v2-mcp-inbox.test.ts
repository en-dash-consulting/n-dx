/**
 * The MCP tools on a v2 tree with the reserved Inbox folder: add_item writes
 * an unplaced change into `changes/inbox/`, place_change moves it out, and
 * where an Inbox change is stored changes nothing get_prd_status or
 * get_capability report.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStore } from "../../src/store/index.js";
import { handleAddItem, handleGetCapability, handleGetItem, handleGetPrdStatus, handlePlaceChange } from "../../src/cli/mcp-tools/index.js";
import { withPrdModelTransaction } from "../../src/store/prd-model-transaction.js";
import { copyV2Fixture } from "../helpers/v2-fixture.js";

const CAPABILITY = "a0000000-0000-4000-8000-000000000002";

let tmp: string;
let rexDir: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "rex-v2-inbox-"));
  rexDir = await copyV2Fixture(join(tmp, ".rex"), "lf");
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const store = () => createStore("file", rexDir);
const json = (r: { content: { text: string }[]; isError?: boolean }) => {
  expect(r.isError, r.content[0].text).toBeFalsy();
  return JSON.parse(r.content[0].text);
};
const changes = (...parts: string[]) => join(rexDir, "changes", ...parts);

async function addInboxChange(title: string): Promise<{ id: string; slug: string }> {
  const { id } = json(await handleAddItem(store(), tmp, rexDir, { title }));
  return { id, slug: json(await handleGetItem(store(), rexDir, { id })).item.slug };
}

describe("the Inbox folder through the MCP tools", () => {
  it("add_item writes an unplaced change to changes/inbox/<slug>/index.md with needsPlacement in that folder's state.yaml", async () => {
    const { id, slug } = await addInboxChange("Sort this out");
    expect(slug).toBe("sort-this-out");
    expect(await readFile(changes("inbox", slug, "index.md"), "utf-8")).toContain(`id: "${id}"`);
    expect(await readFile(changes("inbox", slug, "state.yaml"), "utf-8")).toMatch(new RegExp(`"${id}":\\n\\s+needsPlacement: true`));
  });

  it("add_item writes a targeted change at the changes root", async () => {
    json(await handleAddItem(store(), tmp, rexDir, { type: "change", title: "Wallets", touches: [CAPABILITY] }));
    expect(existsSync(changes("wallets", "index.md"))).toBe(true);
    expect(existsSync(changes("inbox"))).toBe(false);
  });

  it("place_change with a target moves the change to the changes root, clears needsPlacement and keeps its id and slug", async () => {
    const { id, slug } = await addInboxChange("Tidy the card form");
    json(await handlePlaceChange(store(), rexDir, { id, target: CAPABILITY, relation: "touches" }));
    expect(existsSync(changes("inbox"))).toBe(false);
    expect(await readFile(changes(slug, "index.md"), "utf-8")).toContain(`id: "${id}"`);
    const { item } = json(await handleGetItem(store(), rexDir, { id }));
    expect(item).toMatchObject({ id, slug, touches: [CAPABILITY] });
    expect(item).not.toHaveProperty("needsPlacement");
  });

  it("place_change without a target writes nothing: the change stays in the Inbox", async () => {
    const { id, slug } = await addInboxChange("Support refunds when paying by card");
    json(await handlePlaceChange(store(), rexDir, { id }));
    expect(existsSync(changes("inbox", slug, "index.md"))).toBe(true);
  });

  it("get_prd_status's Inbox count and get_capability's change lists are the same whichever folder holds an Inbox change", async () => {
    const { slug } = await addInboxChange("Sort this out");
    const report = async () => ({
      status: json(await handleGetPrdStatus(store(), rexDir)),
      capability: json(await handleGetCapability(rexDir, { id: CAPABILITY })).changes,
    });
    const inFolder = await report();
    expect(inFolder.status.inbox).toBe(1);

    // Store it at the changes root, as a tree written before the folder was reserved did.
    await rename(changes("inbox", slug), changes(slug));
    await rm(changes("inbox"), { recursive: true });
    expect(await report()).toEqual(inFolder);

    // The next write moves it back; nothing reported changes.
    await withPrdModelTransaction(rexDir, (model) => ({ tree: model.tree, result: undefined }));
    expect(existsSync(changes("inbox", slug, "index.md"))).toBe(true);
    expect(await report()).toEqual(inFolder);
  });
});
