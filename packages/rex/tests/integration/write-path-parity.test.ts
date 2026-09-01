/**
 * The MCP and CLI write paths must serialize a document identically.
 *
 * Observed 2026-09-01: a single `update_task_status` through the rex MCP server
 * rewrote 823 of 1398 tree files, dropping the `-<shortId>` suffix from every
 * slug and un-truncating titles (`child-process-cleanup-and-exit-b67648` →
 * `child-process-cleanup-and-exit-hygiene`). Every rename was R100 with zero
 * content loss and `rex validate` still passed, so nothing failed — but a
 * subsequent `rex update` through the CLI re-serialized the whole tree back.
 * The tree therefore flip-flops on alternating writes, and a one-field status
 * change produces an 800-file diff that would swamp any review.
 *
 * Two properties are asserted separately, because they fail for different
 * reasons:
 *
 *   1. **Parity** — the same mutation through either path leaves byte-identical
 *      trees. Catches a genuine divergence between the two code paths.
 *   2. **Minimality** — a status update rewrites only the item and its
 *      ancestors. Catches whole-tree churn even when both paths churn *the
 *      same way*, which parity alone would happily accept.
 *
 * @see packages/rex/src/cli/mcp-tools.ts — handleUpdateTaskStatus
 * @see packages/rex/src/cli/commands/folder-tree-sync.ts — syncFolderTree
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { FileStore } from "../../src/store/file-adapter.js";
import { handleUpdateTaskStatus } from "../../src/cli/mcp-tools.js";
import { syncFolderTree } from "../../src/cli/commands/folder-tree-sync.js";
import { computeTimestampUpdates } from "../../src/core/timestamps.js";
import type { PRDDocument, PRDItem } from "../../src/schema/index.js";

function task(id: string, title: string, status: PRDItem["status"] = "pending"): PRDItem {
  return { id, title, level: "task", status };
}

/** A tree deep and wide enough that a whole-tree re-slug would be obvious. */
function seedDoc(): PRDDocument {
  return {
    schema: "rex/v1",
    title: "Parity PRD",
    items: [
      {
        id: "epic-alpha",
        title: "Alpha Epic With A Fairly Long Title To Force Truncation",
        level: "epic",
        status: "pending",
        children: [
          {
            id: "feat-one",
            title: "First Feature",
            level: "feature",
            status: "pending",
            children: [task("task-a", "Do the first thing"), task("task-b", "Do the second thing")],
          },
          {
            id: "feat-two",
            title: "Second Feature",
            level: "feature",
            status: "pending",
            children: [task("task-c", "Do the third thing")],
          },
        ],
      },
      {
        id: "epic-beta",
        title: "Beta Epic",
        level: "epic",
        status: "pending",
        children: [task("task-d", "Standalone under beta")],
      },
    ],
  };
}

/** Every file under `root`, as relative path → contents. */
async function snapshot(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir)) {
      const abs = join(dir, entry);
      if ((await stat(abs)).isDirectory()) await walk(abs);
      else out.set(relative(root, abs), await readFile(abs, "utf-8"));
    }
  }
  await walk(root);
  return out;
}

async function seedProject(): Promise<{ projectDir: string; rexDir: string }> {
  const projectDir = await mkdtemp(join(tmpdir(), "rex-write-parity-"));
  const rexDir = join(projectDir, ".rex");
  await mkdir(rexDir, { recursive: true });
  await writeFile(join(rexDir, "config.json"), JSON.stringify({ version: "1.0" }), "utf-8");
  await new FileStore(rexDir).saveDocument(seedDoc());
  return { projectDir, rexDir };
}

let dirs: string[] = [];

beforeEach(() => { dirs = []; });
afterEach(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

describe("MCP and CLI write paths agree", () => {
  it("produce byte-identical trees for the same status change", async () => {
    const viaMcp = await seedProject();
    const viaCli = await seedProject();
    dirs.push(viaMcp.projectDir, viaCli.projectDir);

    // MCP path.
    const mcpStore = new FileStore(viaMcp.rexDir);
    const result = await handleUpdateTaskStatus(mcpStore, viaMcp.projectDir, {
      id: "task-a",
      status: "completed",
    });
    expect(result.isError, result.content.map((c) => c.text).join("\n")).toBeUndefined();

    // CLI path: replicate commands/update.ts — it computes the item's own
    // status timestamps (update.ts:106) before updateItem, so a bare
    // updateItem here would report a difference the real command does not have.
    const cliStore = new FileStore(viaCli.rexDir);
    const existing = await cliStore.getItem("task-a");
    const tsUpdates = computeTimestampUpdates(existing!.status, "completed", existing!);
    await cliStore.updateItem(
      "task-a",
      { status: "completed", ...tsUpdates },
      { applyAttribution: true, projectDir: viaCli.projectDir },
    );
    await syncFolderTree(viaCli.rexDir, cliStore);

    const mcpTree = await snapshot(join(viaMcp.rexDir, "prd_tree"));
    const cliTree = await snapshot(join(viaCli.rexDir, "prd_tree"));

    // Compare paths first: a slug divergence shows up here, and diffing the
    // path sets reports it far more legibly than a content mismatch would.
    expect(
      [...mcpTree.keys()].sort(),
      "the two write paths produced different tree layouts (slug divergence)",
    ).toEqual([...cliTree.keys()].sort());

    for (const [path, mcpContent] of mcpTree) {
      // Wall-clock fields differ because the two arms run milliseconds apart.
      // Everything else — slugs, ordering, field set, formatting — must match.
      const strip = (s: string) =>
        s.replace(/^(lastModified|completedAt|startedAt|endedAt):.*$/gm, "");
      expect(strip(mcpContent), `content differs at ${path}`).toBe(strip(cliTree.get(path) ?? ""));
    }
  });

  it("rewrites only the changed item and its ancestors, not the whole tree", async () => {
    const { projectDir, rexDir } = await seedProject();
    dirs.push(projectDir);
    const treeRoot = join(rexDir, "prd_tree");

    const store = new FileStore(rexDir);

    // Warm-up write: the seed comes from saveDocument, which stamps no
    // attribution, so the first pass through the update path rewrites
    // everything once as normalisation. That is not the churn under test.
    const warmup = await handleUpdateTaskStatus(store, projectDir, {
      id: "task-d",
      status: "completed",
    });
    expect(warmup.isError).toBeUndefined();

    const before = await snapshot(treeRoot);
    const result = await handleUpdateTaskStatus(store, projectDir, {
      id: "task-a",
      status: "completed",
    });
    expect(result.isError).toBeUndefined();
    const after = await snapshot(treeRoot);

    // Paths must not move at all for a status change.
    expect([...after.keys()].sort(), "a status update renamed tree paths").toEqual(
      [...before.keys()].sort(),
    );

    const strip = (s: string) => s.replace(/^lastModified:.*$/gm, "");
    const changed = [...after.keys()].filter(
      (p) => strip(after.get(p) ?? "") !== strip(before.get(p) ?? ""),
    );

    // task-a itself, plus the two ancestor index files whose child tables
    // carry its status. Anything beyond that is churn.
    expect(
      changed.length,
      `a one-field status update rewrote ${changed.length} files:\n  ${changed.join("\n  ")}`,
    ).toBeLessThanOrEqual(3);
  });
});
