import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readRunQueue, writeRunQueue, removeFromRunQueue, takeFromRunQueue, runQueuePath,
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
    class Claimed extends Error {}
    const tried: string[] = [];
    const result = await takeFromRunQueue(dir, async (id) => {
      tried.push(id);
      if (id === "done") throw new Error("already completed");
      if (id === "claimed") throw new Claimed("claimed by another worktree");
      return { id };
    }, { keep: (_id, err) => err instanceof Claimed, skip: new Set(["stuck"]) });

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

  it("changes nothing on a dry run", async () => {
    await writeRunQueue(dir, [item("done"), item("go")]);
    const result = await takeFromRunQueue(dir, async (id) => {
      if (id === "done") throw new Error("completed");
      return id;
    }, { dryRun: true });
    expect(result.picked?.taskId).toBe("go");
    expect((await readRunQueue(dir)).map((i) => i.taskId)).toEqual(["done", "go"]);
  });

  it("picks nothing from an empty queue, so rex's own pick runs", async () => {
    expect(await takeFromRunQueue(dir, async () => "x")).toEqual({ picked: null, skipped: [] });
  });
});
