/**
 * Work-cycle section of `rex status` (surfaced through `ndx status`).
 *
 * The cycle is derived from `.hench/runs/*.json` — records hench already
 * persists — so history survives across sessions with no new state. A "cycle"
 * is one `ndx work` / `--loop` invocation: runs cluster when the gap between
 * one run's start and the previous run's end is small (loop pauses are
 * seconds), and a new cycle begins at the first large gap.
 *
 * @see packages/rex/src/cli/commands/status-work-cycle.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readHenchRuns,
  selectLatestCycle,
  summarizeCycle,
  renderWorkCycleSection,
  type WorkCycleRun,
} from "../../../../src/cli/commands/status-work-cycle.js";

const T0 = Date.parse("2026-09-11T10:00:00.000Z");

function run(overrides: Partial<WorkCycleRun> & { id: string }): WorkCycleRun {
  return {
    status: "completed",
    taskTitle: `Task ${overrides.id}`,
    startedAt: new Date(T0).toISOString(),
    ...overrides,
  };
}

function at(offsetMs: number): string {
  return new Date(T0 + offsetMs).toISOString();
}

describe("readHenchRuns", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "rex-work-cycle-"));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("returns an empty list when .hench/runs/ does not exist", async () => {
    expect(await readHenchRuns(projectDir)).toEqual([]);
  });

  it("reads run records, skipping malformed and non-run files", async () => {
    const runsDir = join(projectDir, ".hench", "runs");
    await mkdir(runsDir, { recursive: true });
    await writeFile(
      join(runsDir, "aaa.json"),
      JSON.stringify({ id: "aaa", status: "completed", taskId: "t1", taskTitle: "First", startedAt: at(0), finishedAt: at(60_000) }),
    );
    await writeFile(
      join(runsDir, "bbb.json"),
      JSON.stringify({ id: "bbb", status: "failed", taskId: "t2", taskTitle: "Second", startedAt: at(120_000) }),
    );
    await writeFile(join(runsDir, "broken.json"), "{ not json");
    await writeFile(join(runsDir, "notes.txt"), "not a run");
    // A record with no startedAt cannot be placed in a cycle — skipped.
    await writeFile(
      join(runsDir, "ccc.json"),
      JSON.stringify({ id: "ccc", status: "completed", taskTitle: "No start" }),
    );

    const runs = await readHenchRuns(projectDir);
    expect(runs.map((r) => r.id).sort()).toEqual(["aaa", "bbb"]);
    const first = runs.find((r) => r.id === "aaa")!;
    expect(first.taskTitle).toBe("First");
    expect(first.finishedAt).toBe(at(60_000));
  });
});

describe("selectLatestCycle", () => {
  it("returns only the most recent cluster of runs", () => {
    const runs = [
      run({ id: "old-1", startedAt: at(0), finishedAt: at(60_000) }),
      run({ id: "old-2", startedAt: at(90_000), finishedAt: at(150_000) }),
      // Two hours later — a new invocation.
      run({ id: "new-1", startedAt: at(2 * 3_600_000), finishedAt: at(2 * 3_600_000 + 60_000) }),
      run({ id: "new-2", startedAt: at(2 * 3_600_000 + 120_000) }),
    ];

    const cycle = selectLatestCycle(runs, 30 * 60_000);
    expect(cycle.map((r) => r.id)).toEqual(["new-1", "new-2"]);
  });

  it("joins runs separated by exactly the gap threshold, splits beyond it", () => {
    const gap = 10 * 60_000;
    const boundary = [
      run({ id: "a", startedAt: at(0), finishedAt: at(60_000) }),
      run({ id: "b", startedAt: at(60_000 + gap) }), // exactly gap after a finished
    ];
    expect(selectLatestCycle(boundary, gap).map((r) => r.id)).toEqual(["a", "b"]);

    const beyond = [
      run({ id: "a", startedAt: at(0), finishedAt: at(60_000) }),
      run({ id: "b", startedAt: at(60_000 + gap + 1) }),
    ];
    expect(selectLatestCycle(beyond, gap).map((r) => r.id)).toEqual(["b"]);
  });

  it("measures the gap from the previous run's finish when known, else its start", () => {
    // A long run's finish is what the next loop iteration follows — a 20min
    // run with a 5min pause is one cycle even when starts are 25min apart.
    const gap = 10 * 60_000;
    const runs = [
      run({ id: "long", startedAt: at(0), finishedAt: at(20 * 60_000) }),
      run({ id: "next", startedAt: at(25 * 60_000) }),
    ];
    expect(selectLatestCycle(runs, gap).map((r) => r.id)).toEqual(["long", "next"]);
  });

  it("returns an empty cycle for no runs", () => {
    expect(selectLatestCycle([], 1000)).toEqual([]);
  });
});

describe("summarizeCycle", () => {
  it("buckets every run status, mapping cancelled to skipped", () => {
    const cycle = [
      run({ id: "c1", status: "completed" }),
      run({ id: "f1", status: "failed" }),
      run({ id: "f2", status: "timeout" }),
      run({ id: "f3", status: "budget_exceeded" }),
      run({ id: "f4", status: "error_transient" }),
      run({ id: "s1", status: "cancelled" }),
      run({ id: "r1", status: "running" }),
    ];

    const summary = summarizeCycle(cycle);
    expect(summary.completed.map((r) => r.id)).toEqual(["c1"]);
    expect(summary.failed.map((r) => r.id)).toEqual(["f1", "f2", "f3", "f4"]);
    expect(summary.skipped.map((r) => r.id)).toEqual(["s1"]);
    expect(summary.running.map((r) => r.id)).toEqual(["r1"]);
  });
});

describe("renderWorkCycleSection", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "rex-work-cycle-render-"));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("prints nothing when there is no run history", async () => {
    const lines: string[] = [];
    await renderWorkCycleSection(projectDir, (line) => lines.push(line));
    expect(lines).toEqual([]);
  });

  it("renders the latest cycle with completed, failed, and skipped tasks", async () => {
    const runsDir = join(projectDir, ".hench", "runs");
    await mkdir(runsDir, { recursive: true });
    const record = (id: string, status: string, title: string, startMs: number, endMs?: number) =>
      writeFile(
        join(runsDir, `${id}.json`),
        JSON.stringify({
          id, status, taskId: `task-${id}`, taskTitle: title,
          startedAt: at(startMs),
          ...(endMs !== undefined ? { finishedAt: at(endMs) } : {}),
        }),
      );

    // An old cycle that must NOT appear.
    await record("stale", "failed", "Ancient failure", -8 * 3_600_000, -8 * 3_600_000 + 60_000);
    // The latest cycle: one of each outcome.
    await record("ok", "completed", "Shipped the thing", 0, 300_000);
    await record("bad", "timeout", "Hung forever", 360_000, 900_000);
    await record("skip", "cancelled", "Deliberately skipped", 960_000, 961_000);

    const lines: string[] = [];
    await renderWorkCycleSection(projectDir, (line) => lines.push(line));
    const text = lines.join("\n");

    expect(text).toContain("Last work cycle");
    expect(text).toContain("Shipped the thing");
    expect(text).toContain("Hung forever");
    expect(text).toContain("timeout");
    expect(text).toContain("Deliberately skipped");
    expect(text).not.toContain("Ancient failure");
    // Counts line: 1 completed / 1 failed / 1 skipped.
    expect(text).toMatch(/1 completed/);
    expect(text).toMatch(/1 failed/);
    expect(text).toMatch(/1 skipped/);
  });
});
