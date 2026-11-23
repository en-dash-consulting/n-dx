/**
 * `ndx work` takes the planned run queue's first item that can run before
 * rex's own pick, and passes over (and drops) one that never will. A dry run
 * leaves the queue as it was; an explicit --task ignores it.
 *
 * @see packages/hench/src/queue/run-queue.ts
 * @see packages/hench/src/cli/commands/run.ts — runOne's queue step
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cmdRun } from "../../src/cli/commands/run.js";
import { resolveStore } from "../../src/prd/rex-gateway.js";
import { readRunQueue, writeRunQueue } from "../../src/queue/run-queue.js";
import { cleanupProjectDir, commitGitFixtureBaseline, setupProjectDir } from "../helpers/index.js";

const DOC = {
  schema: "rex/v1",
  title: "Queue",
  items: [
    {
      id: "epic-1",
      title: "Queue Epic",
      level: "epic" as const,
      status: "pending" as const,
      children: [
        { id: "t-first", title: "Rex picks this first", level: "task" as const, status: "pending" as const, priority: "critical" as const },
        { id: "t-queued", title: "The queued task", level: "task" as const, status: "pending" as const, priority: "low" as const },
        { id: "t-done", title: "Already done", level: "task" as const, status: "completed" as const },
      ],
    },
  ],
};

let projectDir: string;
let henchDir: string;
let rexDir: string;

async function dryRun(flags: Record<string, string> = {}): Promise<string> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await cmdRun(projectDir, { ...flags, "dry-run": "true" });
    return log.mock.calls.map((c) => c.map(String).join(" ")).join("\n").replace(/\u001b\[[0-9;]*m/g, "");
  } finally {
    log.mockRestore();
  }
}

const queued = (taskId: string) => ({ taskId, addedAt: "2026-11-23T00:00:00.000Z" });

beforeEach(async () => {
  ({ projectDir, henchDir, rexDir } = await setupProjectDir("hench-run-queue-"));
  await (await resolveStore(rexDir)).saveDocument(DOC as never);
  await writeFile(
    join(projectDir, ".n-dx.json"),
    JSON.stringify({ llm: { vendor: "claude", claude: { cli_path: process.execPath } } }),
    "utf-8",
  );
  commitGitFixtureBaseline(projectDir);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupProjectDir(projectDir);
});

describe("the planned run queue", () => {
  it("runs the queue's first runnable item before rex's own pick, passing over a finished one", async () => {
    await writeRunQueue(henchDir, [queued("t-done"), queued("t-queued")]);
    const out = await dryRun();
    expect(out).toContain("Run queue: passed over t-done");
    expect(out).toContain("Run queue: running t-queued");
    // The brief is for the queued task, not the critical one rex would pick.
    expect(out).toContain("ID: t-queued");
    expect(out).not.toContain("ID: t-first");
    // A dry run takes nothing off the queue.
    expect((await readRunQueue(henchDir)).map((i) => i.taskId)).toEqual(["t-done", "t-queued"]);
  });

  it("falls back to rex's own pick with an empty queue", async () => {
    const out = await dryRun();
    expect(out).not.toContain("Run queue:");
    expect(out).toContain("ID: t-first");
  });

  it("an explicit --task ignores the queue", async () => {
    await writeRunQueue(henchDir, [queued("t-queued")]);
    const out = await dryRun({ task: "t-first" });
    expect(out).not.toContain("Run queue:");
    expect(out).toContain("ID: t-first");
    expect(out).not.toContain("ID: t-queued");
  });
});
