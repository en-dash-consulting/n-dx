/**
 * CLI command: audit which runs recorded as "running" are actually running,
 * in every worktree of the repository.
 *
 * Usage:
 *   hench check-runs [--fix] [--include-unknown] [--strict]
 *                    [--worktree=<path>] [--format=json] [dir]
 *
 * A run file stays `status: "running"` until the process that owns it writes a
 * terminal status. A crash, a Ctrl-C, a restart or a `kill -9` never gets that
 * far, so the file says "running" for good. Elapsed time cannot tell those
 * apart from a genuinely long run; the verdict comes from the recorded pid
 * first, then lock files (see {@link ../../process/run-liveness}).
 *
 * Each worktree keeps its own `.hench/`, so the audit reads every worktree's
 * runs and judges each against that worktree's own locks. Outside a git
 * repository it audits `dir` alone.
 *
 * Exit codes:
 *   0  audit completed (default, whatever it found)
 *   1  `--strict` and at least one running record is not live
 */

import { realpathSync } from "node:fs";
import { basename, resolve, sep } from "node:path";
import { listRuns, loadRun, saveRun } from "../../store/runs.js";
import { resolveHenchPaths } from "../../store/paths.js";
import { info, result } from "../output.js";
import { CLIError } from "../errors.js";
import { listWorktrees } from "../../prd/llm-gateway.js";
import {
  classifyRunLiveness,
  collectLiveLocks,
  locksDirOf,
  summarizeLiveness,
  type LivenessSummary,
  type LivenessVerdict,
  type RunLiveness,
} from "../../process/run-liveness.js";
import type { RunRecord } from "../../schema/index.js";

/**
 * Leads the `error` of every run this command ends. Identical to the
 * dashboard's `RUN_END_ERROR_PREFIX` (`web/src/server/run-end.ts`, which takes
 * no runtime dependency on hench), so either surface leaves the same trace.
 */
export const RUN_END_ERROR_PREFIX = "Ended by audit reconciliation";

interface CheckRunsFlags {
  fix?: string;
  "include-unknown"?: string;
  strict?: string;
  format?: string;
  worktree?: string;
}

interface WorktreeInfo {
  name: string;
  path: string;
  branch: string | null;
}

interface Audited {
  run: RunRecord;
  verdict: LivenessVerdict;
  ended: boolean;
}

interface WorktreeAudit {
  worktree: WorktreeInfo;
  henchDir: string;
  liveLocks: number;
  runs: Audited[];
}

const VERDICT_ICON: Record<RunLiveness, string> = {
  live: "[ok]",
  foreign: "[--]",
  unknown: "[??]",
  orphaned: "[!!]",
};

/** Order runs are printed in within a worktree. */
const VERDICT_ORDER: RunLiveness[] = ["orphaned", "unknown", "foreign", "live"];

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** Every worktree of the repository containing `dir`, or `dir` alone outside one. */
async function resolveWorktrees(dir: string): Promise<WorktreeInfo[]> {
  const listed = (await listWorktrees(dir)).filter((wt) => !wt.bare);
  if (listed.length === 0) {
    const root = canonical(dir);
    return [{ name: basename(root), path: root, branch: null }];
  }
  return listed.map((wt) => ({ name: basename(wt.path), path: wt.path, branch: wt.branch }));
}

/** Narrow to the worktree containing `--worktree=<path>`; the deepest match wins. */
function narrowToWorktree(all: WorktreeInfo[], requested: string): WorktreeInfo[] {
  const target = canonical(requested);
  const match = all
    .filter((wt) => target === wt.path || target.startsWith(wt.path + sep))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (!match) {
    throw new CLIError(
      `No worktree of this repository contains "${requested}".`,
      `Known worktrees: ${all.map((wt) => wt.path).join(", ")}`,
    );
  }
  return [match];
}

function judge(run: RunRecord, liveLocks: ReturnType<typeof collectLiveLocks>): LivenessVerdict {
  return classifyRunLiveness(
    {
      taskId: run.taskId,
      startedAt: run.startedAt,
      lastActivityAt: run.lastActivityAt,
      host: run.host,
      pid: run.pid,
    },
    { liveLocks },
  );
}

/**
 * End a run: re-read it and re-judge it first, so a run that finished or
 * reported in since the audit began is left alone.
 */
async function endRun(
  henchDir: string,
  id: string,
  endable: (v: LivenessVerdict) => boolean,
): Promise<boolean> {
  const fresh = await loadRun(henchDir, id);
  if (fresh.status !== "running") return false;
  const verdict = judge(fresh, collectLiveLocks(locksDirOf(henchDir)));
  if (!endable(verdict)) return false;
  fresh.status = "failed";
  fresh.error = `${RUN_END_ERROR_PREFIX}: ${verdict.reason}`;
  fresh.finishedAt = new Date().toISOString();
  await saveRun(henchDir, fresh);
  return true;
}

