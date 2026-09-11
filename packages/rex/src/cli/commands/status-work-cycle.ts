/**
 * "Last work cycle" section of `rex status` (and therefore `ndx status`).
 *
 * Answers what the most recent `ndx work` / `--auto` / `--loop` invocation
 * actually did — which tasks completed, which failed (and how), which were
 * skipped — without the operator digging through `.hench/runs/` JSON or
 * `.run-logs/`.
 *
 * ## Source of truth
 *
 * Hench already persists one JSON record per run under `.hench/runs/`, so the
 * cycle is derived from those files and history survives across sessions with
 * no new state. The files are read as DATA — no import from hench — following
 * the precedent in `core/token-usage.ts` and `core/item-token-rollup.ts`.
 *
 * ## What a "cycle" is
 *
 * Run records carry no batch identifier, so a cycle is reconstructed from
 * timing: runs belong to the same cycle while the gap between one run's start
 * and the previous run's end (its start when it never finished) stays within
 * {@link DEFAULT_CYCLE_GAP_MS}. Loop pauses are seconds; separate invocations
 * are usually hours apart. The gap is measured from the previous run's FINISH
 * because a loop iteration follows the end of the run before it — a 20-minute
 * run with a 5-minute pause is one cycle even though the starts are 25 minutes
 * apart.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PROJECT_DIRS, green, red, yellow, dim } from "@n-dx/llm-client";
import { result } from "../output.js";
import { formatTimestamp } from "./status-shared.js";

/** The slice of a hench run record this section needs. */
export interface WorkCycleRun {
  id: string;
  status: string;
  taskId?: string;
  taskTitle: string;
  startedAt: string;
  finishedAt?: string;
}

/** Buckets of the latest cycle, in the order the section renders them. */
export interface WorkCycleSummary {
  completed: WorkCycleRun[];
  failed: WorkCycleRun[];
  skipped: WorkCycleRun[];
  running: WorkCycleRun[];
}

/** A new cycle starts when runs are further apart than this (finish → start). */
const DEFAULT_CYCLE_GAP_MS = 30 * 60_000;

/** Run statuses that count as failures, with the label shown for each. */
const FAILURE_LABELS: Readonly<Record<string, string>> = {
  failed: "",
  timeout: "timeout",
  budget_exceeded: "budget exceeded",
  error_transient: "transient error",
};

/**
 * Read `.hench/runs/*.json` into the minimal run shape, tolerantly: malformed
 * files, non-run JSON, and records without a `startedAt` (unplaceable in a
 * cycle) are skipped. A missing runs directory is an empty history.
 */
export async function readHenchRuns(projectDir: string): Promise<WorkCycleRun[]> {
  const runsDir = join(projectDir, PROJECT_DIRS.HENCH, "runs");

  let files: string[];
  try {
    files = await readdir(runsDir);
  } catch {
    return [];
  }

  const runs: WorkCycleRun[] = [];
  for (const file of files) {
    if (!file.endsWith(".json") || file.startsWith(".")) continue;
    try {
      const raw = await readFile(join(runsDir, file), "utf-8");
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (
        typeof data.status !== "string" ||
        typeof data.taskTitle !== "string" ||
        typeof data.startedAt !== "string"
      ) {
        continue;
      }
      runs.push({
        id: typeof data.id === "string" ? data.id : file.replace(/\.json$/, ""),
        status: data.status,
        taskId: typeof data.taskId === "string" ? data.taskId : undefined,
        taskTitle: data.taskTitle,
        startedAt: data.startedAt,
        finishedAt: typeof data.finishedAt === "string" ? data.finishedAt : undefined,
      });
    } catch {
      // Malformed or vanished mid-read — not this section's problem.
    }
  }
  return runs;
}

/**
 * The most recent cluster of runs, sorted by start time ascending.
 * See the module docs for how the cluster boundary is defined.
 */
export function selectLatestCycle(
  runs: WorkCycleRun[],
  gapMs: number = DEFAULT_CYCLE_GAP_MS,
): WorkCycleRun[] {
  const sorted = [...runs].sort(
    (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
  );

  const cycle: WorkCycleRun[] = [];
  for (const run of sorted) {
    const prev = cycle[cycle.length - 1];
    if (prev) {
      const prevEnd = Date.parse(prev.finishedAt ?? prev.startedAt);
      if (Date.parse(run.startedAt) - prevEnd > gapMs) {
        cycle.length = 0; // A larger gap — everything before it is an older cycle.
      }
    }
    cycle.push(run);
  }
  return cycle;
}

/** Bucket a cycle's runs by outcome. Unknown statuses are ignored. */
export function summarizeCycle(cycle: WorkCycleRun[]): WorkCycleSummary {
  const summary: WorkCycleSummary = { completed: [], failed: [], skipped: [], running: [] };
  for (const run of cycle) {
    if (run.status === "completed") summary.completed.push(run);
    else if (run.status in FAILURE_LABELS) summary.failed.push(run);
    else if (run.status === "cancelled") summary.skipped.push(run);
    else if (run.status === "running") summary.running.push(run);
  }
  return summary;
}

/** `✗ Title (timeout)` — the reason suffix only where the status carries one. */
function failureLine(run: WorkCycleRun): string {
  const label = FAILURE_LABELS[run.status];
  return `  ${red("✗")} ${run.taskTitle}${label ? dim(` (${label})`) : ""}`;
}

/**
 * Render the latest work cycle. Silent when there is no run history — a
 * project that has never run `ndx work` should not grow an empty section.
 *
 * @param emit Output sink; defaults to the CLI's `result`. Injectable so the
 *   section is testable without capturing stdout.
 */
export async function renderWorkCycleSection(
  projectDir: string,
  emit: (line: string) => void = result,
): Promise<void> {
  const runs = await readHenchRuns(projectDir);
  if (runs.length === 0) return;

  const cycle = selectLatestCycle(runs);
  const summary = summarizeCycle(cycle);
  const shown =
    summary.completed.length + summary.failed.length +
    summary.skipped.length + summary.running.length;
  if (shown === 0) return;

  emit("");
  emit(`Last work cycle (${formatTimestamp(cycle[0].startedAt)}):`);

  for (const run of summary.completed) emit(`  ${green("✓")} ${run.taskTitle}`);
  for (const run of summary.failed) emit(failureLine(run));
  for (const run of summary.skipped) emit(`  ${dim("○")} ${run.taskTitle} ${dim("(skipped)")}`);
  for (const run of summary.running) emit(`  ${yellow("⋯")} ${run.taskTitle} ${yellow("(running)")}`);

  const counts = [
    `${summary.completed.length} completed`,
    `${summary.failed.length} failed`,
    `${summary.skipped.length} skipped`,
    ...(summary.running.length > 0 ? [`${summary.running.length} running`] : []),
  ].join(" · ");
  emit(dim(`  ${counts}`));
}
