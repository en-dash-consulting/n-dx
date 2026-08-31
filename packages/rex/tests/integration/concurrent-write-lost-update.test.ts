/**
 * Lost-update protection for PRD writers.
 *
 * Every PRD write path used to do an unlocked load→mutate→save: a writer that
 * loaded the document, computed for a while (an LLM round trip in the real
 * commands), and then called `saveDocument` would silently overwrite any item
 * a concurrent writer inserted in the window. `saveDocument` is a full
 * replacement, so the concurrent item vanished with no error and no log line.
 *
 * These tests pin the fix:
 *   1. A handler-level lost update — a slow writer (simulated via a store
 *      wrapper that pauses between read and write, where the real commands run
 *      their LLM call) must not clobber an item inserted by a second writer.
 *   2. `FolderTreeStore.saveDocument` acquires the folder-tree lock when not
 *      already inside a transaction, matching `FileStore.saveDocument`.
 *
 * @see packages/rex/src/store/contracts.ts — withTransaction contract
 * @see packages/rex/src/store/file-lock.ts — the lock itself
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { FileStore } from "../../src/store/file-adapter.js";
import { FolderTreeStore } from "../../src/store/folder-tree-store.js";
import { acquireLock } from "../../src/store/file-lock.js";
import { handleMoveItem, handleUpdateTaskStatus } from "../../src/cli/mcp-tools.js";
import { syncFolderTree } from "../../src/cli/commands/folder-tree-sync.js";
import type { PRDStore } from "../../src/store/contracts.js";
import type { PRDDocument, PRDItem } from "../../src/schema/index.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wrap a store so that the first read inside a write path pauses before the
 * writer proceeds — the seam where the real commands spend seconds to minutes
 * on LLM analysis. The pause fires once; later reads pass through.
 */
function withPauseAfterRead(inner: PRDStore, pause: () => Promise<void>): PRDStore {
  let fired = false;
  const fireOnce = async (): Promise<void> => {
    if (fired) return;
    fired = true;
    await pause();
  };
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === "loadDocument") {
        return async () => {
          const doc = await target.loadDocument();
          await fireOnce();
          return doc;
        };
      }
      if (prop === "withTransaction") {
        return <T>(fn: (doc: PRDDocument) => Promise<T>) =>
          target.withTransaction(async (doc) => {
            await fireOnce();
            return fn(doc);
          });
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as PRDStore;
}

function task(id: string, title: string, status: PRDItem["status"] = "pending"): PRDItem {
  return { id, title, level: "task", status };
}

/**
 * The handler's own error text, for the assertion message. `isError` alone
 * reports as "expected true to be undefined", which says nothing about which
 * of the handler's many failure paths fired.
 */
function why(result: { content: Array<{ text: string }>; isError?: boolean }): string {
  return result.content.map((c) => c.text).join("\n");
}

