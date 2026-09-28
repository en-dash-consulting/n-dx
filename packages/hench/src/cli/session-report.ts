/**
 * One-line rendering of a run's session-cache decision.
 *
 * Lives beside `token-logging.ts` rather than in
 * `agent/lifecycle/session-cache.ts` for the same reason that module has no
 * `detail()` import: the cache decides, it does not narrate. Both `hench show`
 * and the end-of-run summary print this, so the prose for a reason is written
 * once — two copies would drift the moment a rejection code is renamed on one
 * side only.
 *
 * @module hench/cli/session-report
 */

import type { RunSessionRecord } from "../schema/index.js";

/**
 * Prose for the reasons the cache and the loop actually emit.
 *
 * Deliberately a lookup with a fallback rather than an exhaustive map over a
 * union: {@link RunSessionRecord.reason} is a bare string precisely so a run
 * file naming a reason this build has never heard of still loads, and the
 * display has to hold the same line — an unknown reason is printed verbatim,
 * which is more use to a reader than "unknown".
 */
const REASON_PROSE: Record<string, string> = {
  // Hits
  cached: "reused the cached orientation",
  "chain-continued": "continued the running batch chain",

  // Cold
  "configured-cold": "cold spawns are configured",
  "fork-unsupported": "this vendor cannot resume a session by id",
  "not-consulted": "no cache was consulted",

  // Parent misses
  "no-entry": "nothing was cached",
  "fresh-requested": "--fresh was passed",
  "sourcevision-changed": "the analysis changed since it was built",
  "vendor-changed": "the vendor changed",
  "model-changed": "the model changed",
  expired: "it was past its maximum age",
  malformed: "the cache entry was unreadable",

  // Batch-chain misses
  "no-chain": "no chain was running",
  disabled: "batching is disabled (tasksPerSession ≤ 1)",
  unversioned: "the chain predates the current cache scheme",
  "version-changed": "the chain was written by a different cache scheme",
  "worktree-changed": "the chain belongs to another worktree",
  "ref-changed": "the chain was opened on another branch",
  "policy-changed": "the execution policy changed",
  idle: "the chain sat idle too long",
  "cap-reached": "the chain had served its full task allowance",
};

/** `3720000` → `"1h 2m"`. Whole units only — this is a diagnostic, not a clock. */
function formatAge(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return "under a minute";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/**
 * Render the decision as one line, e.g.
 * `Session: fork hit — reused the cached orientation (age 2h 14m)`.
 *
 * The strategy and the outcome are both named even when they seem redundant.
 * "cold miss" looks like it says nothing twice, but a cold run and a fork run
 * that missed are different facts, and the reason that follows only makes
 * sense against the strategy that produced it.
 */
export function formatSessionDecision(session: RunSessionRecord): string {
  const prose = REASON_PROSE[session.reason] ?? session.reason;
  const age = session.ageMs === undefined ? "" : ` (age ${formatAge(session.ageMs)})`;
  return `Session: ${session.strategy} ${session.outcome} — ${prose}${age}`;
}
