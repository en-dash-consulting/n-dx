/**
 * MCP writes on a v2 tree stamp `lastModified` / `lastModifiedBy` on the
 * nodes they write, as v1's store does, and a write that changes nothing
 * stamps nothing. Remote sync and the dashboard read these stamps.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openRexWorkspace, type RexWorkspace } from "../../src/cli/mcp-workspace.js";
import { REX_MCP_TOOLS } from "../../src/cli/mcp-tools/index.js";
import { DEFAULT_CONFIG } from "../../src/schema/index.js";
import { resolveActor } from "../../src/core/identity.js";
import { loadPrdModel } from "../../src/store/prd-model-reader.js";
import { indexTree } from "../../src/schema/v2-rules.js";
import { copyV2Fixture, FIXTURE_CHANGE as CHANGE, FIXTURE_TASK as TASK } from "../helpers/v2-fixture.js";

const CAPABILITY = "a0000000-0000-4000-8000-000000000002";
const OLD_STAMP = "2026-10-15T16:13:00.000Z";
const OLD_AUTHOR = "Sterling H";
const quiet = { env: {}, warn: () => {} };

let tmp: string;
let rexDir: string;
let ws: RexWorkspace;
let actor: string;

beforeEach(async () => {
  tmp = realpathSync.native(await mkdtemp(join(tmpdir(), "rex-v2-stamps-")));
  execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: tmp });
  rexDir = await copyV2Fixture(join(tmp, ".rex"), "lf");
  await writeFile(join(rexDir, "config.json"), JSON.stringify(DEFAULT_CONFIG("shop")));
  ws = await openRexWorkspace(tmp, "startup", tmp);
  actor = await resolveActor();
  // Give the change and its task an older stamp by someone else, as the rehearsal tree had.
  await stampOld(CHANGE);
  await stampOld(TASK);
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown>) {
  const tool = REX_MCP_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  const res = await tool.run(ws, args);
  const text = res.content[0].text;
  expect(res.isError === true, text).toBe(false);
  return JSON.parse(text);
}

async function node(id: string) {
  return indexTree((await loadPrdModel(rexDir, quiet)).tree, { includeTombstones: true }).resolve(id);
}

/** Set an old `lastModified` / `lastModifiedBy` on node `id`'s row in the change's state.yaml. */
async function stampOld(id: string): Promise<void> {
  const path = join(rexDir, "changes", "add-apple-pay", "state.yaml");
  const text = await readFile(path, "utf-8");
  const row = `  "${id}":\n`;
  const at = text.indexOf(row);
  const fields = `    lastModified: "${OLD_STAMP}"\n    lastModifiedBy: "${OLD_AUTHOR}"\n`;
  await writeFile(path, at === -1 ? `${text.trimEnd()}\n${row}${fields}` : text.slice(0, at + row.length) + fields + text.slice(at + row.length));
  expect(await node(id)).toMatchObject({ lastModified: OLD_STAMP, lastModifiedBy: OLD_AUTHOR });
}

function expectFresh(n: unknown, since: string): void {
  const { lastModified, lastModifiedBy } = n as { lastModified?: string; lastModifiedBy?: string };
  expect(lastModifiedBy).toBe(actor);
  expect(lastModified !== undefined && lastModified >= since, `lastModified ${lastModified} is not after ${since}`).toBe(true);
}

