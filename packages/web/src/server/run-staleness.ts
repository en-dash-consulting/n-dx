/**
 * When a `running` hench run counts as stale.
 *
 * One rule, read by every surface that counts stuck runs — the bottom bar
 * (`GET /api/status`), the runs health check and audit (`routes-hench.ts`)
 * and the Live overview (`GET /api/live`) — so their counts agree for the
 * same moment. Each used to carry its own copy of the threshold.
 *
 * @module web/server/run-staleness
 */

/** A running run whose last heartbeat is older than this is stale. */
export const RUN_STALE_THRESHOLD_MS = 5 * 60 * 1000;

/** Milliseconds since `lastActivityAt`, or null when the run recorded none. */
export function heartbeatAgeMs(lastActivityAt: unknown, now: number): number | null {
  if (typeof lastActivityAt !== "string" || lastActivityAt.length === 0) return null;
  return now - new Date(lastActivityAt).getTime();
}

/**
 * Whether a run still marked `running` has gone quiet. A run with no
 * `lastActivityAt` at all is a legacy record left running, so it is stale.
 */
export function isRunStale(lastActivityAt: unknown, now: number): boolean {
  const age = heartbeatAgeMs(lastActivityAt, now);
  return age === null ? true : age > RUN_STALE_THRESHOLD_MS;
}
