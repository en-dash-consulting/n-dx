import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, utimes } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readRunQueue, writeRunQueue, removeFromRunQueue, takeFromRunQueue, runQueuePath,
  runQueueLockPath, withRunQueueLock, RUN_QUEUE_LOCK_STALE_MS,
} from "../../../src/queue/run-queue.js";

let dir: string;

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "hench-run-queue-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const item = (taskId: string) => ({ taskId, addedAt: "2026-11-23T00:00:00.000Z" });

describe("the run queue file", () => {
  it("reads empty when the file is absent, unreadable or not a queue", async () => {
    expect(await readRunQueue(dir)).toEqual([]);
    await writeFile(runQueuePath(dir), "{ not json");
    expect(await readRunQueue(dir)).toEqual([]);
    await writeFile(runQueuePath(dir), JSON.stringify({ version: 1, items: [{ taskId: "" }, { nope: 1 }, { taskId: "a" }] }));
    expect(await readRunQueue(dir)).toEqual([{ taskId: "a", addedAt: "" }]);
  });

  it("writes the whole queue and reads it back in order", async () => {
    await writeRunQueue(dir, [item("b"), item("a")]);
    expect((await readRunQueue(dir)).map((i) => i.taskId)).toEqual(["b", "a"]);
    expect(JSON.parse(await readFile(runQueuePath(dir), "utf-8"))).toMatchObject({ version: 1 });
  });

  it("removes items and keeps the rest in order", async () => {
    await writeRunQueue(dir, [item("a"), item("b"), item("c")]);
    await removeFromRunQueue(dir, ["b"]);
    expect((await readRunQueue(dir)).map((i) => i.taskId)).toEqual(["a", "c"]);
  });
});

describe("taking from the queue", () => {
  it("takes the first item that can run, drops the ones that never will, and keeps the passing ones", async () => {
    await writeRunQueue(dir, [item("done"), item("claimed"), item("stuck"), item("go"), item("later")]);
    class Finished extends Error {}
    const tried: string[] = [];
    const result = await takeFromRunQueue(dir, async (id) => {
      tried.push(id);
      if (id === "done") throw new Finished("already completed");
      if (id === "claimed") throw new Error("claimed by another worktree");
      return { id };
    }, { final: (_id, err) => err instanceof Finished, skip: new Set(["stuck"]) });

    expect(result.picked).toEqual({ taskId: "go", value: { id: "go" } });
    expect(tried).toEqual(["done", "claimed", "go"]);
    expect(result.skipped).toEqual([
      { taskId: "done", reason: "already completed", dropped: true },
      { taskId: "claimed", reason: "claimed by another worktree", dropped: false },
      { taskId: "stuck", reason: "skipped as stuck", dropped: false },
    ]);
    // The run takes its item and the finished one off; the rest wait, in order.
    expect((await readRunQueue(dir)).map((i) => i.taskId)).toEqual(["claimed", "stuck", "later"]);
  });

  it("keeps every item when no refusal is final, so a bad read never empties the queue", async () => {
    await writeRunQueue(dir, [item("a"), item("b")]);
    const result = await takeFromRunQueue(dir, async () => { throw new Error("EBUSY: the PRD is being written"); });
    expect(result.picked).toBeNull();
    expect(result.skipped.every((s) => !s.dropped)).toBe(true);
    expect((await readRunQueue(dir)).map((i) => i.taskId)).toEqual(["a", "b"]);
  });

  it("changes nothing on a dry run", async () => {
    await writeRunQueue(dir, [item("done"), item("go")]);
    const result = await takeFromRunQueue(dir, async (id) => {
      if (id === "done") throw new Error("completed");
      return id;
    }, { dryRun: true, final: () => true });
    expect(result.picked?.taskId).toBe("go");
    expect((await readRunQueue(dir)).map((i) => i.taskId)).toEqual(["done", "go"]);
  });

  it("picks nothing from an empty queue, so rex's own pick runs", async () => {
    expect(await takeFromRunQueue(dir, async () => "x")).toEqual({ picked: null, skipped: [] });
  });
});

describe("the queue's write lock", () => {
  const ids = async () => (await readRunQueue(dir)).map((i) => i.taskId);
  const later = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("a removal waits for a writer holding the lock, then reads what it saved", async () => {
    await writeRunQueue(dir, [item("a"), item("b")]);
    // The dashboard's save holds the lock: it reads [a, b] and saves [a, b, c].
    let release!: () => void;
    const held = withRunQueueLock(dir, () => new Promise<void>((r) => { release = r; }));
    await later(30);
    const removal = removeFromRunQueue(dir, ["a"]);
    await later(60);
    await writeRunQueue(dir, [item("a"), item("b"), item("c")]);
    release();
    await held;
    await removal;
    // ndx work's removal ran after the save, so `c` survives.
    expect(await ids()).toEqual(["b", "c"]);
    expect(existsSync(runQueueLockPath(dir))).toBe(false);
  });

  it("breaks a lock left behind by a writer that died", async () => {
    await writeRunQueue(dir, [item("a"), item("b")]);
    await writeFile(runQueueLockPath(dir), "{}");
    const old = new Date(Date.now() - RUN_QUEUE_LOCK_STALE_MS - 1_000);
    await utimes(runQueueLockPath(dir), old, old);
    await removeFromRunQueue(dir, ["a"]);
    expect(await ids()).toEqual(["b"]);
  });

  it("a run reports, rather than fails, when the lock stays held", async () => {
    await writeRunQueue(dir, [item("go")]);
    await writeFile(runQueueLockPath(dir), "{}");
    const result = await takeFromRunQueue(dir, async (id) => id, { lockWaitMs: 50 });
    expect(result.picked?.taskId).toBe("go");
    expect(result.removalError).toMatch(/locked by another writer/);
    // Nothing was taken off, and the other writer's lock is left alone.
    expect(await ids()).toEqual(["go"]);
    expect(existsSync(runQueueLockPath(dir))).toBe(true);
  });

});
