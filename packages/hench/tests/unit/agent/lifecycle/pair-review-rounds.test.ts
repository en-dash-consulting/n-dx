import { describe, it, expect, vi } from "vitest";

/**
 * The round sequencing alone, with the reviewer and the executor stubbed: how
 * many fix rounds run, what each is handed, and what each leaves on the run.
 */

import { runPairReviewRounds } from "../../../../src/agent/lifecycle/pair-review-rounds.js";
import type { PairReviewResult, PairReviewStep } from "../../../../src/agent/lifecycle/pair-review-rounds.js";
import type { ReviewFinding } from "../../../../src/agent/analysis/adversarial-review.js";
import type { RunRecord } from "../../../../src/schema/index.js";

const mustFix = (title: string): ReviewFinding => ({
  title,
  severity: "high",
  verdict: "must-fix",
  scenario: "trigger",
  action: "dropped",
});

const reviewOf = (findings: ReviewFinding[], reportPath = "/r.json"): PairReviewResult => ({
  outcome: { ok: true, report: { taskId: "t", findings, fixesApplied: false, summary: "s" } },
  reportPath,
});

const newRun = (): RunRecord => ({ id: "run-1" }) as RunRecord;

describe("runPairReviewRounds", () => {
  it("runs no fix round when the first review has no must-fix finding", async () => {
    const run = newRun();
    const fix = vi.fn();
    const outcome = await runPairReviewRounds({
      run,
      rounds: 2,
      review: async () => reviewOf([{ ...mustFix("later"), verdict: "should-fix" }]),
      fix,
    });
    expect(outcome.ok).toBe(true);
    expect(fix).not.toHaveBeenCalled();
    expect(run.reviewRounds).toBeUndefined();
  });

  it("fixes, validates and re-reviews until the reviewer passes", async () => {
    const run = newRun();
    const steps: PairReviewStep[] = [];
    const reviews = [reviewOf([mustFix("A"), mustFix("B")], "/r0.json"), reviewOf([mustFix("B")], "/r1.json"), reviewOf([], "/r2.json")];
    const fix = vi.fn(async () => ({ ok: true as const }));
    const validate = vi.fn(async () => ({ valid: true }));

    const outcome = await runPairReviewRounds({
      run,
      rounds: 3,
      review: async (step) => {
        steps.push(step);
        return reviews.shift()!;
      },
      fix,
      validate,
    });

    expect(outcome.ok).toBe(true);
    expect(fix).toHaveBeenCalledTimes(2);
    expect(validate).toHaveBeenCalledTimes(2);
    expect(steps.map((s) => [s.round, s.final])).toEqual([[0, false], [1, false], [2, false]]);
    expect(steps[1]!.priorReports).toEqual(["/r0.json"]);
    expect(steps[2]!.priorReports).toEqual(["/r0.json", "/r1.json"]);
    expect(steps[1]!.recheck?.mustFix.map((f) => f.title)).toEqual(["A", "B"]);
    expect(run.reviewRounds).toEqual([
      { round: 1, findingsIn: 2, findingsFixed: 1, remaining: 1, verdict: "must-fix", reportPath: "/r1.json" },
      { round: 2, findingsIn: 1, findingsFixed: 1, remaining: 0, verdict: "pass", reportPath: "/r2.json" },
    ]);
  });

  it("marks only the review after the last fix round as final, and fails when must-fix remains", async () => {
    const run = newRun();
    const steps: PairReviewStep[] = [];
    const fix = vi.fn(async () => ({ ok: true as const }));

    const outcome = await runPairReviewRounds({
      run,
      rounds: 2,
      review: async (step) => {
        steps.push(step);
        return reviewOf([mustFix("A")], `/r${step.round}.json`);
      },
      fix,
    });

    expect(fix).toHaveBeenCalledTimes(2);
    expect(steps.map((s) => s.final)).toEqual([false, false, true]);
    expect(outcome).toMatchObject({ ok: false, reason: "must-fix-unresolved" });
    expect(run.review).toEqual({
      failed: "must-fix-unresolved",
      detail: "1 must-fix finding(s) still open after 2 fix round(s).",
      reportPath: "/r2.json",
    });
  });

  it("stops at the configured number of rounds", async () => {
    const fix = vi.fn(async () => ({ ok: true as const }));
    await runPairReviewRounds({ run: newRun(), rounds: 1, review: async () => reviewOf([mustFix("A")]), fix });
    expect(fix).toHaveBeenCalledTimes(1);
  });

  it("fails without a re-review when the fix session cannot run", async () => {
    const run = newRun();
    const review = vi.fn(async () => reviewOf([mustFix("A")]));

    const outcome = await runPairReviewRounds({
      run,
      rounds: 2,
      review,
      fix: async () => ({ ok: false, detail: "spawn failed" }),
    });

    expect(review).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ ok: false, reason: "must-fix-unresolved" });
    expect(run.reviewRounds).toMatchObject([{ round: 1, verdict: "executor-failed" }]);
  });

  it("fails without a re-review when the fix breaks the task's tests", async () => {
    const run = newRun();
    const review = vi.fn(async () => reviewOf([mustFix("A")]));

    const outcome = await runPairReviewRounds({
      run,
      rounds: 2,
      review,
      fix: async () => ({ ok: true }),
      validate: async () => ({ valid: false, reason: "Tests failed: boom" }),
    });

    expect(review).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ ok: false, reason: "must-fix-unresolved" });
    expect(run.review).toMatchObject({ failed: "must-fix-unresolved", detail: expect.stringContaining("Tests failed: boom") });
    expect(run.reviewRounds).toMatchObject([{ round: 1, verdict: "validation-failed" }]);
  });

  it("returns the reviewer's own failure when the re-review writes no report", async () => {
    const run = newRun();
    let calls = 0;
    const outcome = await runPairReviewRounds({
      run,
      rounds: 2,
      review: async () =>
        calls++ === 0
          ? reviewOf([mustFix("A")])
          : { outcome: { ok: false, reason: "no-report", detail: "no report" }, reportPath: "/r1.json" },
      fix: async () => ({ ok: true }),
    });
    expect(outcome).toMatchObject({ ok: false, reason: "no-report" });
    expect(run.reviewRounds).toMatchObject([{ round: 1, verdict: "reviewer-failed" }]);
  });

  it("returns a failed first review unchanged", async () => {
    const fix = vi.fn();
    const outcome = await runPairReviewRounds({
      run: newRun(),
      rounds: 2,
      review: async () => ({ outcome: { ok: false, reason: "spawn-failed", detail: "gone" }, reportPath: "/r0.json" }),
      fix,
    });
    expect(outcome).toMatchObject({ ok: false, reason: "spawn-failed" });
    expect(fix).not.toHaveBeenCalled();
  });
});
