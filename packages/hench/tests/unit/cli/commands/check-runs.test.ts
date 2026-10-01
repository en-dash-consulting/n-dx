/**
 * `hench check-runs` — audits which runs recorded as "running" are actually
 * running, and with `--fix` closes out the ones nothing is executing.
 *
 * The classification rules themselves are covered by
 * `tests/unit/process/run-liveness.test.ts`; these tests cover the command's
 * own behaviour: what it reads, what it writes, and when it refuses to write.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, hostname } from "node:os";
import { cmdCheckRuns } from "../../../../src/cli/commands/check-runs.js";

describe("hench check-runs", () => {
  let dir: string;
  let henchDir: string;
  let runsDir: string;
  let locksDir: string;
  let out: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;

  /** Write a run file recorded as still running on this host. */
  async function writeRunningRun(
    id: string,
    overrides: Record<string, unknown> = {},
  ): Promise<void> {
    const startedAt = new Date(Date.now() - 50 * 3_600_000).toISOString();
    await writeFile(
      join(runsDir, `${id}.json`),
      JSON.stringify({
        id,
        taskId: `task-${id}`,
        taskTitle: `Task ${id}`,
        startedAt,
        lastActivityAt: startedAt,
        status: "running",
        host: hostname(),
        turns: 2,
        tokenUsage: { input: 10, output: 5 },
        toolCalls: [],
        model: "claude-opus-5",
        ...overrides,
      }, null, 2),
    );
  }

  async function readRun(id: string): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(join(runsDir, `${id}.json`), "utf-8"));
  }

  /** Everything the command printed, joined. */
  const printed = () => out.join("\n");

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "hench-check-runs-"));
    henchDir = join(dir, ".hench");
    runsDir = join(henchDir, "runs");
    locksDir = join(henchDir, "locks");
    await mkdir(runsDir, { recursive: true });
    await mkdir(locksDir, { recursive: true });
    out = [];
    logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      out.push(args.map(String).join(" "));
    });
    process.exitCode = undefined;
  });

  afterEach(async () => {
    logSpy.mockRestore();
    process.exitCode = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  it("reports when nothing is recorded as running", async () => {
    await cmdCheckRuns(dir, {});
    expect(printed()).toContain("No runs are recorded as running");
  });

  it("names the runs no process is executing, and does not touch them", async () => {
    await writeRunningRun("a");

    await cmdCheckRuns(dir, {});

    expect(printed()).toContain("Not running (1)");
    expect(printed()).toContain("Re-run with --fix");
    // An audit without --fix is read-only: the point is to look before leaping.
    expect((await readRun("a")).status).toBe("running");
  });

  it("ends the dead runs under --fix and records why", async () => {
    await writeRunningRun("a");
    await writeRunningRun("b");

    await cmdCheckRuns(dir, { fix: "true" });

    expect(printed()).toContain("Ended 2 runs");
    for (const id of ["a", "b"]) {
      const run = await readRun(id);
      expect(run.status).toBe("failed");
      expect(run.error).toContain("Ended by audit reconciliation");
      expect(run.error).toContain("No hench process");
      expect(run.finishedAt).toBeTruthy();
    }
  });

  it("leaves a run held by a live lock alone, even under --fix", async () => {
    await writeRunningRun("a");
    await writeFile(
      join(locksDir, `${process.pid}.lock`),
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), taskId: "task-a" }),
    );

    await cmdCheckRuns(dir, { fix: "true" });

    expect(printed()).toContain("Running (1)");
    expect((await readRun("a")).status).toBe("running");
  });

  it("leaves a run from another machine alone, even with --include-unknown", async () => {
    // A foreign run is not unverified-but-probably-dead; this host simply has
    // no standing to judge it, and a wider flag does not change that.
    await writeRunningRun("a", { host: "some-other-box" });

    await cmdCheckRuns(dir, { fix: "true", "include-unknown": "true" });

    expect(printed()).toContain("Recorded on another machine (1)");
    expect((await readRun("a")).status).toBe("running");
  });

  it("ends an unconfirmed run only when --include-unknown is passed", async () => {
    const startedAt = new Date().toISOString();
    await writeRunningRun("a", { startedAt, lastActivityAt: startedAt });
    // An untagged lock from a process that started at the same time: it could
    // be this run's, so the default sweep leaves it alone.
    await writeFile(
      join(locksDir, `${process.pid}.lock`),
      JSON.stringify({ pid: process.pid, startedAt }),
    );

    await cmdCheckRuns(dir, { fix: "true" });
    expect(printed()).toContain("Could not be confirmed (1)");
    expect((await readRun("a")).status).toBe("running");

    out = [];
    await cmdCheckRuns(dir, { fix: "true", "include-unknown": "true" });
    expect((await readRun("a")).status).toBe("failed");
  });

  it("leaves already-finished runs out of the audit", async () => {
    await writeRunningRun("done", {
      status: "completed",
      finishedAt: new Date().toISOString(),
    });

    await cmdCheckRuns(dir, { fix: "true" });

    expect(printed()).toContain("No runs are recorded as running");
    expect((await readRun("done")).status).toBe("completed");
  });

  it("audits every run, not just the recent ones", async () => {
    // A run abandoned months ago is exactly what this command exists to find,
    // so the default page size that bounds `hench status` must not apply here.
    for (let i = 0; i < 25; i++) await writeRunningRun(`r${String(i).padStart(2, "0")}`);

    await cmdCheckRuns(dir, {});

    expect(printed()).toContain("Not running (25)");
  });

  it("emits a machine-readable report under --format=json", async () => {
    await writeRunningRun("a");

    await cmdCheckRuns(dir, { format: "json" });

    const data = JSON.parse(printed());
    expect(data.liveness).toEqual({ total: 1, live: 0, foreign: 0, unknown: 0, orphaned: 1 });
    expect(data.liveLocks).toBe(0);
    expect(data.ended).toBe(0);
    expect(data.runs[0]).toMatchObject({ id: "a", liveness: "orphaned", canEnd: true, ended: false });
  });

  it("reports what it ended in the JSON report", async () => {
    await writeRunningRun("a");

    await cmdCheckRuns(dir, { format: "json", fix: "true" });

    const data = JSON.parse(printed());
    expect(data.fixed).toBe(true);
    expect(data.ended).toBe(1);
    expect(data.runs[0].ended).toBe(true);
  });

  // ── Exit codes ──────────────────────────────────────────────────────

  it("exits 0 by default however much it finds", async () => {
    await writeRunningRun("a");
    await cmdCheckRuns(dir, {});
    expect(process.exitCode).toBeUndefined();
  });

  it("fails under --strict when a run is not confirmed running", async () => {
    await writeRunningRun("a");
    await cmdCheckRuns(dir, { strict: "true" });
    expect(process.exitCode).toBe(1);
  });

  it("passes under --strict once --fix has cleared them", async () => {
    // --fix then --strict in one invocation should succeed: the runs it just
    // ended are no longer outstanding, so failing would be reporting a problem
    // the same command already solved.
    await writeRunningRun("a");
    await cmdCheckRuns(dir, { strict: "true", fix: "true" });
    expect(process.exitCode).toBeUndefined();
  });

  it("passes under --strict when every run is genuinely running", async () => {
    await writeRunningRun("a");
    await writeFile(
      join(locksDir, `${process.pid}.lock`),
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), taskId: "task-a" }),
    );

    await cmdCheckRuns(dir, { strict: "true" });
    expect(process.exitCode).toBeUndefined();
  });
});
