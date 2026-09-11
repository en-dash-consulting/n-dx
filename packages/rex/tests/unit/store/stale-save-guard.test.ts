/**
 * Stale-save guard on removeStaleEntries.
 *
 * Any saveDocument deletes every on-disk item absent from the in-memory tree.
 * A save from a stale snapshot — one taken before a concurrent writer added
 * items — therefore silently destroys work it never loaded, and the only
 * recovery (.rex/.backups/) is gitignored and local. The guard: deletion
 * candidates whose on-disk state is NEWER than the snapshot's load time abort
 * the save loudly, naming the items; deletions with no load time at all
 * require explicit bulk intent.
 *
 * @see packages/rex/src/store/folder-tree-serializer.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir, utimes, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { serializeFolderTree } from "../../../src/store/folder-tree-serializer.js";
import { FolderTreeStore } from "../../../src/store/folder-tree-store.js";
import type { PRDItem } from "../../../src/schema/index.js";

function epic(id: string, title: string, children: PRDItem[] = []): PRDItem {
  return { id, title, level: "epic", status: "pending", ...(children.length ? { children } : {}) };
}

function task(id: string, title: string): PRDItem {
  return { id, title, level: "task", status: "pending" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    // On-disk tree: A and B.
    await serializeFolderTree([epic("a", "Alpha"), epic("b", "Beta")], treeRoot);

    // A snapshot is loaded now...
    const loadedAt = Date.now();
    await sleep(10);
    // ...then a concurrent writer adds C, after the load.
    await serializeFolderTree([epic("a", "Alpha"), epic("b", "Beta"), epic("c", "Concurrent Item")], treeRoot);

    // Saving the stale {A, B} snapshot would delete C. It must refuse.
    await expect(
      serializeFolderTree([epic("a", "Alpha"), epic("b", "Beta")], treeRoot, { loadedAt }),
    ).rejects.toThrow(/Concurrent Item/);

    // And C must still be on disk.
    const entries = await readdir(treeRoot);
    expect(entries.some((e) => e.includes("concurrent-item"))).toBe(true);
  });

  it("names every item the save would have deleted", async () => {
    await serializeFolderTree([epic("a", "Alpha")], treeRoot);
    const loadedAt = Date.now();
    await sleep(10);
    await serializeFolderTree(
      [epic("a", "Alpha"), epic("c", "Concurrent One"), epic("d", "Concurrent Two")],
      treeRoot,
    );

    await expect(
      serializeFolderTree([epic("a", "Alpha")], treeRoot, { loadedAt }),
    ).rejects.toThrow(/Concurrent One[\s\S]*Concurrent Two|Concurrent Two[\s\S]*Concurrent One/);
  });

  it("catches a new child inside an old folder, not just new top-level entries", async () => {
    // The folder for A predates the load; only the child inside it is new.
    await serializeFolderTree([epic("a", "Alpha", [task("a1", "Old Child")])], treeRoot);
    const loadedAt = Date.now();
    await sleep(10);
    await serializeFolderTree(
      [epic("a", "Alpha", [task("a1", "Old Child"), task("a2", "New Child")])],
      treeRoot,
    );

    // A stale save that drops the whole A subtree must see the fresh child.
    await expect(
      serializeFolderTree([epic("b", "Beta")], treeRoot, { loadedAt }),
    ).rejects.toThrow(/Alpha|New Child/);
  });

  it("allows deletions of entries the snapshot actually saw (normal load-edit-save)", async () => {
    await serializeFolderTree([epic("a", "Alpha"), epic("b", "Beta"), epic("c", "Gamma")], treeRoot);
    await sleep(10);
    const loadedAt = Date.now();

    // The snapshot saw all three; deliberately removing C is fine.
    await serializeFolderTree([epic("a", "Alpha"), epic("b", "Beta")], treeRoot, { loadedAt });
    const entries = await readdir(treeRoot);
    expect(entries.some((e) => e.includes("gamma"))).toBe(false);
    expect(entries.some((e) => e.includes("alpha"))).toBe(true);
  });

  it("refuses deletions from a save that never loaded, unless bulk intent is explicit", async () => {
    await serializeFolderTree([epic("a", "Alpha"), epic("b", "Beta")], treeRoot);

    // loadedAt: 0 is the stores' "this instance never loaded the tree" value.
    await expect(
      serializeFolderTree([epic("a", "Alpha")], treeRoot, { loadedAt: 0 }),
    ).rejects.toThrow(/Beta/);

    // Explicit bulk intent (a deliberate rewrite, e.g. migration) goes through.
    await serializeFolderTree([epic("a", "Alpha")], treeRoot, {
      loadedAt: 0,
      allowBulkDelete: true,
    });
    const entries = await readdir(treeRoot);
    expect(entries.some((e) => e.includes("beta"))).toBe(false);
  });

  it("allows a same-writer leaf-to-folder promotion even when clocks say the leaf is newer", async () => {
    // Observed live as the flaky web-route 400s: a handler adds an epic
    // (written as a bare `<slug>.md` leaf) and then its first child in
    // back-to-back transactions. The promotion to `<slug>/index.md` removes
    // the leaf file the same writer created milliseconds earlier, and under
    // Windows timestamp granularity the leaf's mtime can postdate the second
    // transaction's load. The item's id is in the document being saved, so
    // nothing is deleted — the guard must not fire on a relocation.
    await serializeFolderTree([epic("a", "Alpha")], treeRoot);
    const leafPath = join(treeRoot, "alpha.md");
    const loadedAt = Date.now();
    // Freeze the pathological clock: the leaf reads as written AFTER the load.
    const future = new Date(Date.now() + 5_000);
    await utimes(leafPath, future, future);

    await serializeFolderTree(
      [epic("a", "Alpha", [task("a1", "First Child")])],
      treeRoot,
      { loadedAt },
    );

    // Promoted: the leaf is gone, the folder form exists, the child landed.
    await expect(stat(leafPath)).rejects.toThrow();
    const entries = await readdir(join(treeRoot, "alpha"));
    expect(entries).toContain("index.md");
    expect(entries.some((e) => e.includes("first-child"))).toBe(true);
  });

  it("still refuses a newer entry whose item is absent from the save", async () => {
    // The relocation exemption is keyed on item id, not mtime — an item the
    // saved document does not carry keeps the guard's full protection even
    // under the same pathological clock.
    await serializeFolderTree([epic("a", "Alpha"), epic("c", "Concurrent Item")], treeRoot);
    const loadedAt = Date.now();
    const future = new Date(Date.now() + 5_000);
    const entries = await readdir(treeRoot);
    const cFile = entries.find((e) => e.includes("concurrent-item"))!;
    await utimes(join(treeRoot, cFile), future, future);

    await expect(
      serializeFolderTree([epic("a", "Alpha")], treeRoot, { loadedAt }),
    ).rejects.toThrow(/Concurrent Item/);
  });

  it("guards the store write path end to end", async () => {
    const rexDir = join(dir, ".rex");
    const seed = new FolderTreeStore(rexDir);
    await seed.saveDocument({ schema: "rex/v1", title: "PRD", items: [epic("a", "Alpha")] });

    // Writer 1 loads a snapshot.
    const staleWriter = new FolderTreeStore(rexDir);
    const staleDoc = await staleWriter.loadDocument();
    await sleep(10);

    // Writer 2 adds an item after that load.
    const otherWriter = new FolderTreeStore(rexDir);
    await otherWriter.addItem(epic("c", "Concurrent Item"));

    // Writer 1 saves its stale snapshot — the guard must refuse, and the
    // concurrent item must survive.
    await expect(staleWriter.saveDocument(staleDoc)).rejects.toThrow(/Concurrent Item/);
    const after = await otherWriter.loadDocument();
    expect(after.items.some((i) => i.id === "c")).toBe(true);
  });
});
