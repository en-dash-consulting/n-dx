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

/**
 * Whether a process with this pid exists. EPERM means it exists but belongs
 * to someone else, so it counts as alive. Mirrors hench's canonical probe in
 * `packages/hench/src/process/run-liveness.ts` — keep the two identical.
 */
export function isPidAlive(pid: number, platform: NodeJS.Platform = process.platform): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  // Windows process ids are multiples of 4, and OpenProcess ignores a pid's
  // low two bits, so kill(4242, 0) probes process 4240 and can succeed (or
  // fail with EPERM) when no process 4242 exists. Such a pid cannot be live.
  if (platform === "win32" && pid % 4 !== 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

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
