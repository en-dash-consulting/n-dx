/**
 * `performance.fastReads` must be a pure speed switch.
 *
 * The slow path parses the folder tree, separately loads the document (which
 * parses the same tree), and merges the two. The fast path returns the
 * document's items. These tests assert the two produce the same items —
 * byte-for-byte as JSON, which covers ordering, nesting and every field —
 * across the shapes the merge was originally written to protect:
 *
 *   - routing/metadata fields the tree was once thought not to carry
 *     (`blockedBy`, `branch`, `sourceFile`, `overrideMarker`);
 *   - a task placed directly under an epic with no feature between;
 *   - leaf subtask `.md` files stored beside their parent's `index.md`;
 *   - an empty tree.
 *
 * If a future change makes the store and the tree genuinely diverge again,
 * these fail — which is the point. The flag defaults off, so the slow path
 * remains what ships until an operator opts in.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileStore } from "../../../src/store/file-adapter.js";
import { loadItemsPreferFolderTree } from "../../../src/cli/commands/folder-tree-sync.js";
import { clearPerfFlagCache } from "../../../src/store/perf-flags.js";
import { PRD_TREE_DIRNAME } from "../../../src/store/paths.js";
import { SCHEMA_VERSION } from "../../../src/schema/index.js";
import type { PRDItem } from "../../../src/schema/index.js";

function task(id: string, title: string, extra: Partial<PRDItem> = {}): PRDItem {
  return { id, title, level: "task", status: "pending", ...extra } as PRDItem;
}

async function writeTree(rexDir: string, items: PRDItem[]): Promise<void> {
  await mkdir(join(rexDir, PRD_TREE_DIRNAME), { recursive: true });
  const store = new FileStore(rexDir, { currentBranchFile: "prd.json" });
  await store.saveDocument({ schema: SCHEMA_VERSION, title: "Fixture", items });
}

/** Read the same tree both ways and return the two serialized results. */
async function bothWays(rexDir: string): Promise<{ slow: string; fast: string }> {
  const store = new FileStore(rexDir, { currentBranchFile: "prd.json" });

  delete process.env["REX_FAST_READS"];
  clearPerfFlagCache();
  const slow = await loadItemsPreferFolderTree(rexDir, store);

  process.env["REX_FAST_READS"] = "1";
  clearPerfFlagCache();
  const fastStore = new FileStore(rexDir, { currentBranchFile: "prd.json" });
  const fast = await loadItemsPreferFolderTree(rexDir, fastStore);

  return { slow: JSON.stringify(slow), fast: JSON.stringify(fast) };
}

