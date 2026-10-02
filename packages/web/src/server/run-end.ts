/**
 * The one terminal shape for a run the dashboard ends — by reconciliation
 * (`POST /api/hench/runs/reconcile`) or by Mark stuck
 * (`POST /api/hench/runs/:id/mark-stuck`).
 *
 * Both set `status: "failed"`, `finishedAt`, and an `error` that starts with
 * {@link RUN_END_ERROR_PREFIX} followed by the surface's own reason, so the
 * record says how it ended whichever surface did it.
 *
 * @module web/server/run-end
 */

import { randomUUID } from "node:crypto";
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Leads the `error` of every run the dashboard ends. Adopted from #484. */
export const RUN_END_ERROR_PREFIX = "Ended by audit reconciliation";

/** The reason Mark stuck records after {@link RUN_END_ERROR_PREFIX}. */
export const MARK_STUCK_REASON = "Marked stuck from the dashboard (no recent activity).";

/** `<prefix>: <reason>` — the `error` an ended run carries. */
export function runEndError(reason: string): string {
  return `${RUN_END_ERROR_PREFIX}: ${reason}`;
}

/** A copy of `run` in the terminal shape. Every other field is kept. */
export function endedRunRecord(
  run: Record<string, unknown>,
  reason: string,
  now: number = Date.now(),
): Record<string, unknown> {
  return {
    ...run,
    status: "failed",
    finishedAt: new Date(now).toISOString(),
    error: runEndError(reason),
  };
}

/**
 * Write `<runsDir>/<id>.json` atomically: a temp file in the same directory,
 * then a rename, so a reader (hench, a watcher, another dashboard) never sees
 * a half-written record. The temp name does not end in `.json`, so run-file
 * watchers ignore it.
 */
export function writeRunFileAtomic(runsDir: string, id: string, run: Record<string, unknown>): void {
  const target = join(runsDir, `${id}.json`);
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(run, null, 2) + "\n", "utf-8");
    renameSync(tmp, target);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}
