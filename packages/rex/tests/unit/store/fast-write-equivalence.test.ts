/**
 * `performance.fastWrites` must leave the tree exactly where the full write
 * would have left it.
 *
 * Every case here runs the *same* mutation twice against two byte-identical
 * copies of the same fixture — once with the flag off, once with it on — and
 * then compares the entire `prd_tree/` directory file by file, content
 * included. Anything the targeted write gets wrong about placement, slugs,
 * frontmatter or the parent's children table shows up as a diff.
 *
 * Two things are tested beyond equality:
 *
 *   - that the fast path actually engaged where it is supposed to (otherwise
 *     every assertion passes by doing nothing), observed through
 *     `tree-meta.json`, which the full write rewrites on every save and the
 *     targeted write never touches;
 *   - that it *declines* on the mutations that move files — a retitle, a
 *     child being added — and that the fallback result is still correct.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, readdir, readFile, rm, stat, cp } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { FileStore } from "../../../src/store/file-adapter.js";
import { clearPerfFlagCache } from "../../../src/store/perf-flags.js";
import { PRD_TREE_DIRNAME } from "../../../src/store/paths.js";
import { SCHEMA_VERSION } from "../../../src/schema/index.js";
import type { PRDItem } from "../../../src/schema/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Every file under `dir`, as relative path → contents. */
async function snapshot(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.set(relative(dir, full).split("\\").join("/"), await readFile(full, "utf-8"));
    }
  }
  await walk(dir);
  return out;
}

function diffSnapshots(a: Map<string, string>, b: Map<string, string>): string[] {
  const problems: string[] = [];
  for (const [path, content] of a) {
    if (!b.has(path)) problems.push(`only in slow: ${path}`);
    else if (b.get(path) !== content) problems.push(`content differs: ${path}`);
  }
  for (const path of b.keys()) {
    if (!a.has(path)) problems.push(`only in fast: ${path}`);
  }
  return problems;
}

function store(rexDir: string): FileStore {
  return new FileStore(rexDir, { currentBranchFile: "prd.json" });
}

