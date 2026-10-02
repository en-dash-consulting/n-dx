/**
 * Run-liveness parity: `@n-dx/hench` and `@n-dx/web` must reach identical
 * verdicts about whether a run recorded as running is actually running.
 *
 * `hench/src/process/run-liveness.ts` is canonical — hench owns `.hench/runs/`
 * and `.hench/locks/`. `web/src/server/run-liveness.ts` mirrors it because web
 * takes no runtime dependency on hench. Both end runs (hench check-runs, the
 * dashboard's reconcile), so a divergence is a data-loss bug, not a cosmetic
 * one.
 *
 * If this fails: apply the change to BOTH modules. Do not relax the fixtures.
 */

import { describe, it, expect } from "vitest";
import {
  classifyRunLiveness as henchClassify,
  summarizeLiveness as henchSummarize,
  LOCK_ATTRIBUTION_WINDOW_MS as HENCH_WINDOW_MS,
  RUN_STALE_THRESHOLD_MS as HENCH_STALE_MS,
} from "../../packages/hench/dist/process/run-liveness.js";
import {
  classifyRunLiveness as webClassify,
  summarizeLiveness as webSummarize,
  LOCK_ATTRIBUTION_WINDOW_MS as WEB_WINDOW_MS,
  RUN_STALE_THRESHOLD_MS as WEB_STALE_MS,
} from "../../packages/web/dist/server/run-liveness.js";

const HOST = "parity-host";
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const iso = (ms) => new Date(ms).toISOString();

/** Pids the fixtures treat as alive; every other pid is dead. */
const ALIVE = new Set([4242, 7, 99, 11, 22, 1, 500]);
const probe = (pid) => ALIVE.has(pid);

