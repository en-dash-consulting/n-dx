/**
 * Which tasks `ndx work --auto` skips as stuck.
 *
 * Mirrors hench's `loadStuckTaskIds` / `getStuckTaskIds`
 * (packages/hench/src/cli/commands/run.ts, agent/analysis/stuck.ts): a task is
 * stuck once its most recent runs, newest first, are `maxFailedAttempts`
 * consecutive hard failures. Web does not import hench, so the rule is restated
 * here; the tests pin it against the same cases.
 *
 * @module web/server/stuck-tasks
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

/** hench's default `maxFailedAttempts`. */
export const DEFAULT_MAX_FAILED_ATTEMPTS = 3;

/** Statuses hench counts as a hard failure; rate limits and network blips do not count. */
const FAILURE_STATUSES = new Set(["failed", "timeout", "budget_exceeded"]);

interface RunLike {
  taskId?: unknown;
  status?: unknown;
  review?: { failed?: unknown; gated?: unknown };
}

/** A run refused only by the missing-review gate says nothing about the task: hench skips it. */
function isReviewGateRefusal(run: RunLike): boolean {
  return run.review !== undefined && run.review.failed !== undefined && run.review.gated === true;
}

/**
 * Task ids with at least `threshold` consecutive hard failures.
 *
 * @param runsNewestFirst Run records, newest first
 * @param threshold `maxFailedAttempts`; 0 or less disables stuck detection
 */
export function stuckTaskIdsFromRuns(runsNewestFirst: readonly RunLike[], threshold: number): Set<string> {
  const stuck = new Set<string>();
  if (threshold <= 0) return stuck;
  const streak = new Map<string, number>();
  const ended = new Set<string>();
  for (const run of runsNewestFirst) {
    if (typeof run.taskId !== "string" || ended.has(run.taskId)) continue;
    if (isReviewGateRefusal(run)) continue;
    if (typeof run.status === "string" && FAILURE_STATUSES.has(run.status)) {
      const count = (streak.get(run.taskId) ?? 0) + 1;
      streak.set(run.taskId, count);
      if (count >= threshold) stuck.add(run.taskId);
    } else {
      ended.add(run.taskId);
    }
  }
  return stuck;
}

/** `maxFailedAttempts` from a hench config object, or hench's default when absent or invalid. */
export function maxFailedAttemptsOf(config: Record<string, unknown> | null): number {
  const value = config?.maxFailedAttempts;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : DEFAULT_MAX_FAILED_ATTEMPTS;
}

async function readRunFile(path: string): Promise<RunLike> {
  const raw = await readFile(path);
  return JSON.parse((path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf-8")) as RunLike;
}

/** Read `<runsDir>` (newest first, by run id as hench does) and return the stuck task ids. */
export async function loadStuckTaskIds(runsDir: string, threshold: number): Promise<Set<string>> {
  if (threshold <= 0) return new Set();
  let files: string[];
  try {
    files = await readdir(runsDir);
  } catch {
    return new Set();
  }
  // One file per run id, newest first by id (as hench's listRuns orders them); `.json` wins over `.json.gz`.
  const byId = new Map<string, string>();
  for (const name of files.filter((f) => !f.startsWith(".") && /\.json(\.gz)?$/.test(f)).sort()) {
    byId.set(name.replace(/\.json(\.gz)?$/, ""), name);
  }
  const newestFirst = [...byId.entries()].sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0)).map(([, name]) => name);
  // A file that cannot be read or parsed is not a run record; hench's listRuns drops it too.
  const settled = await Promise.allSettled(newestFirst.map((name) => readRunFile(join(runsDir, name))));
  const runs = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  return stuckTaskIdsFromRuns(runs, threshold);
}
