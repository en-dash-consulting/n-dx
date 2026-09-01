/**
 * Stale-save guard on removeStaleEntries.
 *
 * Any saveDocument deletes every on-disk item absent from the in-memory tree.
 * A save from a stale snapshot — one taken before a concurrent writer added
 * items — therefore silently destroys work it never loaded, and the only
 * recovery (.rex/.backups/) is gitignored and local. The guard: a deletion
 * candidate whose id was NOT in the loaded document aborts the save loudly,
 * naming the items; a save with no known ids at all requires explicit bulk
 * intent.
 *
 * The guard identifies items rather than timing them. It compared on-disk
 * mtimes against a `Date.now()` taken at load, which cannot work: the two come
 * from different clocks (Node's high-precision system time vs the filesystem's
 * timer tick), and measured against a file written strictly BEFORE the load the
 * delta scattered from −8 ms to +6 ms — refusing legitimate saves 25 times in
 * 40. Note the absence of `sleep()` here: correctness no longer depends on
 * wall-clock separation between a load and a write.
 *
 * @see packages/rex/src/store/folder-tree-serializer.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { serializeFolderTree, collectItemIds } from "../../../src/store/folder-tree-serializer.js";
import { FolderTreeStore } from "../../../src/store/folder-tree-store.js";
import type { PRDItem } from "../../../src/schema/index.js";

function epic(id: string, title: string, children: PRDItem[] = []): PRDItem {
  return { id, title, level: "epic", status: "pending", ...(children.length ? { children } : {}) };
}

function task(id: string, title: string): PRDItem {
  return { id, title, level: "task", status: "pending" };
}

/** The ids a writer would have recorded from loading `items`. */
function loaded(items: PRDItem[]): Set<string> {
  return collectItemIds(items);
}

