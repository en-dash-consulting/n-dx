/**
 * `withTransaction` mutation-stamping tests.
 *
 * The single-item store methods (addItem/updateItem/removeItem) stamp
 * `lastModified` themselves. A caller that mutates the tree directly inside
 * `withTransaction` — which is how the dashboard's bulk update, its merge
 * route, the Ask panel's apply-refinements, and the CLI restructurers all
 * write — bypassed those methods and so bypassed the stamp. The item was
 * written to disk looking untouched, and `isModifiedSinceSync` (see
 * packages/rex/src/core/sync.ts) never observed it: the change was skipped on
 * push, then overwritten by the remote's value on the next pull.
 *
 * So the stamp belongs to the transaction, not to each caller. These tests pin
 * that it fires for what actually changed, and only for that — an empty
 * transaction is a real pattern here (migrate-slugs and reshape both open one
 * purely to force a rewrite) and must not mark the whole tree modified.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FolderTreeStore, ensureFolderTreeRexDir } from "../../../src/store/folder-tree-store.js";
import { FileStore } from "../../../src/store/file-adapter.js";
import { SCHEMA_VERSION } from "../../../src/schema/index.js";
import { toCanonicalJSON } from "../../../src/core/canonical.js";
import { findItem, removeFromTree, updateInTree, insertChild } from "../../../src/core/tree.js";
import type { PRDStore } from "../../../src/store/contracts.js";
import type { PRDItem } from "../../../src/schema/index.js";

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** An epic with two task children, so sibling isolation is observable. */
function seedItems(): PRDItem[] {
  return [
    {
      id: "epic-1",
      title: "Epic One",
      level: "epic",
      status: "pending",
      children: [
        { id: "task-a", title: "Task A", level: "task", status: "pending" },
        { id: "task-b", title: "Task B", level: "task", status: "pending" },
      ],
    } as PRDItem,
  ];
}

/**
 * Both local stores, run through the same expectations.
 *
 * FileStore and FolderTreeStore have separate `withTransaction`
 * implementations over the same folder-tree backend, so a fix applied to one
 * is not a fix applied to the other.
 */
const STORES: Array<{ name: string; create: (rexDir: string) => PRDStore }> = [
  { name: "FolderTreeStore", create: (rexDir) => new FolderTreeStore(rexDir) },
  { name: "FileStore", create: (rexDir) => new FileStore(rexDir) },
];

