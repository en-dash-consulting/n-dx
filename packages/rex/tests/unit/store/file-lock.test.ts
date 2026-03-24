import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
});
