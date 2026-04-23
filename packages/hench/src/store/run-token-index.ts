/**
 * Run → PRD-item token join helper.
 *
 * Reads persisted run records under `.hench/runs/` and projects each one
 * into a compact `{ itemId, tokens }` tuple suitable for PRD rollup
 * (task → feature → epic token totals).
 *
 * ## Why this exists
 *
 * Run files already stamp the target PRD item ID at `RunRecord.taskId` and
 * an aggregated token total at `RunRecord.tokens` (written by `saveRun`).
 * Consumers that want to roll usage up the PRD tree previously had to open
 * every run file, re-derive the token total from `tokenUsage`, and re-parse
 * the full transcript (tool calls, events, etc.) on every query. This
 * module reads only the compact fields needed for the join, leaving the
 * transcript untouched.
 *
 * ## Completion semantics
 *
 * "Completed" here means "reached a terminal state" — `completed`,
 * `failed`, `timeout`, `budget_exceeded`, `error_transient`, and
 * `cancelled`. Only `running` runs are excluded, so rollups never
 * silently undercount aborted or failed work.
 *
 * @module hench/store/run-token-index
 */

import { normalizeRunTokens } from "../schema/index.js";
import type { RunRecord, RunStatus, RunTokens } from "../schema/index.js";
import { listRuns } from "./runs.js";

/**
 * Compact `{ itemId, tokens }` projection of a run record, with a couple of
 * identifying fields (`runId`, `status`, `finishedAt`) so callers can
 * dedupe, filter, or sort without re-opening the run file.
 */
export interface RunTokenTuple {
  /** The run's unique ID (filename stem under `.hench/runs/`). */
  runId: string;
  /** The rex PRD item ID the run executed against (task or subtask). */
  itemId: string;
  /** Normalized token totals suitable for rollup. */
  tokens: RunTokens;
  /** Terminal run status (never "running" in the returned list). */
  status: RunStatus;
  /** ISO timestamp when the run finished (undefined if never set). */
  finishedAt?: string;
}

/**
 * Project a single run record into the compact tuple shape.
 *
 * Falls back to computing `tokens` from `tokenUsage` on the fly when the
 * record is a legacy file written before `saveRun` started stamping
 * `tokens` automatically.
 */
export function runTokenTupleFromRecord(run: RunRecord): RunTokenTuple {
  return {
    runId: run.id,
    itemId: run.taskId,
    tokens: run.tokens ?? normalizeRunTokens(run.tokenUsage),
    status: run.status,
    finishedAt: run.finishedAt,
  };
}

/**
 * Return a `{ itemId, tokens }` tuple for every terminal-state run under
 * `.hench/runs/`.
 *
 * Excludes runs still in the `running` state (their totals are provisional).
 * Includes failed, aborted, timed-out, and budget-exceeded runs so that
 * rollups reflect all tokens actually consumed against the PRD item.
 *
 * Reads only the structured run JSON — no transcript re-parsing.
 */
export async function listCompletedRunTokens(
  henchDir: string,
): Promise<RunTokenTuple[]> {
  const runs = await listRuns(henchDir);
  return runs.filter(isTerminal).map(runTokenTupleFromRecord);
}

function isTerminal(run: RunRecord): boolean {
  return run.status !== "running";
}
