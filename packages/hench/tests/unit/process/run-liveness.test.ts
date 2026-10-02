import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  classifyRunLiveness,
  collectLiveLocks,
  summarizeLiveness,
  locksDirOf,
  isPidAlive,
  LOCK_ATTRIBUTION_WINDOW_MS,
  RUN_STALE_THRESHOLD_MS,
  type LiveLock,
  type LivenessContext,
} from "../../../src/process/run-liveness.js";

const HOST = "test-host";
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** A context with no evidence of any live process. */
function emptyCtx(overrides: Partial<LivenessContext> = {}): LivenessContext {
  return {
    liveLocks: [] as LiveLock[],
    host: HOST,
    now: NOW,
    isPidAlive: () => false,
    ...overrides,
  };
}

const alive = () => true;

describe("classifyRunLiveness — recorded pid", () => {
  it("reports a live pid with a fresh heartbeat as live", () => {
    const verdict = classifyRunLiveness(
      { taskId: "t", startedAt: iso(NOW - HOUR), lastActivityAt: iso(NOW - 30_000), host: HOST, pid: 4242 },
      emptyCtx({ isPidAlive: alive }),
    );
    expect(verdict).toMatchObject({ liveness: "live", pid: 4242, canEnd: false });
  });

  it("reports a dead pid on this host as orphaned and endable", () => {
    const verdict = classifyRunLiveness(
      { taskId: "t", startedAt: iso(NOW - HOUR), lastActivityAt: iso(NOW - 30_000), host: HOST, pid: 4242 },
      emptyCtx(),
    );
    expect(verdict).toMatchObject({ liveness: "orphaned", pid: null, canEnd: true });
    expect(verdict.reason).toContain("4242");
  });

  it("reports a live pid whose heartbeat is past the stale threshold as unknown, not live", () => {
    const verdict = classifyRunLiveness(
      {
        taskId: "t",
        startedAt: iso(NOW - HOUR),
        lastActivityAt: iso(NOW - RUN_STALE_THRESHOLD_MS - 1),
        host: HOST,
        pid: 4242,
      },
      emptyCtx({ isPidAlive: alive }),
    );
    expect(verdict).toMatchObject({ liveness: "unknown", pid: 4242, canEnd: false });
    expect(verdict.reason).toMatch(/stopped reporting/);
  });

  it("keeps a heartbeat exactly at the threshold live", () => {
    const verdict = classifyRunLiveness(
      { startedAt: iso(NOW - HOUR), lastActivityAt: iso(NOW - RUN_STALE_THRESHOLD_MS), host: HOST, pid: 1 },
      emptyCtx({ isPidAlive: alive }),
    );
    expect(verdict.liveness).toBe("live");
  });

  it("prefers the recorded pid over lock files", () => {
    const verdict = classifyRunLiveness(
      { taskId: "t", startedAt: iso(NOW - HOUR), lastActivityAt: iso(NOW), host: HOST, pid: 4242 },
      emptyCtx({ liveLocks: [{ pid: 7, startedAt: iso(NOW - HOUR), taskId: "t" }] }),
    );
    expect(verdict.liveness).toBe("orphaned");
  });

  it("reports a run recorded on another host as foreign without probing its pid", () => {
    let probed = false;
    const verdict = classifyRunLiveness(
      { taskId: "t", startedAt: iso(NOW - HOUR), host: "other-box", pid: 4242 },
      emptyCtx({ isPidAlive: () => ((probed = true), false) }),
    );
    expect(verdict).toMatchObject({ liveness: "foreign", canEnd: false });
    expect(verdict.reason).toContain("other-box");
    expect(probed).toBe(false);
  });
});