export async function cmdCheckRuns(
  dir: string,
  flags: CheckRunsFlags,
): Promise<void> {
  const fix = flags.fix === "true";
  const includeUnknown = flags["include-unknown"] === "true";
  const asJson = flags.format === "json";

  const endable = (v: LivenessVerdict): boolean =>
    v.canEnd || (includeUnknown && v.liveness === "unknown");

  let worktrees = await resolveWorktrees(dir);
  if (flags.worktree) worktrees = narrowToWorktree(worktrees, flags.worktree);

  const audits: WorktreeAudit[] = [];
  for (const worktree of worktrees) {
    const paths = resolveHenchPaths(worktree.path);
    // Every run, not a recent slice: an abandoned run can be arbitrarily old.
    const running = (await listRuns(paths.henchDir)).filter((r) => r.status === "running");
    const liveLocks = collectLiveLocks(paths.locksDir);
    const runs: Audited[] = [];
    for (const run of running) {
      const verdict = judge(run, liveLocks);
      const ended = fix && endable(verdict) && (await endRun(paths.henchDir, run.id, endable));
      runs.push({ run, verdict, ended });
    }
    audits.push({ worktree, henchDir: paths.henchDir, liveLocks: liveLocks.length, runs });
  }

  const all = audits.flatMap((a) => a.runs);
  const summary = summarizeLiveness(all.map((a) => a.verdict));
  const endedCount = all.filter((a) => a.ended).length;

  if (asJson) {
    result(JSON.stringify(jsonReport(audits, summary, fix, endedCount), null, 2));
  } else {
    printTextReport(audits, { fix, includeUnknown, endedCount, eligible: all.filter((a) => endable(a.verdict)).length });
  }

  // `--strict` fails on any running record not positively live (a foreign
  // record cannot be confirmed here, so it counts). Runs ended by `--fix` are
  // no longer "running", so they no longer count.
  if (flags.strict === "true") {
    const outstanding = summary.total - summary.live - endedCount;
    if (outstanding > 0) process.exitCode = 1;
  }
}

function jsonReport(
  audits: WorktreeAudit[],
  summary: LivenessSummary,
  fixed: boolean,
  ended: number,
): unknown {
  return {
    liveness: summary,
    fixed,
    ended,
    worktrees: audits.map(({ worktree, liveLocks, runs }) => ({
      ...worktree,
      liveLocks,
      runs: runs.map(({ run, verdict, ended: wasEnded }) => ({
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
        ended: wasEnded,
      })),
    })),
  };
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function printTextReport(
  audits: WorktreeAudit[],
  ctx: { fix: boolean; includeUnknown: boolean; endedCount: number; eligible: number },
): void {
  const total = audits.reduce((n, a) => n + a.runs.length, 0);
  if (total === 0) {
    result("No runs are recorded as running.");
    return;
  }

  info(`${plural(total, "run")} recorded as running across ${plural(audits.length, "worktree")}.\n`);

  for (const { worktree, runs, liveLocks } of audits) {
    if (runs.length === 0) continue;
    const branch = worktree.branch ? ` (${worktree.branch})` : "";
    result(`${worktree.name}${branch} — ${worktree.path}`);
    info(`  ${plural(liveLocks, "live hench process")} found.`);
    const sorted = [...runs].sort(
      (a, b) => VERDICT_ORDER.indexOf(a.verdict.liveness) - VERDICT_ORDER.indexOf(b.verdict.liveness),
    );
    for (const { run, verdict, ended } of sorted) {
      result(`  ${VERDICT_ICON[verdict.liveness]} ${run.id.slice(0, 8)}  ${verdict.liveness.padEnd(8)} ${run.taskTitle}${ended ? " — ended" : ""}`);
      info(`       ${verdict.reason}`);
    }
    info();
  }

  if (ctx.endedCount > 0) {
    result(`Ended ${plural(ctx.endedCount, "run")}.`);
    return;
  }
  if (ctx.eligible > 0 && !ctx.fix) {
    result(`${plural(ctx.eligible, "run")} can be closed out. Re-run with --fix to end ${ctx.eligible === 1 ? "it" : "them"}.`);
    return;
  }
  const unconfirmed = audits.reduce(
    (n, a) => n + a.runs.filter((r) => r.verdict.liveness === "unknown").length,
    0,
  );
  if (unconfirmed > 0 && !ctx.includeUnknown) {
    info("Pass --include-unknown to also end the runs that could not be confirmed.");
  }
}
