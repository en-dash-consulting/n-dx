import { describe, it, expect } from "vitest";
import {
  decideGateOnlyRetry,
  gateOnlyProbeCommits,
  inheritableReview,
  taskRunsNewestFirst,
  type GateOnlyGitFacts,
} from "../../../../src/agent/lifecycle/gate-only-retry.js";
import type { RunRecord, RunReviewRecord } from "../../../../src/schema/index.js";

const BASE = "a".repeat(40);
const EARLIER_BASE = "e".repeat(40);
const WORK = "b".repeat(40);

function gateFailure(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run-source",
    taskId: "t1",
    taskTitle: "Task",
    startedAt: "2026-10-06T12:00:00.000Z",
    status: "failed",
    turns: 1,
    tokenUsage: { input: 0, output: 0 },
    toolCalls: [],
    model: "m",
    startHead: BASE,
    branch: "fix/539",
    commits: [{ sha: WORK, subject: "feat: work" }],
    testGate: { ran: true, passed: false, packages: [] },
    completionHold: { outcome: "not-applied", resolutionType: "code-change", requestedAt: "2026-10-06T12:01:00.000Z" },
    ...overrides,
  };
}

function facts(overrides: Partial<GateOnlyGitFacts> = {}): GateOnlyGitFacts {
  return { reachable: new Set([BASE, WORK, EARLIER_BASE]), clean: true, branch: "fix/539", ...overrides };
}

function reason(runs: RunRecord[], f = facts()): string {
  const decision = decideGateOnlyRetry(runs, f);
  if (decision.eligible) throw new Error("expected ineligible");
  return decision.reason;
}

describe("decideGateOnlyRetry", () => {
  it("is eligible for a gate-only failure with committed work in HEAD on a clean tree", () => {
    const source = gateFailure();
    const decision = decideGateOnlyRetry([source], facts());
    expect(decision).toMatchObject({ eligible: true, base: BASE, commits: source.commits, source });
    expect(decision.eligible && decision.hold).toMatchObject({ outcome: "not-applied", resolutionType: "code-change" });
  });

  it("bases the gate on the earliest start commit still in HEAD", () => {
    const earlier = gateFailure({ id: "run-earlier", startedAt: "2026-10-06T10:00:00.000Z", startHead: EARLIER_BASE });
    const decision = decideGateOnlyRetry([gateFailure(), earlier], facts());
    expect(decision.eligible && decision.base).toBe(EARLIER_BASE);
  });

  it("skips an earlier start commit that is no longer in HEAD, falling back to the source's", () => {
    const earlier = gateFailure({ id: "run-earlier", startedAt: "2026-10-06T10:00:00.000Z", startHead: EARLIER_BASE });
    const decision = decideGateOnlyRetry([gateFailure(), earlier], facts({ reachable: new Set([WORK]) }));
    expect(decision.eligible && decision.base).toBe(BASE);
  });

  it("reports nothing held when there is no run or no held completion", () => {
    expect(decideGateOnlyRetry([], facts())).toMatchObject({ eligible: false, held: false });
    expect(decideGateOnlyRetry([gateFailure({ completionHold: undefined })], facts()))
      .toMatchObject({ eligible: false, held: false });
    expect(decideGateOnlyRetry([gateFailure({ completionHold: { outcome: "applied" } })], facts()))
      .toMatchObject({ eligible: false, held: false });
    expect(decideGateOnlyRetry([gateFailure({ completionHold: { outcome: "not-applied" } })], facts()))
      .toMatchObject({ eligible: false, held: false });
  });

  it("refuses after a gate-only retry (loop guard)", () => {
    const retry = gateFailure({ gateOnlyRetry: { sourceRunId: "x", base: BASE, commits: [] } });
    expect(reason([retry])).toMatch(/itself a gate-only retry/);
  });

  it("refuses a run that did not end failed", () => {
    expect(reason([gateFailure({ status: "cancelled" })])).toMatch(/ended cancelled/);
  });

  it("refuses a failure that was not the test gate's", () => {
    expect(reason([gateFailure({ testGate: undefined })])).toMatch(/did not fail at the test gate/);
    expect(reason([gateFailure({ testGate: { ran: false, passed: true, packages: [] } })]))
      .toMatch(/did not fail at the test gate/);
  });

  it("refuses a run with no start commit or no commits", () => {
    expect(reason([gateFailure({ startHead: undefined })])).toMatch(/no start commit/);
    expect(reason([gateFailure({ commits: [] })])).toMatch(/committed nothing/);
  });

  it("refuses when HEAD does not contain the run's last commit", () => {
    expect(reason([gateFailure()], facts({ reachable: new Set([BASE]) }))).toMatch(/bbbbbbbb is not in HEAD/);
  });

  it("refuses on another branch, or a detached HEAD, when the run recorded one", () => {
    expect(reason([gateFailure()], facts({ branch: "main" }))).toMatch(/ran on fix\/539.*on main/);
    expect(reason([gateFailure()], facts({ branch: undefined }))).toMatch(/detached HEAD/);
    expect(decideGateOnlyRetry([gateFailure({ branch: undefined })], facts({ branch: "main" })).eligible).toBe(true);
  });

  it("refuses a dirty tree", () => {
    expect(reason([gateFailure()], facts({ clean: false }))).toMatch(/uncommitted changes/);
  });
});

describe("taskRunsNewestFirst", () => {
  it("keeps the task's runs only, newest first by startedAt", () => {
    const a = gateFailure({ id: "a", startedAt: "2026-10-06T09:00:00.000Z" });
    const b = gateFailure({ id: "b", startedAt: "2026-10-06T11:00:00.000Z" });
    const other = gateFailure({ id: "c", taskId: "t2", startedAt: "2026-10-06T12:00:00.000Z" });
    expect(taskRunsNewestFirst("t1", [a, other, b]).map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("gateOnlyProbeCommits", () => {
  it("probes the latest run's last commit and every start commit, once each", () => {
    const earlier = gateFailure({ id: "e", startHead: EARLIER_BASE });
    expect(gateOnlyProbeCommits([gateFailure(), earlier, gateFailure({ id: "dup" })]).sort())
      .toEqual([BASE, WORK, EARLIER_BASE].sort());
  });
});

describe("inheritableReview", () => {
  const passing: RunReviewRecord = {
    model: "m",
    resumedSession: true,
    findingCount: 1,
    unresolvedCount: 0,
    unrepairedMustFixCount: 0,
    failedActionCount: 0,
    fixesApplied: false,
    reportPath: "/r.json",
  };

  it("inherits a passing review when HEAD is the source run's last commit", () => {
    expect(inheritableReview(gateFailure({ review: passing }), WORK)).toEqual({ ...passing, inheritedFrom: "run-source" });
  });

  it("does not inherit when HEAD moved, the review failed, or a must-fix is unrepaired", () => {
    expect(inheritableReview(gateFailure({ review: passing }), BASE)).toBeUndefined();
    expect(inheritableReview(gateFailure({ review: passing }), undefined)).toBeUndefined();
    expect(inheritableReview(gateFailure({ review: { failed: "no-report", detail: "x" } }), WORK)).toBeUndefined();
    expect(inheritableReview(gateFailure({ review: { ...passing, unrepairedMustFixCount: 1 } }), WORK)).toBeUndefined();
    expect(inheritableReview(gateFailure(), WORK)).toBeUndefined();
  });
});
