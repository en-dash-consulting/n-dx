/**
 * A stray legacy PRD beside a v2 tree changes nothing: a `.rex/prd.json` is
 * never migrated into prd_tree/ beside product/, and a prd_tree/ already there
 * never overlays the change layer's items.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureLegacyPrdMigrated } from "../../src/store/ensure-legacy-prd-migrated.js";
import { openRexWorkspace } from "../../src/cli/mcp-workspace.js";
import { REX_MCP_TOOLS } from "../../src/cli/mcp-tools/index.js";
import { loadItemsPreferFolderTree } from "../../src/cli/commands/folder-tree-sync.js";
import { resolveStore, serializeFolderTree } from "../../src/store/index.js";
import { walkTree } from "../../src/core/tree.js";
import { DEFAULT_CONFIG, SCHEMA_VERSION, type PRDItem } from "../../src/schema/index.js";
import { copyV2Fixture } from "../helpers/v2-fixture.js";

const CHANGE = "c0000000-0000-4000-8000-000000000001";
const TASK = "c0000000-0000-4000-8000-000000000002";

/** The v2 change and task as a v1 PRD, with stale titles and statuses. */
const STALE_ITEMS: PRDItem[] = [
  {
    id: CHANGE,
    title: "STALE v1 title",
    level: "epic",
    status: "completed",
    children: [{ id: TASK, title: "STALE task", level: "task", status: "completed" }],
  },
];
const STALE_PRD = { schema: SCHEMA_VERSION, title: "stale", items: STALE_ITEMS };

let tmp: string;
let rexDir: string;

beforeEach(async () => {
  tmp = realpathSync.native(await mkdtemp(join(tmpdir(), "rex-v2-stray-")));
  execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: tmp });
  rexDir = await copyV2Fixture(join(tmp, ".rex"), "lf");
  await writeFile(join(rexDir, "config.json"), JSON.stringify(DEFAULT_CONFIG("shop")));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const titles = (items: PRDItem[]) => [...walkTree(items)].map(({ item }) => `${item.title}:${item.status}`);

describe("a stray prd.json beside a v2 tree", () => {
  beforeEach(async () => {
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(STALE_PRD));
  });

  it("is not migrated: no prd_tree/, prd.json untouched, reason v2-layout", async () => {
    const before = await readFile(join(rexDir, "prd.json"), "utf-8");
    // The same call `ndx start` makes on startup (web start.ts).
    expect(await ensureLegacyPrdMigrated(tmp)).toEqual({ migrated: false, reason: "v2-layout" });
    expect(existsSync(join(rexDir, "prd_tree"))).toBe(false);
    expect(existsSync(join(rexDir, "prd.json.migrated"))).toBe(false);
    expect(await readFile(join(rexDir, "prd.json"), "utf-8")).toBe(before);
  });

  it("an MCP session start scaffolds no prd_tree/, and get_next_task answers the v2 task", async () => {
    const ws = await openRexWorkspace(tmp, "startup", tmp);
    expect(existsSync(join(rexDir, "prd_tree"))).toBe(false);
    expect(ws.migrationWarning).toBeUndefined();
    const tool = REX_MCP_TOOLS.find((t) => t.name === "get_next_task")!;
    const res = await tool.run(ws, {});
    expect(res.isError, res.content[0].text).not.toBe(true);
    const text = res.content[0].text;
    expect(text).toContain(TASK);
    expect(text).toContain("Wire the button");
    expect(text).not.toContain("STALE");
  });
});

describe("a stray prd_tree/ beside a v2 tree", () => {
  it("never overlays the change layer in loadItemsPreferFolderTree", async () => {
    await serializeFolderTree(STALE_ITEMS, join(rexDir, "prd_tree"));
    const store = await resolveStore(rexDir);
    const items = await loadItemsPreferFolderTree(rexDir, store);
    expect(titles(items)).toEqual(expect.arrayContaining(["Add Apple Pay:in_progress", "Wire the button:pending"]));
    expect(titles(items).join()).not.toContain("STALE");
  });
});