const FIXTURE: PRDItem[] = [
  {
    id: "e1", title: "Platform Work", level: "epic", status: "pending",
    children: [
      {
        id: "f1", title: "Dashboard", level: "feature", status: "pending",
        children: [
          { id: "t1", title: "Add a button", level: "task", status: "pending",
            priority: "high", tags: ["ui"] } as PRDItem,
          { id: "t2", title: "Wire the route", level: "task", status: "pending",
            children: [
              { id: "s1", title: "Handler", level: "subtask", status: "pending" },
              { id: "s2", title: "Tests", level: "subtask", status: "pending" },
            ] } as PRDItem,
        ],
      } as PRDItem,
      // A task directly under an epic — no feature between.
      { id: "t3", title: "Orphan task", level: "task", status: "pending" } as PRDItem,
    ],
  } as PRDItem,
  {
    id: "e2", title: "Second Epic", level: "epic", status: "pending",
    children: [
      { id: "f2", title: "Lonely Feature", level: "feature", status: "pending",
        children: [{ id: "t4", title: "Only task", level: "task", status: "pending" } as PRDItem] } as PRDItem,
    ],
  } as PRDItem,
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fastWrites equivalence", () => {
  let tmp: string;
  let slowRex: string;
  let fastRex: string;

  /** Build one fixture, then clone it so both runs start byte-identical. */
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "fast-write-"));
    slowRex = join(tmp, "slow", ".rex");
    fastRex = join(tmp, "fast", ".rex");
    await mkdir(join(slowRex, PRD_TREE_DIRNAME), { recursive: true });

    delete process.env["REX_FAST_WRITES"];
    clearPerfFlagCache();
    await store(slowRex).saveDocument({
      schema: SCHEMA_VERSION, title: "Fixture", items: structuredClone(FIXTURE),
    });

    // Settle the fixture to the serializer's fixpoint before measuring
    // anything.
    //
    // A full write re-serializes *every* item from the in-memory document,
    // and the parser materialises defaults the author never wrote — an item
    // with no acceptance criteria loads as `acceptanceCriteria: []` and is
    // written back that way. So the first full write after a tree is created
    // also rewrites items nobody touched. That is a property of the full
    // write, not a disagreement with the targeted one, but it would show up
    // in these comparisons as the fast path "missing" files it was right not
    // to write. One load-and-save reaches the fixpoint; the assertion below
    // proves a further round changes nothing.
    const settle = store(slowRex);
    await settle.saveDocument(await settle.loadDocument());
    const settled = await snapshot(slowRex);
    const again = store(slowRex);
    await again.saveDocument(await again.loadDocument());
    expect(diffSnapshots(settled, await snapshot(slowRex))).toEqual([]);

    await mkdir(join(tmp, "fast"), { recursive: true });
    await cp(slowRex, fastRex, { recursive: true });

    const before = diffSnapshots(await snapshot(slowRex), await snapshot(fastRex));
    expect(before).toEqual([]);
  });

  afterEach(async () => {
    delete process.env["REX_FAST_WRITES"];
    clearPerfFlagCache();
    await rm(tmp, { recursive: true, force: true });
  });

  /**
   * Run `mutate` against both copies and return the directory diff.
   *
   * The clock is pinned to one instant across both runs. Every write stamps
   * `updated` from `Date.now()`, so without this the two copies differ by
   * however long the first run took — a difference in the test's timing, not
   * in the write path, and one that would mask the real comparison.
   */
  async function bothWays(mutate: (s: FileStore) => Promise<void>): Promise<string[]> {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-03-04T05:06:07.000Z") });
    try {
      delete process.env["REX_FAST_WRITES"];
      clearPerfFlagCache();
      await mutate(store(slowRex));

      process.env["REX_FAST_WRITES"] = "1";
      clearPerfFlagCache();
      await mutate(store(fastRex));
    } finally {
      vi.useRealTimers();
    }

    return diffSnapshots(await snapshot(slowRex), await snapshot(fastRex));
  }

  it("agrees on a status change — the commonest mutation of all", async () => {
    expect(await bothWays((s) => s.updateItem("t1", { status: "completed" }))).toEqual([]);
  });

  it("agrees on a status change to an item carrying a malformed or newer run block", async () => {
    expect(await bothWays(async (s) => {
      await s.updateItem("t1", { run: { vendor: "codex", reviw: true } as never });
      await s.updateItem("t1", { status: "completed" });
    })).toEqual([]);
  });

  it("agrees on a status change to a nested subtask", async () => {
    expect(await bothWays((s) => s.updateItem("s2", { status: "completed" }))).toEqual([]);
  });

  it("agrees on a status change to a task directly under an epic", async () => {
    expect(await bothWays((s) => s.updateItem("t3", { status: "in_progress" }))).toEqual([]);
  });

  it("agrees on a status change to a container's only child", async () => {
    expect(await bothWays((s) => s.updateItem("t4", { status: "completed" }))).toEqual([]);
  });

  it("agrees on a top-level item with no parent to update", async () => {
    expect(await bothWays((s) => s.updateItem("e2", { status: "in_progress" }))).toEqual([]);
  });

  it("agrees on multi-field updates", async () => {
    expect(await bothWays((s) => s.updateItem("t1", {
      status: "completed",
      priority: "low",
      description: "Rewritten description.",
      acceptanceCriteria: ["one", "two"],
    }))).toEqual([]);
  });

  it("agrees on several updates applied in sequence", async () => {
    expect(await bothWays(async (s) => {
      await s.updateItem("t1", { status: "in_progress" });
      await s.updateItem("s1", { status: "completed" });
      await s.updateItem("t1", { status: "completed" });
    })).toEqual([]);
  });

  it("agrees on a retitle, which the fast path must decline", async () => {
    expect(await bothWays((s) => s.updateItem("t1", { title: "Add a different button" }))).toEqual([]);
  });

  it("agrees on a retitle that collides with a sibling's slug", async () => {
    expect(await bothWays((s) => s.updateItem("t1", { title: "Wire the route" }))).toEqual([]);
  });

  it("agrees on a level change, which the fast path must decline", async () => {
    expect(await bothWays((s) => s.updateItem("t3", { level: "feature" } as Partial<PRDItem>))).toEqual([]);
  });

  it("agrees when an item that was a leaf gains a child", async () => {
    expect(await bothWays(async (s) => {
      await s.addItem(
        { id: "s3", title: "New subtask", level: "subtask", status: "pending" } as PRDItem,
        "t1",
      );
      await s.updateItem("t1", { status: "in_progress" });
    })).toEqual([]);
  });

  it("agrees when the item is removed and a sibling is then updated", async () => {
    expect(await bothWays(async (s) => {
      await s.removeItem("t1");
      await s.updateItem("t2", { status: "completed" });
    })).toEqual([]);
  });
});

