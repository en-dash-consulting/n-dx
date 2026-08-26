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
    expect(moveResult.isError).toBeUndefined();
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
    expect(deleteResult.isError).toBeUndefined();
    await addPromise;

    const finalDoc = await new FileStore(rexDir).loadDocument();
    const epicOne = finalDoc.items.find((i) => i.id === "epic-1");
    const epicTwo = finalDoc.items.find((i) => i.id === "epic-2");
    expect(epicOne?.children?.some((c) => c.id === "task-1")).toBeFalsy();
    expect(epicTwo?.children?.some((c) => c.id === "task-late")).toBe(true);
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
