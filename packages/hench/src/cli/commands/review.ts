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
import { HENCH_DIR } from "./constants.js";
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
  const henchDir = join(dir, HENCH_DIR);
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
  if (run.review.failed !== undefined) {
    throw new CLIError(
      `Run ${run.id} has no review report (${run.review.failed}).`,
      run.review.detail,
    );
  }

  // TODO(prd 77a603ad-sibling c7585f76, PR C follow-up): this preference is
  // backwards. The stored reportPath is absolute, so after a project moves on
  // disk it is exactly the stale path — the comment below claims the opposite
  // of what the code does. Resolve from the current project's
  // .hench/reviews/ (reviewReportPath) first and fall back to the stored
  // reportPath only when that file is absent; fix this comment and add a
  // moved-project unit test when picking it up.
  //
  // Prefer the path the run recorded: a project moved on disk since the run
  // would otherwise be told its findings are gone when they are merely
  // somewhere else. Fall back to the canonical location for a record written
  // before the path was stored.
  const reportPath = run.review.reportPath || reviewReportPath(henchDir, run.id);

  const outcome = await readReviewReport(reportPath);
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