describe("concurrent PRD writers do not lose updates", () => {
  let projectDir: string;
  let rexDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "rex-lost-update-"));
    rexDir = join(projectDir, ".rex");
    await mkdir(rexDir, { recursive: true });
    await writeFile(
      join(rexDir, "config.json"),
      JSON.stringify({ version: "1.0" }),
      "utf-8",
    );
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
          children: [task("task-1", "Task One"), task("task-2", "Task Two")],
        },
        { id: "epic-2", title: "Epic Two", level: "epic", status: "pending" },
      ],
    });
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("an item inserted while move_item is between read and write survives", async () => {
    const inner = new FileStore(rexDir);
    // Second writer: a plain locked addItem, launched while the mover is
    // paused between its read and its write. Await it (bounded) so that with
    // unlocked code its write deterministically lands inside the window.
    let addPromise: Promise<void> | undefined;
    const store = withPauseAfterRead(inner, async () => {
      addPromise = inner.addItem(task("task-late", "Inserted Mid-Write"), "epic-1");
      await Promise.race([addPromise.catch(() => undefined), sleep(2_000)]);
    });

    const moveResult = await handleMoveItem(store, rexDir, {
      id: "task-2",
      parentId: "epic-2",
    });
    expect(moveResult.isError, why(moveResult)).toBeUndefined();
    await addPromise;

    const finalDoc = await new FileStore(rexDir).loadDocument();
    const epicOne = finalDoc.items.find((i) => i.id === "epic-1");
    const epicTwo = finalDoc.items.find((i) => i.id === "epic-2");
    // The move happened…
    expect(epicTwo?.children?.some((c) => c.id === "task-2")).toBe(true);
    // …and the concurrently inserted item was not silently dropped.
    expect(epicOne?.children?.some((c) => c.id === "task-late")).toBe(true);
  });

  it("an item inserted while update_task_status deletes another survives", async () => {
    const inner = new FileStore(rexDir);
    let addPromise: Promise<void> | undefined;
    const store = withPauseAfterRead(inner, async () => {
      addPromise = inner.addItem(task("task-late", "Inserted Mid-Delete"), "epic-2");
      await Promise.race([addPromise.catch(() => undefined), sleep(2_000)]);
    });

    const deleteResult = await handleUpdateTaskStatus(store, projectDir, {
      id: "task-1",
      status: "deleted",
      force: true,
    });
    expect(deleteResult.isError, why(deleteResult)).toBeUndefined();
    await addPromise;

    const finalDoc = await new FileStore(rexDir).loadDocument();
    const epicOne = finalDoc.items.find((i) => i.id === "epic-1");
    const epicTwo = finalDoc.items.find((i) => i.id === "epic-2");
    expect(epicOne?.children?.some((c) => c.id === "task-1")).toBeFalsy();
    expect(epicTwo?.children?.some((c) => c.id === "task-late")).toBe(true);
  });
});

describe("syncFolderTree locking", () => {
  let projectDir: string;
  let rexDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "rex-sync-lock-"));
    rexDir = join(projectDir, ".rex");
    await mkdir(rexDir, { recursive: true });
    await new FileStore(rexDir).saveDocument({
      schema: "rex/v1",
      title: "Test PRD",
      items: [
        { id: "epic-1", title: "Epic One", level: "epic", status: "pending", children: [task("task-1", "Task One")] },
        { id: "epic-2", title: "Epic Two", level: "epic", status: "pending" },
      ],
    });
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  // syncFolderTree is a full read-modify-write of the tree: it deletes every
  // on-disk entry absent from the snapshot it loaded. Unlocked, it both read
  // half-written item directories (parseFolderTree throws ENOENT, surfacing as
  // an MCP isError) and deleted the concurrent writer's items.
  it("waits for an open transaction instead of reading a half-written tree", async () => {
    const store = new FileStore(rexDir);
    const order: string[] = [];

    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => { openGate = resolve; });
    let inCallback!: () => void;
    const callbackEntered = new Promise<void>((resolve) => { inCallback = resolve; });

    const txn = store.withTransaction(async (doc) => {
      inCallback();
      await gate;
      // Turns epic-2 from a bare `epic-2.md` into an `epic-2/` directory —
      // the transient state an unlocked reader used to trip over.
      const epicTwo = doc.items.find((i) => i.id === "epic-2");
      epicTwo!.children = [task("task-late", "Inserted Mid-Write")];
      order.push("transaction-committed");
    });

    await callbackEntered;
    const sync = syncFolderTree(rexDir, store).then(() => order.push("sync-completed"));

    // Give the sync a chance to (wrongly) slip past the open transaction.
    await sleep(150);
    openGate();
    await txn;
    await sync;

    expect(order).toEqual(["transaction-committed", "sync-completed"]);

    // The sync serialized the post-transaction tree, so the item it never
    // loaded at call time is still on disk.
    const finalDoc = await new FileStore(rexDir).loadDocument();
    const epicTwo = finalDoc.items.find((i) => i.id === "epic-2");
    expect(epicTwo?.children?.some((c) => c.id === "task-late")).toBe(true);
  });
});

