import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireLock, withLock, removeStaleLock } from "../../../src/store/file-lock.js";
import { readFile } from "node:fs/promises";

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

  it("never steals another live process's lock, however old it is", async () => {
    // The lost-update this prevents was observed, not theorised: two concurrent
    // `rex import-bundle` processes both entered the critical section under a
    // loaded machine, and the second one's save was rejected by the stale-save
    // guard for deleting an item the first had just written.
    //
    // Age used to be sufficient grounds to unlink a lock whose owner was still
    // running, on the theory that the owner was hung. A hung process and a slow
    // one are indistinguishable by age, and the whole suite takes long enough
    // under load for a healthy import to hold the lock past any such threshold.
    // So liveness decides, and a lock nobody can prove abandoned is never taken.
    const lockPath = await makeLockPath();
    // The parent process: definitely alive, and definitely not this process —
    // a same-PID lock is orphan-by-definition, since the in-process mutex
    // guarantees no live same-process holder can exist while we check.
    const liveForeignPid = process.ppid;
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: liveForeignPid,
        token: "held-by-a-live-process",
        timestamp: new Date(Date.now() - 10 * 60_000).toISOString(),
      }),
    );

    await expect(
      acquireLock(lockPath, { acquireTimeoutMs: 300, retryDelayMs: 20 }),
    ).rejects.toThrow(/Could not acquire PRD lock/);

    // And it says who is holding it, so the operator can act on the refusal.
    await expect(
      acquireLock(lockPath, { acquireTimeoutMs: 300, retryDelayMs: 20 }),
    ).rejects.toThrow(new RegExp(`PID ${liveForeignPid}`));
  });

  it("still reclaims an ancient lock once its owner is gone", async () => {
    // The other half: refusing to steal from the living must not turn a crashed
    // writer's leftover lock into a permanent outage.
    const lockPath = await makeLockPath();
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: 999999999,
        token: "owner-is-long-gone",
        timestamp: new Date(Date.now() - 10 * 60_000).toISOString(),
      }),
    );

    const release = await acquireLock(lockPath, { acquireTimeoutMs: 1_000 });
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

  it("does not steal a live same-process lock however long it is held", async () => {
    const lockPath = await makeLockPath();
    const order: string[] = [];

    // A waiter must queue behind a live holder rather than unlinking its lock
    // and entering concurrently (the root cause of folder-tree corruption).
    // In-process this is guaranteed by the mutex; across processes it is the
    // liveness check in isLockStale.
    const p1 = withLock(
      lockPath,
      async () => {
        order.push("h-start");
        await new Promise((r) => setTimeout(r, 300));
        order.push("h-end");
      },
    );

    await new Promise((r) => setTimeout(r, 5));

    const p2 = withLock(
      lockPath,
      async () => {
        order.push("w-start");
      },
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

  it("waits out a lock caught mid-creation instead of stealing it", async () => {
    // writeFile with 'wx' opens the file and then writes its content — two
    // syscalls. A waiter reading between them sees an empty file, and an
    // empty file used to decode as "malformed = stale", so the waiter
    // unlinked a LIVE writer's lock and entered the critical section
    // alongside it. Malformed must be confirmed after a grace delay: a
    // corpse stays malformed, a mid-creation lock becomes valid.
    const lockPath = await makeLockPath();
    await writeFile(lockPath, ""); // the mid-creation window, frozen

    // The "writer" finishes its content write shortly after.
    const liveForeignPid = process.ppid;
    setTimeout(() => {
      void writeFile(
        lockPath,
        JSON.stringify({ pid: liveForeignPid, token: "t", timestamp: new Date().toISOString() }),
      );
    }, 20);

    await expect(
      acquireLock(lockPath, { acquireTimeoutMs: 600, retryDelayMs: 20 }),
    ).rejects.toThrow(new RegExp(`PID ${liveForeignPid}`));
  });

  it("reclaims a lock that stays malformed across the grace delay", async () => {
    // A truncated write from a crashed writer never becomes valid — after
    // the mid-creation grace it is still garbage, and garbage is reclaimed.
    const lockPath = await makeLockPath();
    await writeFile(lockPath, "not json at all");

    const release = await acquireLock(lockPath, { acquireTimeoutMs: 2_000 });
    await release();
  });

  it("a late stale-cleanup never deletes the lock a faster cleaner's successor created", async () => {
    // Two waiters can both judge the same corpse stale. The winner removes it
    // and creates its own lock; the loser's removal used to land AFTER that
    // creation and unlink the winner's live lock — admitting a second writer.
    // Removal is claim-by-rename with content verification, so a removal
    // armed with a stale judgment cannot delete a lock that has since been
    // replaced.
    const lockPath = await makeLockPath();
    const corpse = JSON.stringify({ pid: 999999999, token: "corpse", timestamp: new Date().toISOString() });
    await writeFile(lockPath, corpse);

    // Cleaner 1 removes the corpse…
    await removeStaleLock(lockPath, corpse);
    // …and its successor writes a fresh live lock.
    const fresh = JSON.stringify({ pid: process.pid, token: "fresh", timestamp: new Date().toISOString() });
    await writeFile(lockPath, fresh);

    // Cleaner 2, still armed with the corpse judgment, arrives late.
    await removeStaleLock(lockPath, corpse);

    // The fresh lock survived.
    await expect(readFile(lockPath, "utf-8")).resolves.toBe(fresh);
  });

  it("removeStaleLock removes exactly the lock it judged", async () => {
    const lockPath = await makeLockPath();
    const corpse = JSON.stringify({ pid: 999999999, token: "corpse", timestamp: new Date().toISOString() });
    await writeFile(lockPath, corpse);

    await removeStaleLock(lockPath, corpse);

    await expect(stat(lockPath)).rejects.toThrow();
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
