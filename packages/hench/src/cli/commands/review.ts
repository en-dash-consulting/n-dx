/**
 * `hench review` — inspect what an adversarial review pass left behind.
 *
 * Today it has one subcommand, `pending`, which lists the findings a
 * reviewed run parked instead of dropping — autonomous or attended, since the
 * reviewer is headless either way. The command exists because the
 * review pass's own output is mid-run: by the time a `--loop` batch finishes,
 * the findings from run three are several test gates and two commit prompts up
 * the scrollback, and before the deferral mechanism they existed nowhere else
 * at all.
 *
 * Read-only by design. Capturing a finding into the PRD is a decision with a
 * parent, a level, and a duplicate check behind it — the `/ndx-adversarial-review`
 * skill already owns that judgement, and a `--capture-all` flag here would be a
 * second, worse copy of it that writes PRD items without ever asking what they
 * belong under.
 *
 * @module hench/cli/commands/review
 */

import { join } from "node:path";

import { loadRun } from "../../store/runs.js";
import { resolveHenchPaths } from "../../store/paths.js";
import { CLIError } from "../errors.js";
import { result } from "../output.js";
import {
  readReviewReport,
  reviewReportPath,
  deferredFindings,
  formatDeferredFindings,
} from "../../agent/analysis/adversarial-review.js";

/** Subcommands `hench review` understands. */
const REVIEW_SUBCOMMANDS = ["pending"] as const;

export async function cmdReview(
  dir: string,
  positional: string[],
  flags: Record<string, string>,
): Promise<void> {
  const [subcommand, runId] = positional;

  if (!subcommand) {
    throw new CLIError(
      "Missing subcommand.",
      `Usage: hench review pending <run-id> [dir]`,
    );
  }
  if (!(REVIEW_SUBCOMMANDS as readonly string[]).includes(subcommand)) {
    throw new CLIError(
      `Unknown review subcommand: ${subcommand}`,
      `Known subcommands: ${REVIEW_SUBCOMMANDS.join(", ")}`,
    );
  }
  if (!runId) {
    throw new CLIError(
      "Missing run ID.",
      "Usage: hench review pending <run-id> [dir]\nRun 'hench status' to list recent runs.",
    );
  }

  await cmdReviewPending(dir, runId, flags);
}

async function cmdReviewPending(
  dir: string,
  runId: string,
  flags: Record<string, string>,
): Promise<void> {
  const henchDir = resolveHenchPaths(dir).henchDir;
  const run = await loadRun(henchDir, runId);

  // Three states that must not be confused, because only one of them means
  // "nothing to capture": the run was never reviewed, the reviewer failed, and
  // the reviewer ran clean. Reporting all three as an empty list would let a
  // review that never happened read as a review that found nothing — the exact
  // ambiguity `--review` exists to remove.
  if (!run.review) {
    throw new CLIError(
      `Run ${run.id} was not reviewed.`,
      "Only runs started with --review have findings to defer.",
    );
  }
  // A failed review that kept its report (a pair review that ended with must-fix
  // findings open) still has findings to list.
  if (run.review.failed !== undefined && !run.review.reportPath) {
    throw new CLIError(
      `Run ${run.id} has no review report (${run.review.failed}).`,
      run.review.detail,
    );
  }

  // Resolve from the project in hand first, and use the path the run recorded
  // only when nothing is there.
  //
  // The preference used to run the other way, on the reasoning that a stored
  // path protects a project that has moved on disk. It does the opposite:
  // `reportPath` is absolute, so a move is precisely the case where it is
  // stale, and the command failed with "Could not read the review report" for
  // a report sitting in the new `.hench/reviews/` under its own name. Reports
  // are keyed by run id in a fixed subdirectory, so the canonical location is
  // derivable wherever the project now lives.
  //
  // The stored path is still worth a fallback: it is the only way to find a
  // report a future layout or an operator moved somewhere else, and it costs
  // one `readFile` on a path that was going to be read anyway.
  const canonicalPath = reviewReportPath(henchDir, run.id);
  let reportPath = canonicalPath;
  let outcome = await readReviewReport(reportPath);
  if (!outcome.ok && run.review.reportPath && run.review.reportPath !== canonicalPath) {
    const stored = await readReviewReport(run.review.reportPath);
    if (stored.ok) {
      reportPath = run.review.reportPath;
      outcome = stored;
    }
  }

  if (!outcome.ok) {
    throw new CLIError(
      `Could not read the review report for run ${run.id}.`,
      outcome.detail,
    );
  }

  const deferred = deferredFindings(outcome.report);

  if (flags.format === "json") {
    result(
      JSON.stringify(
        {
          runId: run.id,
          taskId: run.taskId,
          reportPath,
          deferred: deferred.map(({ id, finding }) => ({ id, ...finding })),
        },
        null,
        2,
      ),
    );
    return;
  }

  for (const line of formatDeferredFindings(run.id, reportPath, deferred)) result(line);
}
