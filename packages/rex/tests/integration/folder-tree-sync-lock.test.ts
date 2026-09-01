/**
 * `syncFolderTree` is a write path and must obey the write rules.
 *
 * Every PRD mutation handler calls it after its transaction commits, to
 * re-serialize the store's document to `.rex/prd_tree/`. It used to do an
 * unlocked, unguarded `loadDocument() -> serializeFolderTree()`:
 *
 *   - No lock, so it ran concurrently with any writer queued behind the
 *     transaction that had just released one.
 *   - No `knownItemIds`, which disables `guardStaleEntries` entirely — the
 *     serializer's protection against a stale snapshot deleting another
 *     writer's items. Deletions were therefore applied silently.
 *
 * Together those made an acknowledged write disappear: a second writer's
 * `addItem` resolved successfully, then the sync — holding a document loaded
 * before that insert — deleted the item it had never seen. No error, no log.
 * That is the failure behind the intermittent red in
 * `concurrent-write-lost-update.test.ts`; the lock was never the problem, a
 * write path that bypassed it was.
 *
 * These tests pin both halves of the fix and are deterministic: they
 * synchronise on lock state and on an explicit gate, never on a wall clock.
 *
 * @see packages/rex/src/cli/commands/folder-tree-sync.ts
 * @see packages/rex/src/store/folder-tree-serializer.ts — guardStaleEntries
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileStore } from "../../src/store/file-adapter.js";
import { PRD_TREE_DIRNAME } from "../../src/store/paths.js";
import { syncFolderTree } from "../../src/cli/commands/folder-tree-sync.js";
import type { PRDStore } from "../../src/store/contracts.js";
import type { PRDDocument, PRDItem } from "../../src/schema/index.js";

function task(id: string, title: string): PRDItem {
  return { id, title, level: "task", status: "pending" };
}

/** Pause a store's read after it returns, so a test can act inside the window. */
function withPauseAfterLoad(inner: PRDStore, pause: () => Promise<void>): PRDStore {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === "loadDocument") {
        return async (): Promise<PRDDocument> => {
          const doc = await target.loadDocument();
          await pause();
          return doc;
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as PRDStore;
}

describe("syncFolderTree does not lose concurrent writes", () => {
  let projectDir: string;
  let rexDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "rex-sync-lock-"));
    rexDir = join(projectDir, ".rex");
    await mkdir(rexDir, { recursive: true });
    await writeFile(join(rexDir, "config.json"), JSON.stringify({ version: "1.0" }), "utf-8");
    const seed = new FileStore(rexDir);
    await seed.saveDocument({
      schema: "rex/v1",
      title: "Test PRD",
      items: [
        {
          id: "epic-1",
          title: "Epic One",
          level: "epic",
          status: "pending",
          children: [task("task-1", "Task One")],
        },
        { id: "epic-2", title: "Epic Two", level: "epic", status: "pending" },
      ],
    });
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("refuses to delete an item that appeared after its own read, instead of erasing it silently", async () => {
    // Defence in depth for a writer that reached the tree without the lock —
    // another process's stray write, or a future call site that forgets. The
    // lock makes this unreachable through the supported paths; the guard is
    // what turns it into a loud failure if it ever is reached.
    const treeRoot = join(rexDir, PRD_TREE_DIRNAME);
    const store = withPauseAfterLoad(new FileStore(rexDir), async () => {
      // Written after the sync's read, so its document cannot know about it.
      await writeFile(
        join(treeRoot, "epic-three-epic3.md"),
        "---\nid: \"epic-3\"\nlevel: \"epic\"\ntitle: \"Epic Three\"\nstatus: \"pending\"\n---\n",
        "utf-8",
      );
    });

    await expect(syncFolderTree(rexDir, store)).rejects.toThrow(/Stale-save guard/);

    // Refused, not half-applied: the item is still on disk.
    expect(existsSync(join(treeRoot, "epic-three-epic3.md"))).toBe(true);
  });

  it("waits for an open transaction instead of serializing alongside it", async () => {
    const store = new FileStore(rexDir);

    const order: string[] = [];
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => { openGate = resolve; });
    let inCallback!: () => void;
    const callbackEntered = new Promise<void>((resolve) => { inCallback = resolve; });

    const txn = store.withTransaction(async (doc) => {
      inCallback();
      await gate;
      const epicTwo = doc.items.find((i) => i.id === "epic-2");
      epicTwo!.children = [task("task-in-txn", "From Transaction")];
      order.push("transaction-committed");
    });

    await callbackEntered;
    // Sync is launched while the transaction holds the lock. It must block.
    const sync = syncFolderTree(rexDir, new FileStore(rexDir)).then(() => order.push("sync-completed"));

    // Hand the event loop enough turns for an unlocked sync to slip past.
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(order).toEqual([]);

    openGate();
    await txn;
    await sync;

    expect(order).toEqual(["transaction-committed", "sync-completed"]);
    // The transaction's write survived the sync that followed it.
    const after = await new FileStore(rexDir).loadDocument();
    expect(after.items.find((i) => i.id === "epic-2")?.children?.some((c) => c.id === "task-in-txn")).toBe(true);
  });

  it("makes a writer wait for a held lock rather than failing it", async () => {
    // Documents addItem's behaviour under contention: same-process writers
    // queue on the in-process mutex and proceed when it frees, rather than
    // rejecting. Rejection happens only when the acquire timeout expires,
    // which concurrent-write-lost-update.test.ts covers for another process.
    const store = new FileStore(rexDir);

    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => { openGate = resolve; });
    let inCallback!: () => void;
    const callbackEntered = new Promise<void>((resolve) => { inCallback = resolve; });

    let addResolved = false;
    const txn = store.withTransaction(async () => {
      inCallback();
      await gate;
    });

    await callbackEntered;
    const add = new FileStore(rexDir)
      .addItem(task("task-queued", "Queued Behind The Lock"), "epic-2")
      .then(() => { addResolved = true; });

    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(addResolved).toBe(false); // waiting, not failed

    openGate();
    await txn;
    await add;

    expect(addResolved).toBe(true);
    const after = await new FileStore(rexDir).loadDocument();
    expect(after.items.find((i) => i.id === "epic-2")?.children?.some((c) => c.id === "task-queued")).toBe(true);
  });
});
