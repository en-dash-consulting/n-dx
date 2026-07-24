import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireLock, withLock } from "../../../src/store/file-lock.js";

describe("file-lock", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  async function makeLockPath(): Promise<string> {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-lock-"));
    return join(tmpDir, "prd.json.lock");
  }

  it("acquires and releases a lock", async () => {
    const lockPath = await makeLockPath();
    const release = await acquireLock(lockPath);
    // Lock file should exist while held
    await expect(import("node:fs/promises").then((fs) => fs.stat(lockPath))).resolves.toBeTruthy();
    await release();
  });

  it("withLock executes the function and releases", async () => {
    const lockPath = await makeLockPath();
    const result = await withLock(lockPath, async () => "done");
    expect(result).toBe("done");
  });

  it("withLock releases on error", async () => {
    const lockPath = await makeLockPath();
    await expect(
      withLock(lockPath, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // Should be able to re-acquire after error
    const release = await acquireLock(lockPath);
    await release();
  });

  it("detects stale lock from dead PID and recovers", async () => {
    const lockPath = await makeLockPath();
    // Write a lock file with a PID that doesn't exist
    await writeFile(lockPath, JSON.stringify({ pid: 999999999, timestamp: new Date().toISOString() }));

    // Should recover by cleaning the stale lock
    const release = await acquireLock(lockPath);
    await release();
  });

  it("serializes concurrent withLock calls", async () => {
    const lockPath = await makeLockPath();
    const order: number[] = [];

    const p1 = withLock(lockPath, async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 50));
      order.push(2);
    });

    // Small delay so p1 acquires first
    await new Promise((r) => setTimeout(r, 5));

    const p2 = withLock(lockPath, async () => {
      order.push(3);
    });

    await Promise.all([p1, p2]);
    // p1 should complete (1, 2) before p2 starts (3)
    expect(order).toEqual([1, 2, 3]);
  });

  it("does not steal a live same-process lock held longer than staleMs", async () => {
    const lockPath = await makeLockPath();
    const order: string[] = [];

    // Holder's critical section outlives the staleness threshold. A waiter
    // must still queue behind it instead of unlinking the live lock and
    // entering concurrently (the root cause of folder-tree corruption).
    const p1 = withLock(
      lockPath,
      async () => {
        order.push("h-start");
        await new Promise((r) => setTimeout(r, 300));
        order.push("h-end");
      },
      { staleMs: 100 },
    );

    await new Promise((r) => setTimeout(r, 5));

    const p2 = withLock(
      lockPath,
      async () => {
        order.push("w-start");
      },
      { staleMs: 100 },
    );

    await Promise.all([p1, p2]);
    expect(order).toEqual(["h-start", "h-end", "w-start"]);
  });

  it("release does not unlink a lock it no longer owns", async () => {
    const lockPath = await makeLockPath();
    const release = await acquireLock(lockPath);

    // Simulate a stale-takeover: another writer replaced the lock file.
    await writeFile(
      lockPath,
      JSON.stringify({ pid: process.pid, token: "other-owner", timestamp: new Date().toISOString() }),
    );

    await release();

    // The usurper's lock must survive the original holder's release.
    await expect(stat(lockPath)).resolves.toBeTruthy();
    await rm(lockPath, { force: true });
  });

  it("recovers an orphaned same-process lock file", async () => {
    const lockPath = await makeLockPath();
    // Fresh lock file with our own PID but no in-process holder — an orphan
    // (e.g. leftover from a failed unlink). Must be cleaned, not waited on.
    await writeFile(
      lockPath,
      JSON.stringify({ pid: process.pid, token: "orphan", timestamp: new Date().toISOString() }),
    );

    const release = await acquireLock(lockPath, { acquireTimeoutMs: 500 });
    await release();
  });

  it("times out when the lock is held in-process beyond acquireTimeoutMs", async () => {
    const lockPath = await makeLockPath();
    let releaseHolder: () => void = () => {};
    const holderDone = new Promise<void>((r) => { releaseHolder = r; });

    const p1 = withLock(lockPath, async () => holderDone);

    await new Promise((r) => setTimeout(r, 5));

    await expect(
      acquireLock(lockPath, { acquireTimeoutMs: 100 }),
    ).rejects.toThrow(/Could not acquire PRD lock/);

    releaseHolder();
    await p1;

    // Queue must recover after the timed-out waiter: a fresh acquire works.
    const release = await acquireLock(lockPath, { acquireTimeoutMs: 500 });
    await release();
  });
});
