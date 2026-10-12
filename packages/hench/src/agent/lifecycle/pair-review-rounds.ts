/**
 * Pair review's fix rounds.
 *
 * A pair reviewer only reports. When its report holds must-fix findings, the
 * executor's own session is resumed with them, the task's tests re-run, and a
 * fresh reviewer checks the new diff against the previous round's findings.
 * That repeats for at most `hench.review.rounds` fix rounds; a must-fix finding
 * still open after the last one fails the review.
 *
 * This module is only the sequencing. Spawning the reviewer and the executor is
 * `cli-loop.ts`'s business and arrives as callbacks, which keeps the round
 * logic testable without a CLI and keeps `cli-loop.ts` from growing by it.
 *
 * @module hench/agent/lifecycle/pair-review-rounds
 */

import { classifyUnresolved, countFixedFindings } from "../analysis/adversarial-review.js";
import type { PairRecheck, ReviewFinding, ReviewPassOutcome } from "../analysis/adversarial-review.js";
import type { RunRecord, RunReviewRound } from "../../schema/index.js";
import { emitRunEvent } from "../../store/run-events.js";
import { info } from "../../types/output.js";

/** One review pass the loop asks for. */
export interface PairReviewStep {
  /** 0 for the first review, then the fix round that preceded this one. */
  round: number;
  /** Set on a re-review: what the executor was asked to fix. */
  recheck?: PairRecheck;
  /**
   * True on the last review the run will make: a must-fix finding it reports
   * is captured like any other, because no executor round follows it.
   */
  final: boolean;
  /** Reports from earlier steps, oldest first, to carry lesser findings forward from. */
  priorReports: readonly string[];
}

/** A review pass and where its report went. */
export interface PairReviewResult {
  outcome: ReviewPassOutcome;
  reportPath: string;
}

export interface PairReviewRoundsDeps {
  run: RunRecord;
  /** `hench.review.rounds`: fix rounds the executor gets. */
  rounds: number;
  /** Run a review pass. Records `run.review` itself, as a single pass does. */
  review: (step: PairReviewStep) => Promise<PairReviewResult>;
  /** Resume the executor to fix `findings`. `detail` says why it could not. */
  fix: (findings: readonly ReviewFinding[], round: number) => Promise<{ ok: true } | { ok: false; detail: string }>;
  /** Re-run the task's validation (its tests) after a fix. */
  validate?: () => Promise<{ valid: boolean; reason?: string }>;
}

function openMustFix(outcome: ReviewPassOutcome): ReviewFinding[] {
  return outcome.ok ? classifyUnresolved(outcome.report).unrepairedMustFix : [];
}

/**
 * Review, then fix and re-review until no must-fix finding is open or the
 * rounds run out. Records each round on `run.reviewRounds` as it happens and
 * leaves `run.review` describing the last review — or, when must-fix findings
 * are still open, the failure `finalizeRun` refuses completion on.
 */
export async function runPairReviewRounds(deps: PairReviewRoundsDeps): Promise<ReviewPassOutcome> {
  const { run, rounds } = deps;
  const reports: string[] = [];
  const records: RunReviewRound[] = [];

  let last = await deps.review({ round: 0, final: false, priorReports: [] });
  reports.push(last.reportPath);

  for (let round = 1; round <= rounds; round++) {
    const mustFix = openMustFix(last.outcome);
    if (mustFix.length === 0) break;

    const record: RunReviewRound = {
      round,
      findingsIn: mustFix.length,
      findingsFixed: 0,
      remaining: mustFix.length,
      verdict: "must-fix",
    };
    records.push(record);
    run.reviewRounds = records;

    info(`\nFix round ${round}/${rounds}: resuming the executor with ${mustFix.length} must-fix finding(s).`);
    emitRunEvent("review_report", `Fix round ${round}/${rounds}: ${mustFix.length} must-fix finding(s) to the executor`, {
      counts: { round, findings: mustFix.length },
    });

    const fixed = await deps.fix(mustFix, round);
    if (!fixed.ok) {
      record.verdict = "executor-failed";
      return unresolved(run, last.reportPath, `fix round ${round}: the executor could not run (${fixed.detail}).`, record.remaining);
    }

    const validation = await deps.validate?.();
    if (validation && !validation.valid) {
      record.verdict = "validation-failed";
      return unresolved(
        run,
        last.reportPath,
        `fix round ${round}: the task's tests failed after the fix (${validation.reason ?? "no reason given"}).`,
        record.remaining,
      );
    }

    last = await deps.review({
      round,
      recheck: { round, mustFix },
      final: round === rounds,
      priorReports: [...reports],
    });
    reports.push(last.reportPath);

    if (!last.outcome.ok) {
      // The pass has already recorded why on `run.review`.
      record.verdict = "reviewer-failed";
      return last.outcome;
    }
    const open = openMustFix(last.outcome);
    record.findingsFixed = countFixedFindings(mustFix, last.outcome.report.findings);
    record.remaining = open.length;
    record.verdict = open.length === 0 ? "pass" : "must-fix";
    record.reportPath = last.reportPath;
    info(`Fix round ${round}/${rounds}: ${record.findingsFixed} of ${mustFix.length} fixed, ${open.length} must-fix open.`);
  }

  const open = openMustFix(last.outcome);
  if (open.length > 0) {
    return unresolved(
      run,
      last.reportPath,
      `${open.length} must-fix finding(s) still open after ${records.length} fix round(s).`,
      open.length,
    );
  }
  return last.outcome;
}

/** Fail the review: record why on the run and say so. */
function unresolved(run: RunRecord, reportPath: string, detail: string, count: number): ReviewPassOutcome & { ok: false } {
  const failed: ReviewPassOutcome & { ok: false } = { ok: false, reason: "must-fix-unresolved", detail };
  run.review = { failed: failed.reason, detail, reportPath };
  info(`⚠ Pair review did not pass: ${detail}`);
  emitRunEvent("review_report", "Pair review did not pass", {
    ok: false,
    detail,
    counts: { unrepairedMustFix: count },
  });
  return failed;
}