describe("isPidAlive", () => {
  it("counts this process as alive", () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it("counts EPERM as alive", () => {
    const original = process.kill;
    process.kill = (() => {
      throw Object.assign(new Error("EPERM"), { code: "EPERM" });
    }) as typeof process.kill;
    try {
      expect(isPidAlive(1)).toBe(true);
    } finally {
      process.kill = original;
    }
  });

  it("counts ESRCH as dead", () => {
    const original = process.kill;
    process.kill = (() => {
      throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
    }) as typeof process.kill;
    try {
      expect(isPidAlive(1)).toBe(false);
    } finally {
      process.kill = original;
    }
  });
});

// Ported from draft PR #484: records without a pid fall back to lock files.
describe("classifyRunLiveness — lock fallback", () => {
  it("reports a run named by a live lock as live, and carries the pid", () => {
    const verdict = classifyRunLiveness(
      { taskId: "task-1", startedAt: iso(NOW - HOUR), host: HOST },
      emptyCtx({ liveLocks: [{ pid: 4242, startedAt: iso(NOW - HOUR), taskId: "task-1" }] }),
    );
    expect(verdict.liveness).toBe("live");
    expect(verdict.pid).toBe(4242);
    expect(verdict.reason).toContain("4242");
  });

  it("keeps a lock-held run live however long it has been silent", () => {
    const verdict = classifyRunLiveness(
      {
        taskId: "task-1",
        startedAt: iso(NOW - 30 * 24 * HOUR),
        lastActivityAt: iso(NOW - 30 * 24 * HOUR),
        host: HOST,
      },
      emptyCtx({ liveLocks: [{ pid: 7, startedAt: iso(NOW - 30 * 24 * HOUR), taskId: "task-1" }] }),
    );
    expect(verdict.liveness).toBe("live");
  });

  it("withholds judgment on a run recorded by another machine", () => {
    const verdict = classifyRunLiveness(
      { taskId: "task-1", startedAt: iso(NOW - 50 * HOUR), host: "other-box" },
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
        startedAt: iso(NOW - 50 * HOUR),
        lastActivityAt: iso(NOW - 49 * HOUR),
        host: HOST,
      },
      emptyCtx(),
    );
    expect(verdict.liveness).toBe("orphaned");
    expect(verdict.canEnd).toBe(true);
    expect(verdict.reason).toContain("2d 1h");
  });

  it("condemns a run whose host was never recorded", () => {
    const verdict = classifyRunLiveness(
      { taskId: "task-1", startedAt: iso(NOW - 50 * HOUR) },
      emptyCtx(),
    );
    expect(verdict.liveness).toBe("orphaned");
  });

  it("cannot attribute an untagged lock started at the same time", () => {
    const startedAt = iso(NOW - 2 * HOUR);
    const verdict = classifyRunLiveness(
      { taskId: "task-1", startedAt, host: HOST },
      emptyCtx({ liveLocks: [{ pid: 99, startedAt }] }),
    );
    expect(verdict.liveness).toBe("unknown");
    expect(verdict.canEnd).toBe(false);
    expect(verdict.pid).toBe(99);
  });

  it("rules out an untagged lock that started long after the run", () => {
    const verdict = classifyRunLiveness(
      { taskId: "task-1", startedAt: iso(NOW - 50 * HOUR), host: HOST },
      emptyCtx({ liveLocks: [{ pid: 99, startedAt: iso(NOW - 60_000) }] }),
    );
    expect(verdict.liveness).toBe("orphaned");
  });

  it("treats the attribution window as inclusive at its edge", () => {
    const runStart = NOW - 10 * HOUR;
    const atEdge = classifyRunLiveness(
      { taskId: "t", startedAt: iso(runStart), host: HOST },
      emptyCtx({ liveLocks: [{ pid: 1, startedAt: iso(runStart + LOCK_ATTRIBUTION_WINDOW_MS) }] }),
    );
    expect(atEdge.liveness).toBe("unknown");

    const pastEdge = classifyRunLiveness(
      { taskId: "t", startedAt: iso(runStart), host: HOST },
      emptyCtx({ liveLocks: [{ pid: 1, startedAt: iso(runStart + LOCK_ATTRIBUTION_WINDOW_MS + 1) }] }),
    );
    expect(pastEdge.liveness).toBe("orphaned");
  });

  it("ignores a lock tagged for a different task when attributing", () => {
    const startedAt = iso(NOW - 2 * HOUR);
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
    await mkdir(locksDirOf(tmp), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("returns an empty list when the locks directory is missing", () => {
    expect(collectLiveLocks(join(tmp, "nope"))).toEqual([]);
  });

  it("keeps locks held by a live process and drops dead ones", async () => {
    const locks = locksDirOf(tmp);
    await writeFile(join(locks, "1.lock"), JSON.stringify({ pid: 1, startedAt: iso(NOW), taskId: "alive" }));
    await writeFile(join(locks, "2.lock"), JSON.stringify({ pid: 2, startedAt: iso(NOW), taskId: "dead" }));

    const live = collectLiveLocks(locks, (pid) => pid === 1);
    expect(live).toHaveLength(1);
    expect(live[0]!.taskId).toBe("alive");
  });

  it("skips corrupt lock files and non-lock entries", async () => {
    const locks = locksDirOf(tmp);
    await writeFile(join(locks, "broken.lock"), "{not json");
    await writeFile(join(locks, "notes.txt"), JSON.stringify({ pid: process.pid }));
    expect(collectLiveLocks(locks, alive)).toEqual([]);
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
