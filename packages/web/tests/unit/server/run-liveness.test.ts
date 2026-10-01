import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  classifyRunLiveness,
  collectLiveLocks,
  summarizeLiveness,
  locksDirFor,
  isPidAlive,
  LOCK_ATTRIBUTION_WINDOW_MS,
  type LiveLock,
} from "../../../src/server/run-liveness.js";

const HOST = "test-host";
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const HOUR = 3_600_000;

/** A context with no evidence of any live process. */
function emptyCtx(overrides: Partial<Parameters<typeof classifyRunLiveness>[1]> = {}) {
  return {
    liveLocks: [] as LiveLock[],
    managedTaskIds: new Set<string>(),
    host: HOST,
    now: NOW,
    ...overrides,
  };
}

describe("classifyRunLiveness", () => {
  it("reports a run this dashboard owns as live", () => {
    const verdict = classifyRunLiveness(
      { taskId: "task-1", startedAt: new Date(NOW - HOUR).toISOString(), host: HOST },
      emptyCtx({ managedTaskIds: new Set(["task-1"]) }),
    );
    expect(verdict.liveness).toBe("live");
    expect(verdict.canEnd).toBe(false);
  });

  it("reports a run named by a live lock as live, and carries the pid", () => {
    const verdict = classifyRunLiveness(
      { taskId: "task-1", startedAt: new Date(NOW - HOUR).toISOString(), host: HOST },
      emptyCtx({
        liveLocks: [{ pid: 4242, startedAt: new Date(NOW - HOUR).toISOString(), taskId: "task-1" }],
      }),
    );
    expect(verdict.liveness).toBe("live");
    expect(verdict.pid).toBe(4242);
    expect(verdict.reason).toContain("4242");
  });

  it("keeps a lock-held run live however long it has been silent", () => {
    // The whole point of evidence over a timer: a 30-day run with a live lock
    // is running, and the old `stale` heuristic would have condemned it.
    const verdict = classifyRunLiveness(
      {
        taskId: "task-1",
        startedAt: new Date(NOW - 30 * 24 * HOUR).toISOString(),
        lastActivityAt: new Date(NOW - 30 * 24 * HOUR).toISOString(),
        host: HOST,
      },
      emptyCtx({
        liveLocks: [{ pid: 7, startedAt: new Date(NOW - 30 * 24 * HOUR).toISOString(), taskId: "task-1" }],
      }),
    );
    expect(verdict.liveness).toBe("live");
  });

  it("withholds judgment on a run recorded by another machine", () => {
    const verdict = classifyRunLiveness(
      { taskId: "task-1", startedAt: new Date(NOW - 50 * HOUR).toISOString(), host: "other-box" },
      emptyCtx(),
    );
    expect(verdict.liveness).toBe("foreign");
    expect(verdict.canEnd).toBe(false);
    expect(verdict.reason).toContain("other-box");
  });

  it("condemns a run with no live process on this host", () => {
    const verdict = classifyRunLiveness(
      {
        taskId: "task-1",
        startedAt: new Date(NOW - 50 * HOUR).toISOString(),
        lastActivityAt: new Date(NOW - 49 * HOUR).toISOString(),
        host: HOST,
      },
      emptyCtx(),
    );
    expect(verdict.liveness).toBe("orphaned");
    expect(verdict.canEnd).toBe(true);
    expect(verdict.reason).toContain("2d 1h");
  });

  it("condemns a run whose host was never recorded", () => {
    // Legacy run files predate the `host` field; absent it, the run is assumed
    // local, which is the only host that ever wrote to this runs directory.
    const verdict = classifyRunLiveness(
      { taskId: "task-1", startedAt: new Date(NOW - 50 * HOUR).toISOString() },
      emptyCtx(),
    );
    expect(verdict.liveness).toBe("orphaned");
  });

  it("cannot attribute an untagged lock started at the same time", () => {
    const startedAt = new Date(NOW - 2 * HOUR).toISOString();
    const verdict = classifyRunLiveness(
      { taskId: "task-1", startedAt, host: HOST },
      emptyCtx({ liveLocks: [{ pid: 99, startedAt }] }),
    );
    expect(verdict.liveness).toBe("unknown");
    expect(verdict.canEnd).toBe(false);
    expect(verdict.pid).toBe(99);
  });

  it("rules out an untagged lock that started long after the run", () => {
    // Without this, one hench process started today would make every abandoned
    // run on disk unattributable and therefore un-endable.
    const verdict = classifyRunLiveness(
      {
        taskId: "task-1",
        startedAt: new Date(NOW - 50 * HOUR).toISOString(),
        host: HOST,
      },
      emptyCtx({
        liveLocks: [{ pid: 99, startedAt: new Date(NOW - 60_000).toISOString() }],
      }),
    );
    expect(verdict.liveness).toBe("orphaned");
  });

  it("treats the attribution window as inclusive at its edge", () => {
    const runStart = NOW - 10 * HOUR;
    const atEdge = classifyRunLiveness(
      { taskId: "t", startedAt: new Date(runStart).toISOString(), host: HOST },
      emptyCtx({
        liveLocks: [{ pid: 1, startedAt: new Date(runStart + LOCK_ATTRIBUTION_WINDOW_MS).toISOString() }],
      }),
    );
    expect(atEdge.liveness).toBe("unknown");

    const pastEdge = classifyRunLiveness(
      { taskId: "t", startedAt: new Date(runStart).toISOString(), host: HOST },
      emptyCtx({
        liveLocks: [{ pid: 1, startedAt: new Date(runStart + LOCK_ATTRIBUTION_WINDOW_MS + 1).toISOString() }],
      }),
    );
    expect(pastEdge.liveness).toBe("orphaned");
  });

  it("ignores a lock tagged for a different task when attributing", () => {
    const startedAt = new Date(NOW - 2 * HOUR).toISOString();
    const verdict = classifyRunLiveness(
      { taskId: "task-1", startedAt, host: HOST },
      emptyCtx({ liveLocks: [{ pid: 99, startedAt, taskId: "task-2" }] }),
    );
    expect(verdict.liveness).toBe("orphaned");
  });

  it("will not condemn a run it cannot place in time", () => {
    const verdict = classifyRunLiveness(
      { taskId: "task-1", host: HOST },
      emptyCtx({ liveLocks: [{ pid: 99, startedAt: "not-a-date" }] }),
    );
    expect(verdict.liveness).toBe("unknown");
  });
});