describe.each(STORES)("$name withTransaction stamping", ({ create }) => {
  let tmpDir: string;
  let rexDir: string;
  let store: PRDStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-txn-stamp-"));
    rexDir = join(tmpDir, ".rex");
    await ensureFolderTreeRexDir(rexDir);
    await writeFile(
      join(rexDir, "config.json"),
      toCanonicalJSON({ schema: SCHEMA_VERSION, project: "txn-stamp", adapter: "folder-tree" }),
      "utf-8",
    );
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
    await writeFile(join(rexDir, "workflow.md"), "# Workflow", "utf-8");

    store = create(rexDir);
    await store.saveDocument({
      schema: "rex/v1",
      title: "Transaction Stamping",
      items: seedItems(),
    });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("stamps an item mutated directly in the tree", async () => {
    await store.withTransaction(async (doc) => {
      updateInTree(doc.items, "task-a", { description: "Rewritten by a route." });
    });

    const item = await store.getItem("task-a");
    expect(item!.description).toBe("Rewritten by a route.");
    expect(item!.lastModified as string).toMatch(ISO_TIMESTAMP);
    expect(item!.lastModifiedBy).toBeTruthy();
  });

  it("leaves an item the transaction did not touch unstamped", async () => {
    await store.withTransaction(async (doc) => {
      updateInTree(doc.items, "task-a", { description: "Only this one changed." });
    });

    expect((await store.getItem("task-b"))!.lastModified).toBeUndefined();
  });

  it("stamps nothing when the transaction changes nothing", async () => {
    // migrate-slugs and reshape both open an empty transaction purely to force
    // a rewrite. Stamping unconditionally would mark every item in the PRD
    // modified, and every one of them would then push on the next sync.
    await store.withTransaction(async () => {});

    for (const id of ["epic-1", "task-a", "task-b"]) {
      expect((await store.getItem(id))!.lastModified, `"${id}" was stamped`).toBeUndefined();
    }
  });

  it("stamps the parent when a child is removed from the tree", async () => {
    // Settle before deleting. The stale-save guard compares the doomed file's
    // high-resolution mtimeMs against `loadedAt`, which is `Date.now()` — and
    // on Windows that advances in ~15 ms ticks, so a file seeded and deleted
    // inside one tick reads as "written after the load" and the save is
    // refused. Nothing to do with stamping; see the same flakiness described
    // at analyze.ts's single-transaction insert.
    await new Promise((resolve) => setTimeout(resolve, 25));

    // The parent's own fields are untouched, but its stored content changes —
    // the children list is part of what is written. FolderTreeStore.removeItem
    // already re-stamps the parent by hand for this reason; a raw
    // removeFromTree must not be the path that skips it.
    await store.withTransaction(async (doc) => {
      removeFromTree(doc.items, "task-a");
    });

    expect((await store.getItem("epic-1"))!.lastModified as string).toMatch(ISO_TIMESTAMP);
  });

  it("stamps an item inserted without a stamp of its own", async () => {
    await store.withTransaction(async (doc) => {
      insertChild(doc.items, "epic-1", {
        id: "task-c",
        title: "Task C",
        level: "task",
        status: "pending",
      } as PRDItem);
    });

    expect((await store.getItem("task-c"))!.lastModified as string).toMatch(ISO_TIMESTAMP);
  });

  it("keeps the stamp an inserted item already carries", async () => {
    // analyze.ts stamps its accepted items before opening the transaction and
    // says so explicitly — that stamp is the caller's to set, not ours to
    // overwrite.
    const carried = "2020-01-01T00:00:00.000Z";
    await store.withTransaction(async (doc) => {
      insertChild(doc.items, "epic-1", {
        id: "task-d",
        title: "Task D",
        level: "task",
        status: "pending",
        lastModified: carried,
        lastModifiedBy: "Someone Else <someone@example.com>",
      } as PRDItem);
    });

    const item = await store.getItem("task-d");
    expect(item!.lastModified).toBe(carried);
    expect(item!.lastModifiedBy).toBe("Someone Else <someone@example.com>");
  });

  it("treats attribution alone as a stamp the caller already set", async () => {
    // A bundle import carries `lastModifiedBy` for items whose source project
    // never recorded a `lastModified`. Keying "carries its own stamp" on the
    // timestamp alone rewrote the original author to the importer on exactly
    // those items — the provenance a transport artifact exists to preserve.
    await store.withTransaction(async (doc) => {
      insertChild(doc.items, "epic-1", {
        id: "task-e",
        title: "Task E",
        level: "task",
        status: "pending",
        lastModifiedBy: "Someone Else <someone@example.com>",
      } as PRDItem);
    });

    const item = await store.getItem("task-e");
    expect(item!.lastModifiedBy).toBe("Someone Else <someone@example.com>");
  });

  it("advances an existing stamp rather than only setting an absent one", async () => {
    // The sync consequence is a comparison, not a presence check:
    // isModifiedSinceSync asks whether lastModified > lastSyncedAt. An item
    // already carrying an older stamp is exactly the case that silently
    // failed to push.
    const old = "2020-01-01T00:00:00.000Z";
    await store.withTransaction(async (doc) => {
      const entry = findItem(doc.items, "task-a");
      Object.assign(entry!.item, { lastModified: old, lastSyncedAt: old });
    });

    await store.withTransaction(async (doc) => {
      updateInTree(doc.items, "task-a", { description: "Edited after the sync." });
    });

    const item = await store.getItem("task-a");
    expect((item!.lastModified as string) > old).toBe(true);
    expect((item!.lastModified as string) > (item!.lastSyncedAt as string)).toBe(true);
  });
});
