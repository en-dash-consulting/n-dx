import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { resolveStore } from "@n-dx/rex";
import { loadPRDSync } from "../../src/server/prd-io.js";
import { savedRunVersion, writeTaskRun } from "../../src/server/task-run-settings.js";
import type { ServerContext } from "../../src/server/types.js";

const SOLO = "c0000000-0000-4000-8000-0000000000a1";
const WITH_TASKS = "c0000000-0000-4000-8000-000000000001";

/** Raw intent and state, including nodes a projection might omit. */
async function treeContents(dir: string): Promise<Record<string, string>> {
  const files = await readdir(dir, { recursive: true });
  const entries = await Promise.all(files.filter((p) => /\.(md|yaml)$/.test(p)).sort()
    .map(async (p) => [p, await readFile(join(dir, p), "utf8")]));
  return Object.fromEntries(entries);
}

describe("shared run-settings writes", () => {
  let root: string;
  let ctx: ServerContext;
  const broadcast = vi.fn();

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "task-run-settings-"));
    ctx = { projectDir: root, rexDir: join(root, ".rex"), svDir: join(root, ".sourcevision"), dev: false };
    await cp(resolve(__dirname, "../../../rex/tests/fixtures/v2-tree"), ctx.rexDir, { recursive: true });
    const soloDir = join(ctx.rexDir, "changes", "solo-change");
    await mkdir(soloDir);
    await writeFile(join(soloDir, "index.md"), [
      "---", `id: "${SOLO}"`, 'type: "change"', 'title: "Solo change"',
      'slug: "solo-change"', 'intent: "Run as one task."', "---", "",
    ].join("\n"));
    broadcast.mockClear();
  });

  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("persists a task-less change's settings and refreshes its cache and broadcast", async () => {
    const run = { tier: "heavy" as const };
    const result = await writeTaskRun(ctx, SOLO, { run, version: "none" }, broadcast);

    expect(result).toEqual({ ok: true, saved: run, version: savedRunVersion(run) });
    expect((await (await resolveStore(ctx.rexDir)).getItem(SOLO))?.run).toEqual(run);
    expect(loadPRDSync(ctx.rexDir)?.items.find((item) => item.id === SOLO)?.run).toEqual(run);
    expect(broadcast).toHaveBeenCalledExactlyOnceWith({
      type: "rex:item-updated", itemId: SOLO, updates: { run }, timestamp: expect.any(String),
    });
  });

  it("refuses a stale change save without changing intent, state or broadcasting", async () => {
    const run = { tier: "heavy" as const };
    expect((await writeTaskRun(ctx, SOLO, { run, version: "none" })).ok).toBe(true);
    const before = await treeContents(ctx.rexDir);

    const result = await writeTaskRun(ctx, SOLO, { run: { tier: "light" }, version: "none" }, broadcast);

    expect(result).toMatchObject({
      ok: false, status: 409, body: { conflict: true, saved: run, version: savedRunVersion(run) },
    });
    expect(await treeContents(ctx.rexDir)).toEqual(before);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("directs a change with tasks to save on its tasks and writes nothing", async () => {
    const before = await treeContents(ctx.rexDir);
    const result = await writeTaskRun(ctx, WITH_TASKS, { run: { tier: "heavy" }, version: "none" }, broadcast);

    expect(result).toMatchObject({ ok: false, status: 400, body: {
      error: expect.stringMatching(/does not run as one task.*n-dx work.*save.*tasks/i),
    } });
    expect(await treeContents(ctx.rexDir)).toEqual(before);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it.each(["task", "subtask"])("still saves settings on a v1 %s", async (level) => {
    await rm(ctx.rexDir, { recursive: true });
    await mkdir(ctx.rexDir);
    const store = await resolveStore(ctx.rexDir);
    await store.saveDocument({ schema: "rex/v1", title: "Legacy", items: [{
      id: "epic", title: "Epic", level: "epic", status: "pending", children: [{
        id: "task", title: "Task", level: "task", status: "pending", children: [{
          id: "subtask", title: "Subtask", level: "subtask", status: "pending",
        }],
      }],
    }] });
    const run = { tier: "heavy" as const };

    expect(await writeTaskRun(ctx, level, { run, version: "none" })).toEqual({
      ok: true, saved: run, version: savedRunVersion(run),
    });
    expect((await store.getItem(level))?.run).toEqual(run);
  });
});