describe("collectLiveLocks", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "run-liveness-"));
    await mkdir(locksDirFor(tmp), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("returns an empty list when the locks directory is missing", () => {
    expect(collectLiveLocks(join(tmp, "nope"))).toEqual([]);
  });

  it("keeps locks held by a live process and drops dead ones", async () => {
    const locks = locksDirFor(tmp);
    // This test process is, definitionally, alive.
    await writeFile(
      join(locks, `${process.pid}.lock`),
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), taskId: "alive" }),
    );
    // A PID that cannot be running: PID 0 is never a user process.
    const deadPid = 0x7ffffff0;
    expect(isPidAlive(deadPid)).toBe(false);
    await writeFile(
      join(locks, `${deadPid}.lock`),
      JSON.stringify({ pid: deadPid, startedAt: new Date().toISOString(), taskId: "dead" }),
    );

    const live = collectLiveLocks(locks);
    expect(live).toHaveLength(1);
    expect(live[0]!.taskId).toBe("alive");
  });

  it("skips corrupt lock files and non-lock entries", async () => {
    const locks = locksDirFor(tmp);
    await writeFile(join(locks, "broken.lock"), "{not json");
    await writeFile(join(locks, "notes.txt"), JSON.stringify({ pid: process.pid }));
    expect(collectLiveLocks(locks)).toEqual([]);
  });
});

describe("summarizeLiveness", () => {
  it("counts every verdict and the total", () => {
    expect(
      summarizeLiveness([
        { liveness: "live" },
        { liveness: "orphaned" },
        { liveness: "orphaned" },
        { liveness: "foreign" },
        { liveness: "unknown" },
      ]),
    ).toEqual({ total: 5, live: 1, foreign: 1, unknown: 1, orphaned: 2 });
  });

  it("reports zeroes for an empty sweep", () => {
    expect(summarizeLiveness([])).toEqual({ total: 0, live: 0, foreign: 0, unknown: 0, orphaned: 0 });
  });
});
