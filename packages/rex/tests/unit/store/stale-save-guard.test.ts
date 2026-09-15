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
import { parseFolderTree } from "../../../src/store/folder-tree-parser.js";
import { FolderTreeStore } from "../../../src/store/folder-tree-store.js";
import type { PRDItem } from "../../../src/schema/index.js";

function epic(id: string, title: string, children: PRDItem[] = []): PRDItem {
  return { id, title, level: "epic", status: "pending", ...(children.length ? { children } : {}) };
}

function task(id: string, title: string, description?: string): PRDItem {
  return { id, title, level: "task", status: "pending", ...(description ? { description } : {}) };
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
    const { fileDigests: loadedFiles } = await parseFolderTree(treeRoot);
    // Freeze the pathological clock: the leaf reads as written AFTER the load.
    const future = new Date(Date.now() + 5_000);
    await utimes(leafPath, future, future);

    await serializeFolderTree(
      [epic("a", "Alpha", [task("a1", "First Child")])],
      treeRoot,
      { loadedAt, loadedFiles },
    );

    // Promoted: the leaf is gone, the folder form exists, the child landed.
    await expect(stat(leafPath)).rejects.toThrow();
    const entries = await readdir(join(treeRoot, "alpha"));
    expect(entries).toContain("index.md");
    expect(entries.some((e) => e.includes("first-child"))).toBe(true);
  });

  it("vouches for a relocation with the digests a previous save returned, without reloading", async () => {
    // Same writer, two saves, no load in between: create a leaf, then promote
    // it. The first save's fileDigests are the identity the second save needs.
    const first = await serializeFolderTree([epic("a", "Alpha")], treeRoot, { loadedAt: 0, allowBulkDelete: true });
    const leafPath = join(treeRoot, "alpha.md");
    const loadedAt = Date.now();
    const future = new Date(Date.now() + 5_000);
    await utimes(leafPath, future, future);

    await serializeFolderTree(
      [epic("a", "Alpha", [task("a1", "First Child")])],
      treeRoot,
      { loadedAt, loadedFiles: first.fileDigests },
    );
    await expect(stat(leafPath)).rejects.toThrow();
    expect(await readdir(join(treeRoot, "alpha"))).toContain("index.md");
  });

  it("refuses a relocation whose source file changed since the snapshot loaded it", async () => {
    // The item id is in the save (it is being moved, not deleted), but the
    // file about to be removed no longer digests to what this snapshot read:
    // someone edited it in between, and the copy landing at the destination
    // does not carry that edit.
    await serializeFolderTree([epic("a", "Alpha", [task("x", "Item X")]), epic("b", "Beta")], treeRoot);
    const loadedAt = Date.now();
    const { fileDigests: loadedFiles } = await parseFolderTree(treeRoot);
    await sleep(10);
    // Concurrent editor changes X in place.
    await serializeFolderTree(
      [epic("a", "Alpha", [task("x", "Item X", "edited concurrently")]), epic("b", "Beta")],
      treeRoot,
    );

    // Stale mover relocates X (old content) from Alpha to Beta.
    await expect(
      serializeFolderTree(
        [epic("a", "Alpha"), epic("b", "Beta", [task("x", "Item X")])],
        treeRoot,
        { loadedAt, loadedFiles },
      ),
    ).rejects.toThrow(/Item X/);

    // The edited source survives.
    const after = await parseFolderTree(treeRoot);
    const alpha = after.items.find((i) => i.id === "a")!;
    expect(alpha.children?.find((c) => c.id === "x")?.description).toBe("edited concurrently");
  });

  it("without load-time identity, a newer file is protected even when its id is in the save", async () => {
    // loadedAt alone cannot distinguish a same-writer promotion from a move
    // over a concurrent edit, so the exemption requires loadedFiles.
    await serializeFolderTree([epic("a", "Alpha")], treeRoot);
    const leafPath = join(treeRoot, "alpha.md");
    const loadedAt = Date.now();
    const future = new Date(Date.now() + 5_000);
    await utimes(leafPath, future, future);

    await expect(
      serializeFolderTree([epic("a", "Alpha", [task("a1", "First Child")])], treeRoot, { loadedAt }),
    ).rejects.toThrow(/Alpha/);
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

  it("refuses a move that would overwrite a concurrent edit to the same item (store path)", async () => {
    // Regression for the id-only relocation exemption: two writers load X;
    // A edits X and saves; B, on its old snapshot, moves X under another
    // parent. B's save must fail rather than replace A's edit with B's copy.
    const rexDir = join(dir, ".rex");
    const seed = new FolderTreeStore(rexDir);
    await seed.saveDocument({
      schema: "rex/v1",
      title: "PRD",
      items: [epic("a", "Alpha", [task("x", "Item X")]), epic("b", "Beta")],
    });

    const editor = new FolderTreeStore(rexDir);
    const editorDoc = await editor.loadDocument();
    const mover = new FolderTreeStore(rexDir);
    const moverDoc = await mover.loadDocument();
    await sleep(10);

    // A edits X in place and saves.
    const editorX = editorDoc.items.find((i) => i.id === "a")!.children!.find((c) => c.id === "x")!;
    editorX.description = "edited by A";
    await editor.saveDocument(editorDoc);

    // B moves X from Alpha to Beta using its stale copy of X.
    const moverA = moverDoc.items.find((i) => i.id === "a")!;
    const moverB = moverDoc.items.find((i) => i.id === "b")!;
    const staleX = moverA.children!.find((c) => c.id === "x")!;
    moverA.children = moverA.children!.filter((c) => c.id !== "x");
    moverB.children = [staleX];

    await expect(mover.saveDocument(moverDoc)).rejects.toThrow(/Item X/);

    // A's edit is still on disk at the source.
    const after = await seed.loadDocument();
    const alphaAfter = after.items.find((i) => i.id === "a")!;
    expect(alphaAfter.children?.find((c) => c.id === "x")?.description).toBe("edited by A");
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
