/**
 * Run-liveness parity: `@n-dx/hench` and `@n-dx/web` must reach identical
 * verdicts about whether a run is actually running.
 *
 * The rules live in two places on purpose. `hench/src/process/run-liveness.ts`
 * is canonical — hench owns `.hench/locks/` and `.hench/runs/`. The web package
 * carries a mirror at `web/src/server/run-liveness.ts` because it deliberately
 * takes no runtime dependency on hench, the same reason
 * `web/src/server/concurrent-execution-metrics.ts` and the lock-file shape in
 * `routes-hench.ts` are duplicated.
 *
 * Duplication is only safe while it is pinned. Without this test the `hench
 * check-runs` CLI and the dashboard's audit could quietly start disagreeing
 * about which runs are dead — and both of them end runs, so a divergence is a
 * data-loss bug, not a cosmetic one.
 *
 * If this fails: apply the change to BOTH modules. Do not "fix" it by relaxing
 * the fixture.
 */

import { describe, it, expect } from "vitest";
import {
  classifyRunLiveness as henchClassify,
  summarizeLiveness as henchSummarize,
  LOCK_ATTRIBUTION_WINDOW_MS as HENCH_WINDOW_MS,
} from "../../packages/hench/dist/process/run-liveness.js";
import {
  classifyRunLiveness as webClassify,
  summarizeLiveness as webSummarize,
  LOCK_ATTRIBUTION_WINDOW_MS as WEB_WINDOW_MS,
} from "../../packages/web/dist/server/run-liveness.js";

const HOST = "parity-host";
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const HOUR = 3_600_000;
const iso = (ms) => new Date(ms).toISOString();

/**
 * One case per branch of the classifier, plus the edges that decide whether an
 * abandoned run can be ended. Each is run through both implementations.
 */
const CASES = [
  {
    name: "owned by the caller",
    run: { taskId: "t1", startedAt: iso(NOW - HOUR), host: HOST },
    ctx: { liveLocks: [], managedTaskIds: new Set(["t1"]) },
  },
  {
    name: "named by a live lock",
    run: { taskId: "t1", startedAt: iso(NOW - HOUR), host: HOST },
    ctx: {
      liveLocks: [{ pid: 4242, startedAt: iso(NOW - HOUR), taskId: "t1" }],
      managedTaskIds: new Set(),
    },
  },
  {
    name: "lock-held and long silent",
    run: {
      taskId: "t1",
      startedAt: iso(NOW - 30 * 24 * HOUR),
      lastActivityAt: iso(NOW - 30 * 24 * HOUR),
      host: HOST,
    },
    ctx: {
      liveLocks: [{ pid: 7, startedAt: iso(NOW - 30 * 24 * HOUR), taskId: "t1" }],
      managedTaskIds: new Set(),
    },
  },
  {
    name: "recorded on another host",
    run: { taskId: "t1", startedAt: iso(NOW - 50 * HOUR), host: "elsewhere" },
    ctx: { liveLocks: [], managedTaskIds: new Set() },
  },
  {
    name: "no live process at all",
    run: {
      taskId: "t1",
      startedAt: iso(NOW - 50 * HOUR),
      lastActivityAt: iso(NOW - 49 * HOUR),
      host: HOST,
    },
    ctx: { liveLocks: [], managedTaskIds: new Set() },
  },
  {
    name: "no host recorded (legacy run)",
    run: { taskId: "t1", startedAt: iso(NOW - 50 * HOUR) },
    ctx: { liveLocks: [], managedTaskIds: new Set() },
  },
  {
    name: "untagged lock from the same moment",
    run: { taskId: "t1", startedAt: iso(NOW - 2 * HOUR), host: HOST },
    ctx: {
      liveLocks: [{ pid: 99, startedAt: iso(NOW - 2 * HOUR) }],
      managedTaskIds: new Set(),
    },
  },
  {
    name: "several untagged locks from the same moment",
    run: { taskId: "t1", startedAt: iso(NOW - 2 * HOUR), host: HOST },
    ctx: {
      liveLocks: [
        { pid: 11, startedAt: iso(NOW - 2 * HOUR) },
        { pid: 22, startedAt: iso(NOW - 2 * HOUR) },
      ],
      managedTaskIds: new Set(),
    },
  },
  {
    name: "untagged lock started long after the run",
    run: { taskId: "t1", startedAt: iso(NOW - 50 * HOUR), host: HOST },
    ctx: {
      liveLocks: [{ pid: 99, startedAt: iso(NOW - 60_000) }],
      managedTaskIds: new Set(),
    },
  },
  {
    name: "untagged lock exactly at the attribution edge",
    run: { taskId: "t1", startedAt: iso(NOW - 10 * HOUR), host: HOST },
    ctx: {
      liveLocks: [{ pid: 1, startedAt: iso(NOW - 10 * HOUR + HENCH_WINDOW_MS) }],
      managedTaskIds: new Set(),
    },
  },
  {
    name: "untagged lock one ms past the attribution edge",
    run: { taskId: "t1", startedAt: iso(NOW - 10 * HOUR), host: HOST },
    ctx: {
      liveLocks: [{ pid: 1, startedAt: iso(NOW - 10 * HOUR + HENCH_WINDOW_MS + 1) }],
      managedTaskIds: new Set(),
    },
  },
  {
    name: "lock tagged for a different task",
    run: { taskId: "t1", startedAt: iso(NOW - 2 * HOUR), host: HOST },
    ctx: {
      liveLocks: [{ pid: 99, startedAt: iso(NOW - 2 * HOUR), taskId: "t2" }],
      managedTaskIds: new Set(),
    },
  },
  {
    name: "unparseable timestamps",
    run: { taskId: "t1", startedAt: "not-a-date", host: HOST },
    ctx: {
      liveLocks: [{ pid: 99, startedAt: "also-not-a-date" }],
      managedTaskIds: new Set(),
    },
  },
  {
    name: "no start time at all",
    run: { taskId: "t1", host: HOST },
    ctx: { liveLocks: [], managedTaskIds: new Set() },
  },
];

describe("run-liveness parity between hench and web", () => {
  it("exports the same lock-attribution window", () => {
    expect(WEB_WINDOW_MS).toBe(HENCH_WINDOW_MS);
  });

  for (const { name, run, ctx } of CASES) {
    it(`agrees on: ${name}`, () => {
      const full = { ...ctx, host: HOST, now: NOW };
      const fromHench = henchClassify(run, full);
      const fromWeb = webClassify(run, full);
      // The whole verdict, not just the label: the reason string is shown to
      // the user and the `canEnd` flag decides whether a run gets ended.
      expect(fromWeb).toEqual(fromHench);
    });
  }

  it("covers every verdict the classifier can return", () => {
    // A fixture table that drifted to only exercise two branches would still
    // pass every case above, so assert the coverage itself.
    const reached = new Set(
      CASES.map(({ run, ctx }) => henchClassify(run, { ...ctx, host: HOST, now: NOW }).liveness),
    );
    expect([...reached].sort()).toEqual(["foreign", "live", "orphaned", "unknown"]);
  });

  it("agrees on the summary tally", () => {
    const verdicts = CASES.map(({ run, ctx }) =>
      henchClassify(run, { ...ctx, host: HOST, now: NOW }),
    );
    expect(webSummarize(verdicts)).toEqual(henchSummarize(verdicts));
  });
});