describe("fastReads equivalence", () => {
  let tmp: string;
  let rexDir: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "fast-read-"));
    rexDir = join(tmp, ".rex");
    await mkdir(rexDir, { recursive: true });
  });

  afterEach(async () => {
    delete process.env["REX_FAST_READS"];
    clearPerfFlagCache();
    await rm(tmp, { recursive: true, force: true });
  });

  it("agrees on an ordinary epic → feature → task tree", async () => {
    await writeTree(rexDir, [
      {
        id: "e1", title: "Epic One", level: "epic", status: "pending",
        children: [
          {
            id: "f1", title: "Feature One", level: "feature", status: "pending",
            children: [task("t1", "Task One"), task("t2", "Task Two", { status: "completed" })],
          },
        ],
      } as PRDItem,
      {
        id: "e2", title: "Epic Two", level: "epic", status: "pending",
        children: [
          { id: "f2", title: "Feature Two", level: "feature", status: "pending",
            children: [task("t3", "Task Three")] } as PRDItem,
        ],
      } as PRDItem,
    ]);

    const { slow, fast } = await bothWays(rexDir);
    expect(fast).toBe(slow);
  });

  it("agrees on the routing fields the merge was written to preserve", async () => {
    await writeTree(rexDir, [
      {
        id: "e1", title: "Epic", level: "epic", status: "pending",
        children: [
          {
            id: "f1", title: "Feature", level: "feature", status: "pending",
            children: [
              task("t1", "Blocked task", {
                blockedBy: ["t2"],
                branch: "feat/something",
                sourceFile: "docs/spec.md",
                priority: "high",
                tags: ["alpha", "beta"],
              } as Partial<PRDItem>),
              task("t2", "Blocker"),
            ],
          } as PRDItem,
        ],
      } as PRDItem,
    ]);

    const { slow, fast } = await bothWays(rexDir);
    expect(fast).toBe(slow);

    // `blockedBy`, `priority` and `tags` survive the round trip, so this is a
    // real agreement and not two empty results matching.
    expect(slow).toContain('"blockedBy":["t2"]');
    expect(slow).toContain('"priority":"high"');
    expect(slow).toContain('"tags":["alpha","beta"]');

    // `branch` and `sourceFile` do NOT survive — the folder-tree format does
    // not carry them, and both paths lose them identically. This is the merge's
    // stated reason for existing ("reattach routing fields the tree does not
    // store"), and it has not been able to do that since the store started
    // reading the tree itself: the fields are gone from `doc.items` before the
    // merge sees them, so there is nothing left to reattach. Pinned here so
    // that if the tree ever learns to carry them, this fails and the fast path
    // gets re-examined rather than silently diverging.
    expect(slow).not.toContain("feat/something");
    expect(slow).not.toContain("docs/spec.md");
  });

  it("agrees on a task placed directly under an epic", async () => {
    await writeTree(rexDir, [
      {
        id: "e1", title: "Epic", level: "epic", status: "pending",
        children: [task("t1", "Orphan task under epic")],
      } as PRDItem,
    ]);

    const { slow, fast } = await bothWays(rexDir);
    expect(fast).toBe(slow);
  });

  it("agrees on leaf subtasks stored beside their parent", async () => {
    await writeTree(rexDir, [
      {
        id: "e1", title: "Epic", level: "epic", status: "pending",
        children: [
          {
            id: "f1", title: "Feature", level: "feature", status: "pending",
            children: [
              {
                id: "t1", title: "Task with subtasks", level: "task", status: "pending",
                children: [
                  { id: "s1", title: "Sub one", level: "subtask", status: "pending" },
                  { id: "s2", title: "Sub two", level: "subtask", status: "completed" },
                ],
              } as PRDItem,
            ],
          } as PRDItem,
        ],
      } as PRDItem,
    ]);

    const { slow, fast } = await bothWays(rexDir);
    expect(fast).toBe(slow);
    expect(slow).toContain("Sub one");
  });

  it("agrees on an empty tree", async () => {
    await writeTree(rexDir, []);
    const { slow, fast } = await bothWays(rexDir);
    expect(fast).toBe(slow);
    expect(slow).toBe("[]");
  });

  it("agrees when the caller hands over a document it already loaded", async () => {
    await writeTree(rexDir, [
      { id: "e1", title: "Epic", level: "epic", status: "pending",
        children: [task("t1", "Task")] } as PRDItem,
    ]);

    delete process.env["REX_FAST_READS"];
    clearPerfFlagCache();
    const slow = await loadItemsPreferFolderTree(rexDir, new FileStore(rexDir, { currentBranchFile: "prd.json" }));

    process.env["REX_FAST_READS"] = "1";
    clearPerfFlagCache();
    const store = new FileStore(rexDir, { currentBranchFile: "prd.json" });
    const doc = await store.loadDocument();
    const fast = await loadItemsPreferFolderTree(rexDir, store, doc);

    expect(JSON.stringify(fast)).toBe(JSON.stringify(slow));
  });
});

describe("perf flag resolution", () => {
  let tmp: string;
  let rexDir: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "perf-flags-"));
    rexDir = join(tmp, ".rex");
    await mkdir(rexDir, { recursive: true });
    clearPerfFlagCache();
  });

  afterEach(async () => {
    delete process.env["REX_FAST_READS"];
    delete process.env["REX_FAST_WRITES"];
    clearPerfFlagCache();
    await rm(tmp, { recursive: true, force: true });
  });

  it("defaults both flags off with no config and no environment", async () => {
    const { readPerfFlags } = await import("../../../src/store/perf-flags.js");
    expect(readPerfFlags(rexDir)).toEqual({ fastReads: false, fastWrites: false });
  });

  it("reads them from config.json", async () => {
    await writeFile(
      join(rexDir, "config.json"),
      JSON.stringify({ schema: SCHEMA_VERSION, project: "x", adapter: "file", performance: { fastReads: true } }),
    );
    const { readPerfFlags } = await import("../../../src/store/perf-flags.js");
    expect(readPerfFlags(rexDir)).toEqual({ fastReads: true, fastWrites: false });
  });

  it("lets the environment override config.json in both directions", async () => {
    await writeFile(
      join(rexDir, "config.json"),
      JSON.stringify({ schema: SCHEMA_VERSION, project: "x", adapter: "file", performance: { fastReads: true, fastWrites: true } }),
    );
    process.env["REX_FAST_READS"] = "0";
    const { readPerfFlags } = await import("../../../src/store/perf-flags.js");
    expect(readPerfFlags(rexDir)).toEqual({ fastReads: false, fastWrites: true });
  });

  it("treats an unrecognised environment value as unset, not as false", async () => {
    await writeFile(
      join(rexDir, "config.json"),
      JSON.stringify({ schema: SCHEMA_VERSION, project: "x", adapter: "file", performance: { fastReads: true } }),
    );
    process.env["REX_FAST_READS"] = "maybe";
    const { readPerfFlags } = await import("../../../src/store/perf-flags.js");
    expect(readPerfFlags(rexDir).fastReads).toBe(true);
  });

  it("survives a missing or unparseable config without throwing", async () => {
    const { readPerfFlags } = await import("../../../src/store/perf-flags.js");
    expect(readPerfFlags(rexDir).fastReads).toBe(false);
    await writeFile(join(rexDir, "config.json"), "{ not json");
    clearPerfFlagCache();
    expect(readPerfFlags(rexDir).fastReads).toBe(false);
  });
});