describe("stale-save guard", () => {
  let dir: string;
  let treeRoot: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "stale-save-"));
    treeRoot = join(dir, "prd_tree");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("errors instead of deleting an item written after the snapshot was loaded", async () => {
    // On-disk tree: A and B. A snapshot of exactly that is loaded.
    const snapshot = [epic("a", "Alpha"), epic("b", "Beta")];
    await serializeFolderTree(snapshot, treeRoot);
    const knownItemIds = loaded(snapshot);

    // ...then a concurrent writer adds C, which the snapshot never saw.
    await serializeFolderTree([...snapshot, epic("c", "Concurrent Item")], treeRoot);

    // Saving the stale {A, B} snapshot would delete C. It must refuse.
    await expect(
      serializeFolderTree(snapshot, treeRoot, { knownItemIds }),
    ).rejects.toThrow(/Concurrent Item/);

    // And C must still be on disk.
    const entries = await readdir(treeRoot);
    expect(entries.some((e) => e.includes("concurrent-item"))).toBe(true);
  });

  it("names every item the save would have deleted", async () => {
    const snapshot = [epic("a", "Alpha")];
    await serializeFolderTree(snapshot, treeRoot);
    const knownItemIds = loaded(snapshot);

    await serializeFolderTree(
      [epic("a", "Alpha"), epic("c", "Concurrent One"), epic("d", "Concurrent Two")],
      treeRoot,
    );

    await expect(
      serializeFolderTree(snapshot, treeRoot, { knownItemIds }),
    ).rejects.toThrow(/Concurrent One[\s\S]*Concurrent Two|Concurrent Two[\s\S]*Concurrent One/);
  });

  it("catches a new child inside an old folder, not just new top-level entries", async () => {
    // The folder for A predates the load; only the child inside it is new, so
    // the check has to recurse rather than stop at the directory it is asked
    // about.
    const snapshot = [epic("a", "Alpha", [task("a1", "Old Child")])];
    await serializeFolderTree(snapshot, treeRoot);
    const knownItemIds = loaded(snapshot);

    await serializeFolderTree(
      [epic("a", "Alpha", [task("a1", "Old Child"), task("a2", "New Child")])],
      treeRoot,
    );

    // A stale save that drops the whole A subtree must see the fresh child.
    await expect(
      serializeFolderTree([epic("b", "Beta")], treeRoot, { knownItemIds }),
    ).rejects.toThrow(/Alpha|New Child/);
  });

  it("allows deletions of entries the snapshot actually saw (normal load-edit-save)", async () => {
    const snapshot = [epic("a", "Alpha"), epic("b", "Beta"), epic("c", "Gamma")];
    await serializeFolderTree(snapshot, treeRoot);
    const knownItemIds = loaded(snapshot);

    // The snapshot saw all three; deliberately removing C is fine.
    await serializeFolderTree([epic("a", "Alpha"), epic("b", "Beta")], treeRoot, { knownItemIds });
    const entries = await readdir(treeRoot);
    expect(entries.some((e) => e.includes("gamma"))).toBe(false);
    expect(entries.some((e) => e.includes("alpha"))).toBe(true);
  });

  /**
   * The false positive that motivated the rewrite: an item gaining its first
   * child moves from `<slug>.md` to `<slug>/index.md`, so the leaf file becomes
   * a deletion candidate. It is the SAME item the snapshot loaded, and the
   * timestamp check flagged it anyway whenever the clocks disagreed.
   */
  it("allows a leaf being promoted to a folder by the writer that loaded it", async () => {
    const snapshot = [epic("a", "Alpha")];
    await serializeFolderTree(snapshot, treeRoot);
    const knownItemIds = loaded(snapshot);

    // Same writer, same snapshot, now giving A a child — no concurrency at all.
    await serializeFolderTree([epic("a", "Alpha", [task("a1", "First Child")])], treeRoot, {
      knownItemIds,
    });

    const entries = await readdir(treeRoot);
    expect(entries.some((e) => e === "alpha-a")).toBe(true);
    expect(entries.some((e) => e.endsWith(".md"))).toBe(false);
  });

  it("refuses deletions from a save that never loaded, unless bulk intent is explicit", async () => {
    await serializeFolderTree([epic("a", "Alpha"), epic("b", "Beta")], treeRoot);

    // An empty set is the stores' "this instance never loaded the tree" value.
    await expect(
      serializeFolderTree([epic("a", "Alpha")], treeRoot, { knownItemIds: new Set() }),
    ).rejects.toThrow(/Beta/);

    // Explicit bulk intent (a deliberate rewrite, e.g. migration) goes through.
    await serializeFolderTree([epic("a", "Alpha")], treeRoot, {
      knownItemIds: new Set(),
      allowBulkDelete: true,
    });
    const entries = await readdir(treeRoot);
    expect(entries.some((e) => e.includes("beta"))).toBe(false);
  });

  it("guards the store write path end to end", async () => {
    const rexDir = join(dir, ".rex");
    const seed = new FolderTreeStore(rexDir);
    await seed.saveDocument({ schema: "rex/v1", title: "PRD", items: [epic("a", "Alpha")] });

    // Writer 1 loads a snapshot.
    const staleWriter = new FolderTreeStore(rexDir);
    const staleDoc = await staleWriter.loadDocument();

    // Writer 2 adds an item after that load.
    const otherWriter = new FolderTreeStore(rexDir);
    await otherWriter.addItem(epic("c", "Concurrent Item"));

    // Writer 1 saves its stale snapshot — the guard must refuse, and the
    // concurrent item must survive.
    await expect(staleWriter.saveDocument(staleDoc)).rejects.toThrow(/Concurrent Item/);
    const after = await otherWriter.loadDocument();
    expect(after.items.some((i) => i.id === "c")).toBe(true);
  });

  /**
   * A store that loads and then repeatedly mutates must not accumulate false
   * positives — this is the sequence that failed 25 times in 40.
   */
  it("survives repeated load-mutate-save cycles through the store", async () => {
    const rexDir = join(dir, ".rex");
    const store = new FolderTreeStore(rexDir);

    await store.addItem(epic("e1", "Auth System"));
    for (let i = 0; i < 15; i++) {
      await store.addItem(task(`t${i}`, `Task ${i}`), "e1");
    }

    const doc = await store.loadDocument();
    expect(doc.items[0].children).toHaveLength(15);
  });
});