/**
 * The one place the two paths genuinely produce different *bytes*, and why
 * that is the full write's doing rather than the targeted write's.
 *
 * On a tree that has not yet reached the serializer's fixpoint — one written
 * by an older build, or hand-edited, or freshly created — a full write
 * rewrites every item, normalising defaults the author never typed
 * (`acceptanceCriteria: []` is the common one). The targeted write touches
 * only the item that changed, so the rest of the tree keeps its original
 * bytes.
 *
 * Neither is wrong: the documents they parse back to are identical, which is
 * what the PRD actually means. This is pinned so that the difference stays a
 * known, bounded one — a normalisation that the next full write will apply
 * anyway — rather than something discovered later in a diff and mistaken for
 * data loss.
 */
describe("fastWrites on a tree that is not yet canonical", () => {
  let tmp: string;
  let slowRex: string;
  let fastRex: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "fast-write-raw-"));
    slowRex = join(tmp, "slow", ".rex");
    fastRex = join(tmp, "fast", ".rex");
    await mkdir(join(slowRex, PRD_TREE_DIRNAME), { recursive: true });
    delete process.env["REX_FAST_WRITES"];
    clearPerfFlagCache();
    // Deliberately NOT settled to the fixpoint.
    await store(slowRex).saveDocument({
      schema: SCHEMA_VERSION, title: "Fixture", items: structuredClone(FIXTURE),
    });
    await mkdir(join(tmp, "fast"), { recursive: true });
    await cp(slowRex, fastRex, { recursive: true });
  });

  afterEach(async () => {
    delete process.env["REX_FAST_WRITES"];
    clearPerfFlagCache();
    await rm(tmp, { recursive: true, force: true });
  });

  it("parses back to the same document, even though the bytes differ", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-03-04T05:06:07.000Z") });
    try {
      delete process.env["REX_FAST_WRITES"];
      clearPerfFlagCache();
      await store(slowRex).updateItem("t1", { status: "completed" });

      process.env["REX_FAST_WRITES"] = "1";
      clearPerfFlagCache();
      await store(fastRex).updateItem("t1", { status: "completed" });
    } finally {
      vi.useRealTimers();
    }

    // The bytes differ, and only in the direction described above: the slow
    // path rewrote items the mutation never touched.
    const byteDiff = diffSnapshots(await snapshot(slowRex), await snapshot(fastRex));
    expect(byteDiff.length).toBeGreaterThan(0);
    expect(byteDiff.every((d) => d.startsWith("content differs:"))).toBe(true);
    expect(byteDiff.some((d) => d.includes("add-a-button"))).toBe(false);

    // What the PRD means is identical.
    delete process.env["REX_FAST_WRITES"];
    clearPerfFlagCache();
    const slowDoc = await store(slowRex).loadDocument();
    const fastDoc = await store(fastRex).loadDocument();
    expect(JSON.stringify(fastDoc.items)).toBe(JSON.stringify(slowDoc.items));
  });

  it("converges once the tree is settled by any full write", async () => {
    // A retitle declines the fast path, so the fast copy takes a full write
    // and normalises too — after which the two are byte-identical again.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-03-04T05:06:07.000Z") });
    try {
      for (const [rex, flag] of [[slowRex, undefined], [fastRex, "1"]] as const) {
        if (flag) process.env["REX_FAST_WRITES"] = flag;
        else delete process.env["REX_FAST_WRITES"];
        clearPerfFlagCache();
        await store(rex).updateItem("t1", { title: "Renamed button" });
      }
    } finally {
      vi.useRealTimers();
    }

    expect(diffSnapshots(await snapshot(slowRex), await snapshot(fastRex))).toEqual([]);
  });
});

