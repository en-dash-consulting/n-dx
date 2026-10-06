/**
 * The web-only parts of run-liveness: the dashboard's managed-child rule and
 * input normalisation. The mirrored classifier is pinned to hench's by
 * `tests/e2e/run-liveness-parity.test.js`.
 */

import { describe, it, expect } from "vitest";
import { classifyRunLiveness, judgeRunLiveness, livenessInputOf } from "../../../src/server/run-liveness.js";

const HOST = "here";
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const iso = (ms: number): string => new Date(ms).toISOString();
const ctx = { liveLocks: [], host: HOST, now: NOW, isPidAlive: () => false };

describe("judgeRunLiveness", () => {
  const run = { taskId: "t1", startedAt: iso(NOW - 60_000), host: HOST, pid: 77 };

  it("counts a run the dashboard still holds as live, whatever the pid says", () => {
    const verdict = judgeRunLiveness(run, ctx, [{ taskId: "t1", status: "running", startedAt: iso(NOW - 120_000) }]);
    expect(verdict).toMatchObject({ liveness: "live", canEnd: false, pid: 77 });
    expect(verdict.reason).toContain("dashboard");
  });

  it("counts a starting execution too", () => {
    expect(judgeRunLiveness(run, ctx, [{ taskId: "t1", status: "starting", startedAt: iso(NOW - 120_000) }]).liveness).toBe("live");
  });

  it("does not lend the execution's liveness to an older record of the same task", () => {
    const verdict = judgeRunLiveness(run, ctx, [{ taskId: "t1", status: "running", startedAt: iso(NOW - 30_000) }]);
    expect(verdict).toEqual(classifyRunLiveness(run, ctx));
    expect(verdict.liveness).toBe("orphaned");
  });

  it("ignores finished executions and other tasks", () => {
    const executions = [
      { taskId: "t1", status: "completed", startedAt: iso(NOW - 120_000) },
      { taskId: "t2", status: "running", startedAt: iso(NOW - 120_000) },
    ];
    expect(judgeRunLiveness(run, ctx, executions)).toEqual(classifyRunLiveness(run, ctx));
  });
});

describe("livenessInputOf", () => {
  it("keeps well-typed fields and drops the rest", () => {
    expect(livenessInputOf({ taskId: "t", startedAt: 5, lastActivityAt: null, host: "h", pid: "12" })).toEqual({
      taskId: "t",
      startedAt: undefined,
      lastActivityAt: undefined,
      host: "h",
      pid: undefined,
    });
    expect(livenessInputOf({ pid: 12 }).pid).toBe(12);
  });
});