describe("folder-tree lock identity", () => {
  let projectDir: string;
  let rexDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "rex-lock-identity-"));
    rexDir = join(projectDir, ".rex");
    await mkdir(rexDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  // One resource, one lock name. FileStore used to guard the tree with
  // `tree.lock` while FolderTreeStore used `prd.lock`, so a writer on each
  // store rewrote `.rex/prd_tree/` simultaneously with neither seeing the
  // other. Both must now contend on prdLockPath().
  it("FileStore and FolderTreeStore serialize against each other", async () => {
    const fileStore = new FileStore(rexDir);
    const treeStore = new FolderTreeStore(rexDir);
    await fileStore.saveDocument({
      schema: "rex/v1",
      title: "Test PRD",
      items: [task("t1", "Task One")],
    });

    const order: string[] = [];
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => { openGate = resolve; });
    let inCallback!: () => void;
    const callbackEntered = new Promise<void>((resolve) => { inCallback = resolve; });

    const txn = fileStore.withTransaction(async (doc) => {
      inCallback();
      await gate;
      doc.items.push(task("t-file", "From FileStore"));
      order.push("file-store-committed");
    });

    await callbackEntered;
    const treeWrite = treeStore
      .addItem(task("t-tree", "From FolderTreeStore"))
      .then(() => order.push("tree-store-committed"));

    await sleep(150);
    openGate();
    await txn;
    await treeWrite;

    expect(order).toEqual(["file-store-committed", "tree-store-committed"]);

    // Serialized writes compose: neither clobbered the other.
    const finalDoc = await new FileStore(rexDir).loadDocument();
    const ids = finalDoc.items.map((i) => i.id);
    expect(ids).toContain("t-file");
    expect(ids).toContain("t-tree");
  });
});

describe("FolderTreeStore.saveDocument locking", () => {
  let projectDir: string;
  let rexDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "rex-tree-save-lock-"));
    rexDir = join(projectDir, ".rex");
    await mkdir(rexDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("saveDocument outside a transaction waits for an open transaction", async () => {
    const store = new FolderTreeStore(rexDir);
    await store.saveDocument({
      schema: "rex/v1",
      title: "Tree PRD",
      items: [task("t1", "Task One")],
    });

    const order: string[] = [];
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => { openGate = resolve; });
    let inCallback!: () => void;
    const callbackEntered = new Promise<void>((resolve) => { inCallback = resolve; });

    const txn = store.withTransaction(async (doc) => {
      inCallback();
      await gate;
      doc.items.push(task("t-txn", "From Transaction"));
      order.push("transaction-committed");
    });

    await callbackEntered;
    const directSave = store
      .saveDocument({ schema: "rex/v1", title: "Tree PRD", items: [task("t1", "Task One"), task("t-direct", "Direct Save")] })
      .then(() => order.push("direct-save-completed"));

    // Give the direct save a chance to (wrongly) slip past the open transaction.
    await sleep(150);
    openGate();
    await txn;
    await directSave;

    expect(order[0]).toBe("transaction-committed");
    expect(order[1]).toBe("direct-save-completed");
  });

  it("a writer that cannot acquire the lock fails with a message naming the holder", async () => {
    // Simulate another live process holding the lock: a real child PID in a
    // fresh lock file, so staleness cleanup does not reclaim it.
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
      stdio: "ignore",
    });
    try {
      const lockPath = join(rexDir, "prd.lock");
      await writeFile(
        lockPath,
        JSON.stringify({ pid: child.pid, token: "other-writer", timestamp: new Date().toISOString() }),
        "utf-8",
      );

      await expect(
        acquireLock(lockPath, { acquireTimeoutMs: 400, retryDelayMs: 50, staleMs: 60_000 }),
      ).rejects.toThrow(new RegExp(`Held by PID ${child.pid}`));
    } finally {
      child.kill();
    }
  });
});
