/**
 * CLI command: audit which runs recorded as "running" are actually running.
 *
 * Usage:
 *   hench check-runs [--fix] [--include-unknown] [--strict] [--format=json] [dir]
 *
 * A run file stays `status: "running"` until the process that owns it writes a
 * terminal status. A crash, a Ctrl-C, a machine restart or a `kill -9` never
 * gets that far, so the file says "running" for good and `hench status`, the
 * dashboard and every other active-work count keep reporting runs that nothing
 * is executing. Elapsed time cannot tell those apart from a genuinely long run.
 *
 * This command reaches a verdict from evidence — see
 * {@link ../../process/run-liveness} for the rules — and with `--fix` closes out
 * the ones no process could be running.
 *
 * Exit codes:
 *   0  audit completed (default, whatever it found)
 *   1  `--strict` and at least one run is not actually running
 */

import { listRuns } from "../../store/runs.js";
import { resolveHenchPaths } from "../../store/paths.js";
import { saveRun } from "../../store/runs.js";
import { info, result } from "../output.js";
import {
  classifyRunLiveness,
  collectLiveLocks,
  summarizeLiveness,
  locksDirOf,
  type LivenessVerdict,
  type RunLiveness,
} from "../../process/run-liveness.js";
import type { RunRecord } from "../../schema/index.js";

/**
 * Error recorded on a run this command ends.
 *
 * Matches the dashboard's `POST /api/hench/runs/reconcile`, so the same action
 * leaves the same trace whichever surface performed it.
 */
const RECONCILE_ERROR_PREFIX = "Ended by audit reconciliation";

interface CheckRunsFlags {
  fix?: string;
  "include-unknown"?: string;
  strict?: string;
  format?: string;
}

/** One run plus the verdict reached about it. */
interface Audited {
  run: RunRecord;
  verdict: LivenessVerdict;
}

/** Marker shown beside each verdict in text output. */
const VERDICT_ICON: Record<RunLiveness, string> = {
  live: "[ok]",
  foreign: "[--]",
  unknown: "[??]",
  orphaned: "[!!]",
};

/** Heading for each verdict group, in the order they are printed. */
const VERDICT_HEADING: Array<[RunLiveness, string]> = [
  ["orphaned", "Not running"],
  ["unknown", "Could not be confirmed"],
  ["foreign", "Recorded on another machine"],
  ["live", "Running"],
];

export async function cmdCheckRuns(
  dir: string,
  flags: CheckRunsFlags,
): Promise<void> {
  const henchDir = resolveHenchPaths(dir).henchDir;
  const fix = flags.fix === "true";
  const includeUnknown = flags["include-unknown"] === "true";
  const asJson = flags.format === "json";

  // Every run, not a recent slice: an abandoned run can be arbitrarily old and
  // is exactly what this command exists to find.
  const running = (await listRuns(henchDir)).filter((r) => r.status === "running");

  const liveLocks = collectLiveLocks(locksDirOf(henchDir));
  const audited: Audited[] = running.map((run) => ({
    run,
    verdict: classifyRunLiveness(
      {
        taskId: run.taskId,
        startedAt: run.startedAt,
        lastActivityAt: run.lastActivityAt,
        host: run.host,
      },
      { liveLocks, managedTaskIds: new Set<string>() },
    ),
  }));

  const eligible = audited.filter(
    ({ verdict }) =>
      verdict.canEnd || (includeUnknown && verdict.liveness === "unknown"),
  );

  const ended: string[] = [];
  if (fix) {
    for (const { run, verdict } of eligible) {
      run.status = "failed";
      run.error = `${RECONCILE_ERROR_PREFIX}: ${verdict.reason}`;
      run.finishedAt = new Date().toISOString();
      await saveRun(henchDir, run);
      ended.push(run.id);
    }
  }

  const summary = summarizeLiveness(audited.map((a) => a.verdict));

  if (asJson) {
    result(JSON.stringify({
      liveness: summary,
      liveLocks: liveLocks.length,
      fixed: fix,
      ended: ended.length,
      runs: audited.map(({ run, verdict }) => ({
        id: run.id,
        taskId: run.taskId,
        taskTitle: run.taskTitle,
        startedAt: run.startedAt,
        lastActivityAt: run.lastActivityAt,
        host: run.host,
        liveness: verdict.liveness,
        reason: verdict.reason,
        pid: verdict.pid,
        canEnd: verdict.canEnd,
        ended: ended.includes(run.id),
      })),
    }, null, 2));
  } else {
    printTextReport(audited, { liveLocks: liveLocks.length, ended, fix, includeUnknown, eligible: eligible.length });
  }

  // `--strict` fails on anything not positively confirmed running, so a CI job
  // or a pre-flight check catches a dirty runs directory. After `--fix` the
  // ended runs are no longer "running", so they no longer count against it.
  if (flags.strict === "true") {
    const outstanding = fix
      ? summary.orphaned + summary.unknown - ended.length
      : summary.orphaned + summary.unknown;
    if (outstanding > 0) {
      process.exitCode = 1;
    }
  }
}

function printTextReport(
  audited: Audited[],
  ctx: { liveLocks: number; ended: string[]; fix: boolean; includeUnknown: boolean; eligible: number },
): void {
  if (audited.length === 0) {
    result("No runs are recorded as running.");
    return;
  }

  info(
    `${audited.length} run${audited.length === 1 ? "" : "s"} recorded as running; ` +
    `${ctx.liveLocks} live hench process${ctx.liveLocks === 1 ? "" : "es"} found.\n`,
  );

  for (const [liveness, heading] of VERDICT_HEADING) {
    const group = audited.filter((a) => a.verdict.liveness === liveness);
    if (group.length === 0) continue;

    result(`${heading} (${group.length}):`);
    for (const { run, verdict } of group) {
      const endedMark = ctx.ended.includes(run.id) ? " — ended" : "";
      result(`  ${VERDICT_ICON[liveness]} ${run.id.slice(0, 8)}  ${run.taskTitle}${endedMark}`);
      info(`       ${verdict.reason}`);
    }
    info();
  }

  if (ctx.ended.length > 0) {
    result(`Ended ${ctx.ended.length} run${ctx.ended.length === 1 ? "" : "s"}.`);
    return;
  }

  if (ctx.eligible > 0) {
    // A finding, not a diagnostic — it goes to stdout with the rest of the
    // report, so piping the command somewhere does not drop its headline.
    result(
      `${ctx.eligible} run${ctx.eligible === 1 ? "" : "s"} can be closed out. ` +
      "Re-run with --fix to end them.",
    );
    return;
  }

  const unconfirmed = audited.filter((a) => a.verdict.liveness === "unknown").length;
  if (unconfirmed > 0 && !ctx.includeUnknown) {
    info("Pass --include-unknown to also end the runs that could not be confirmed.");
  }
}
