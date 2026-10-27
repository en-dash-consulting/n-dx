/**
 * A fresh v2 project (product/index.md only) has no capability or constraint,
 * so nothing on it can be placed. A change added there lands in the Inbox, and
 * is still worked: `rex next` selects its task and completing the task closes
 * the change, with no placement and no rule error. Once the product layer has
 * a capability or constraint, the Inbox holds the change as before.
 *
 * Real CLI commands on a real folder tree.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cmdAddChange } from "../../src/cli/commands/add-change.js";
import { cmdNext } from "../../src/cli/commands/next.js";
import { cmdUpdate } from "../../src/cli/commands/update.js";
import { DEFAULT_CONFIG } from "../../src/schema/index.js";
import { SCHEMA_VERSION_V2 } from "../../src/schema/v2.js";
import { checkV2Rules, type RuleNode } from "../../src/schema/v2-rules.js";
import { loadPrdModel } from "../../src/store/prd-model-reader.js";
import { writePrdModel } from "../../src/store/prd-model-writer.js";
import { withLock } from "../../src/store/file-lock.js";
import { prdLockPath } from "../../src/store/paths.js";

const quiet = { env: {}, warn: () => {} };

describe("an Inbox change on an empty v2 product layer", () => {
  let dir: string;
  let rexDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    dir = realpathSync.native(await mkdtemp(join(tmpdir(), "rex-empty-product-")));
    execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: dir });
    rexDir = join(dir, ".rex");
    await mkdir(rexDir);
    await withLock(prdLockPath(rexDir), () =>
      writePrdModel(rexDir, { layout: "v2", schema: SCHEMA_VERSION_V2, title: "Fresh", tree: { product: [], changes: [] }, warnings: [] }),
    );
    await writeFile(join(rexDir, "config.json"), JSON.stringify(DEFAULT_CONFIG("fresh")));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await rm(dir, { recursive: true, force: true });
  });

  const tree = async () => (await loadPrdModel(rexDir, quiet)).tree;
  const next = async (): Promise<{ item: { id: string } | null }> => {
    logSpy.mockClear();
    await cmdNext(dir, { format: "json" });
    return JSON.parse(logSpy.mock.calls.map((c) => c[0] ?? "").join("\n"));
  };

  /** Adds a change and one task as `rex add` does on a v2 tree; returns their nodes. */
  async function addChangeWithTask(): Promise<{ change: RuleNode; task: RuleNode }> {
    await cmdAddChange(dir, undefined, { title: "Ship the first page" });
    const change = (await tree()).changes[0];
    await cmdAddChange(dir, "task", { title: "Write the page", parent: change.id });
    const added = (await tree()).changes[0];
    return { change: added, task: added.children![0] };
  }

  it("starts from product/index.md alone", async () => {
    expect(await readdir(join(rexDir, "product"))).toEqual(["index.md"]);
  });

  it("selects the change's task and closes the change when the task completes, without placement", async () => {
    const { change, task } = await addChangeWithTask();
    expect(change.needsPlacement).toBe(true);
    expect((await next()).item?.id).toBe(task.id);

    await cmdUpdate(dir, task.id, { status: "completed" });

    const done = (await tree()).changes[0];
    expect(done).toMatchObject({ id: change.id, status: "completed" });
    expect(done.children![0].status).toBe("completed");
    expect(checkV2Rules(await tree(), { now: new Date() }).filter((f) => f.severity === "error")).toEqual([]);
    expect((await next()).item).toBeNull();
  });

  it("holds the change once the product layer has a constraint", async () => {
    const { task } = await addChangeWithTask();
    const model = await loadPrdModel(rexDir, quiet);
    const constraint = { id: "c1000000-0000-4000-8000-000000000001", type: "constraint", title: "Pages load fast", slug: "pages-load-fast", statement: "Every page loads in under a second." } as RuleNode;
    await withLock(prdLockPath(rexDir), () => writePrdModel(rexDir, { ...model, tree: { ...model.tree, product: [constraint] } }));

    expect((await next()).item).toBeNull();
    await expect(cmdUpdate(dir, task.id, { status: "completed" })).resolves.toBeUndefined();
    expect((await tree()).changes[0].status).not.toBe("completed");
  });
});