describe("fastWrites engagement", () => {
  let tmp: string;
  let rexDir: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "fast-write-on-"));
    rexDir = join(tmp, ".rex");
    await mkdir(join(rexDir, PRD_TREE_DIRNAME), { recursive: true });
    delete process.env["REX_FAST_WRITES"];
    clearPerfFlagCache();
    await store(rexDir).saveDocument({
      schema: SCHEMA_VERSION, title: "Fixture", items: structuredClone(FIXTURE),
    });
  });

  afterEach(async () => {
    delete process.env["REX_FAST_WRITES"];
    clearPerfFlagCache();
    await rm(tmp, { recursive: true, force: true });
  });

  /**
   * `tree-meta.json` is the tell: the full write rewrites it on every save,
   * the targeted write never touches it.
   */
  async function metaMtime(): Promise<number> {
    return (await stat(join(rexDir, "tree-meta.json"))).mtimeMs;
  }

  it("takes the targeted path for a status change when the flag is on", async () => {
    const before = await metaMtime();
    await new Promise((r) => setTimeout(r, 20));

    process.env["REX_FAST_WRITES"] = "1";
    clearPerfFlagCache();
    await store(rexDir).updateItem("t1", { status: "completed" });

    expect(await metaMtime()).toBe(before);
  });

  it("takes the full path for the same change when the flag is off", async () => {
    const before = await metaMtime();
    await new Promise((r) => setTimeout(r, 20));

    delete process.env["REX_FAST_WRITES"];
    clearPerfFlagCache();
    await store(rexDir).updateItem("t1", { status: "completed" });

    expect(await metaMtime()).toBeGreaterThan(before);
  });

  it("falls back to the full path for a retitle even with the flag on", async () => {
    const before = await metaMtime();
    await new Promise((r) => setTimeout(r, 20));

    process.env["REX_FAST_WRITES"] = "1";
    clearPerfFlagCache();
    await store(rexDir).updateItem("t1", { title: "Renamed" });

    expect(await metaMtime()).toBeGreaterThan(before);
  });

  it("still reads back what it wrote", async () => {
    process.env["REX_FAST_WRITES"] = "1";
    clearPerfFlagCache();
    const s = store(rexDir);
    await s.updateItem("t1", { status: "completed", description: "done here" });

    const reread = await store(rexDir).getItem("t1");
    expect(reread?.status).toBe("completed");
    expect(reread?.description).toBe("done here");

    // And the parent's children table reflects the new status.
    const doc = await store(rexDir).loadDocument();
    expect(JSON.stringify(doc.items)).toContain("completed");
  });

  it("reports the files it wrote through takeSaveFileReport", async () => {
    process.env["REX_FAST_WRITES"] = "1";
    clearPerfFlagCache();
    const s = store(rexDir);
    await s.updateItem("t1", { status: "completed" });

    const report = s.takeSaveFileReport();
    expect(report).not.toBeNull();
    // The item's own file plus its parent's children table — and nothing else.
    expect(report?.written.length).toBe(2);
    expect(report?.deleted).toEqual([]);
    expect(report?.written.every((p) => p.endsWith(".md"))).toBe(true);
  });
});