/** One case per branch of the classifier, plus the edges that decide canEnd. */
const CASES = [
  {
    name: "own pid alive, fresh heartbeat",
    run: { taskId: "t1", startedAt: iso(NOW - HOUR), lastActivityAt: iso(NOW - MINUTE), host: HOST, pid: 500 },
    ctx: { liveLocks: [] },
  },
  {
    name: "own pid alive, heartbeat exactly at the stale threshold",
    run: { taskId: "t1", startedAt: iso(NOW - HOUR), lastActivityAt: iso(NOW - HENCH_STALE_MS), host: HOST, pid: 500 },
    ctx: { liveLocks: [] },
  },
  {
    name: "own pid alive, heartbeat one ms past the stale threshold",
    run: { taskId: "t1", startedAt: iso(NOW - HOUR), lastActivityAt: iso(NOW - HENCH_STALE_MS - 1), host: HOST, pid: 500 },
    ctx: { liveLocks: [] },
  },
  {
    name: "own pid alive, no timestamps",
    run: { taskId: "t1", host: HOST, pid: 500 },
    ctx: { liveLocks: [] },
  },
  {
    name: "own pid dead, even with a live lock naming the task",
    run: { taskId: "t1", startedAt: iso(NOW - HOUR), lastActivityAt: iso(NOW - 3 * 24 * HOUR), host: HOST, pid: 600 },
    ctx: { liveLocks: [{ pid: 4242, startedAt: iso(NOW - HOUR), taskId: "t1" }] },
  },
  {
    name: "named by a live lock",
    run: { taskId: "t1", startedAt: iso(NOW - HOUR), host: HOST },
    ctx: { liveLocks: [{ pid: 4242, startedAt: iso(NOW - HOUR), taskId: "t1" }] },
  },
  {
    name: "lock-held and long silent",
    run: { taskId: "t1", startedAt: iso(NOW - 30 * 24 * HOUR), lastActivityAt: iso(NOW - 30 * 24 * HOUR), host: HOST },
    ctx: { liveLocks: [{ pid: 7, startedAt: iso(NOW - 30 * 24 * HOUR), taskId: "t1" }] },
  },
  {
    name: "recorded on another host",
    run: { taskId: "t1", startedAt: iso(NOW - 50 * HOUR), host: "elsewhere", pid: 500 },
    ctx: { liveLocks: [] },
  },
  {
    name: "no live process at all",
    run: { taskId: "t1", startedAt: iso(NOW - 50 * HOUR), lastActivityAt: iso(NOW - 49 * HOUR), host: HOST },
    ctx: { liveLocks: [] },
  },
  {
    name: "no host recorded (legacy run)",
    run: { taskId: "t1", startedAt: iso(NOW - 50 * HOUR) },
    ctx: { liveLocks: [] },
  },
  {
    name: "untagged lock from the same moment",
    run: { taskId: "t1", startedAt: iso(NOW - 2 * HOUR), host: HOST },
    ctx: { liveLocks: [{ pid: 99, startedAt: iso(NOW - 2 * HOUR) }] },
  },
  {
    name: "several untagged locks from the same moment",
    run: { taskId: "t1", startedAt: iso(NOW - 2 * HOUR), host: HOST },
    ctx: {
      liveLocks: [
        { pid: 11, startedAt: iso(NOW - 2 * HOUR) },
        { pid: 22, startedAt: iso(NOW - 2 * HOUR) },
      ],
    },
  },
  {
    name: "untagged lock started long after the run",
    run: { taskId: "t1", startedAt: iso(NOW - 50 * HOUR), host: HOST },
    ctx: { liveLocks: [{ pid: 99, startedAt: iso(NOW - MINUTE) }] },
  },
  {
    name: "untagged lock exactly at the attribution edge",
    run: { taskId: "t1", startedAt: iso(NOW - 10 * HOUR), host: HOST },
    ctx: { liveLocks: [{ pid: 1, startedAt: iso(NOW - 10 * HOUR + HENCH_WINDOW_MS) }] },
  },
  {
    name: "untagged lock one ms past the attribution edge",
    run: { taskId: "t1", startedAt: iso(NOW - 10 * HOUR), host: HOST },
    ctx: { liveLocks: [{ pid: 1, startedAt: iso(NOW - 10 * HOUR + HENCH_WINDOW_MS + 1) }] },
  },
  {
    name: "lock tagged for a different task",
    run: { taskId: "t1", startedAt: iso(NOW - 2 * HOUR), host: HOST },
    ctx: { liveLocks: [{ pid: 99, startedAt: iso(NOW - 2 * HOUR), taskId: "t2" }] },
  },
  {
    name: "unparseable timestamps",
    run: { taskId: "t1", startedAt: "not-a-date", host: HOST },
    ctx: { liveLocks: [{ pid: 99, startedAt: "also-not-a-date" }] },
  },
  {
    name: "no start time at all",
    run: { taskId: "t1", host: HOST },
    ctx: { liveLocks: [] },
  },
];

const full = (ctx) => ({ ...ctx, host: HOST, now: NOW, isPidAlive: probe });

describe("run-liveness parity between hench and web", () => {
  it("exports the same thresholds", () => {
    expect(WEB_WINDOW_MS).toBe(HENCH_WINDOW_MS);
    expect(WEB_STALE_MS).toBe(HENCH_STALE_MS);
  });

  for (const { name, run, ctx } of CASES) {
    it(`agrees on: ${name}`, () => {
      // The whole verdict: the reason is shown to the user and canEnd decides
      // whether a run gets ended.
      expect(webClassify(run, full(ctx))).toEqual(henchClassify(run, full(ctx)));
    });
  }

  it("covers every verdict the classifier can return", () => {
    const reached = new Set(CASES.map(({ run, ctx }) => henchClassify(run, full(ctx)).liveness));
    expect([...reached].sort()).toEqual(["foreign", "live", "orphaned", "unknown"]);
  });

  it("agrees on the summary tally", () => {
    const verdicts = CASES.map(({ run, ctx }) => henchClassify(run, full(ctx)));
    expect(webSummarize(verdicts)).toEqual(henchSummarize(verdicts));
  });
});