describe("MCP writes on a v2 tree stamp lastModified and lastModifiedBy", () => {
  it("update_task_status stamps the task it writes", async () => {
    const since = new Date().toISOString();
    await call("update_task_status", { id: TASK, status: "in_progress" });
    expectFresh(await node(TASK), since);
    const yaml = await readFile(join(rexDir, "changes", "add-apple-pay", "state.yaml"), "utf-8");
    expect(yaml).toContain(`lastModifiedBy: ${JSON.stringify(actor)}`);
  });

  it("edit_item stamps the change it writes and leaves its unchanged task alone", async () => {
    const since = new Date().toISOString();
    await call("edit_item", { id: CHANGE, priority: "critical" });
    expectFresh(await node(CHANGE), since);
    expect(await node(TASK)).toMatchObject({ lastModified: OLD_STAMP, lastModifiedBy: OLD_AUTHOR });
  });

  it("add_item stamps the change it creates", async () => {
    const since = new Date().toISOString();
    const { id } = await call("add_item", { type: "change", title: "Add Google Pay", touches: [CAPABILITY] });
    expectFresh(await node(id), since);
  });

  it("move_item stamps the node moved and both parents", async () => {
    const { id: other } = await call("add_item", { type: "change", title: "Add Google Pay", touches: [CAPABILITY] });
    await stampOldOn(other);
    const since = new Date().toISOString();
    await call("move_item", { id: TASK, parentId: other });
    expectFresh(await node(TASK), since);
    expectFresh(await node(CHANGE), since);
    expectFresh(await node(other), since);
  });

  it("completing a change's last task keeps the auto-completed change's author and moves its timestamp", async () => {
    // Only a pending change closes with its last task.
    const statePath = join(rexDir, "changes", "add-apple-pay", "state.yaml");
    await writeFile(statePath, (await readFile(statePath, "utf-8")).replace('status: "in_progress"', 'status: "pending"'));
    expect(await node(CHANGE)).toMatchObject({ status: "pending", lastModifiedBy: OLD_AUTHOR });
    const since = new Date().toISOString();
    await call("update_task_status", { id: TASK, status: "completed" });
    expectFresh(await node(TASK), since);
    const change = (await node(CHANGE)) as { status?: string; lastModified?: string; lastModifiedBy?: string };
    expect(change.status).toBe("completed");
    expect(change.lastModifiedBy).toBe(OLD_AUTHOR);
    expect(change.lastModified !== undefined && change.lastModified >= since, `lastModified ${change.lastModified}`).toBe(true);
  });

  it("ChangeLayerStore.updateItem with preserveModifiedBy keeps the node's existing author", async () => {
    const since = new Date().toISOString();
    await ws.store.updateItem(CHANGE, { priority: "critical" }, { preserveModifiedBy: true });
    const change = (await node(CHANGE)) as { priority?: string; lastModified?: string; lastModifiedBy?: string };
    expect(change.priority).toBe("critical");
    expect(change.lastModifiedBy).toBe(OLD_AUTHOR);
    expect(change.lastModified !== undefined && change.lastModified >= since).toBe(true);
  });

  it("ChangeLayerStore.updateItem with preserveModifiedBy stamps the actor on a node with no author", async () => {
    const { id } = await call("add_item", { type: "change", title: "Add Google Pay", touches: [CAPABILITY] });
    await clearAuthor(id);
    const since = new Date().toISOString();
    await ws.store.updateItem(id, { priority: "critical" }, { preserveModifiedBy: true });
    expectFresh(await node(id), since);
  });

  it("a write that changes nothing stamps nothing", async () => {
    const before = (await loadPrdModel(rexDir, quiet)).tree;
    const { title } = (await node(CHANGE))!;
    await call("edit_item", { id: CHANGE, title });
    expect((await loadPrdModel(rexDir, quiet)).tree).toEqual(before);
  });
});

/** An older stamp on a change created during the test: rewrite its row in whichever state.yaml holds it. */
async function stampOldOn(id: string): Promise<void> {
  for (const entry of await readdir(join(rexDir, "changes"), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.name !== "state.yaml") continue;
    const path = join(entry.parentPath, entry.name);
    const text = await readFile(path, "utf-8");
    if (!text.includes(`"${id}":`)) continue;
    await writeFile(path, text.replace(/lastModified: "[^"]*"/, `lastModified: "${OLD_STAMP}"`).replace(/lastModifiedBy: "[^"]*"/, `lastModifiedBy: "${OLD_AUTHOR}"`));
  }
  expect(await node(id)).toMatchObject({ lastModified: OLD_STAMP, lastModifiedBy: OLD_AUTHOR });
}

/** Drop `lastModified` / `lastModifiedBy` from node `id`'s row in whichever state.yaml holds it. */
async function clearAuthor(id: string): Promise<void> {
  for (const entry of await readdir(join(rexDir, "changes"), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.name !== "state.yaml") continue;
    const path = join(entry.parentPath, entry.name);
    const text = await readFile(path, "utf-8");
    if (!text.includes(`"${id}":`)) continue;
    await writeFile(path, text.replace(/ *lastModified: "[^"]*"\r?\n/, "").replace(/ *lastModifiedBy: "[^"]*"\r?\n/, ""));
  }
  const n = (await node(id)) as { lastModifiedBy?: string };
  expect(n.lastModifiedBy).toBeUndefined();
}
