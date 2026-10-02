/**
 * Liveness verdict for runs recorded as `status: "running"`.
 *
 * A run file stays `"running"` until the process that owns it writes a terminal
 * status. A crash, a Ctrl-C, a reboot or a `kill -9` never gets that far, so
 * the file says "running" forever. Elapsed time alone cannot separate a long
 * run from an abandoned one; this module answers from evidence, in order:
 *
 * 1. The run's `host` differs from this machine → `foreign`. Local pids say
 *    nothing about it.
 * 2. The run's own `pid` (written at start, refreshed by every heartbeat):
 *    alive with a fresh heartbeat → `live`; alive with a heartbeat older than
 *    {@link RUN_STALE_THRESHOLD_MS} → `unknown` (hung, or the pid was reused);
 *    dead → `orphaned`.
 * 3. Records written before the pid field existed fall back to
 *    `.hench/locks/<pid>.lock` evidence: a live lock naming the task → `live`;
 *    untagged live locks started within {@link LOCK_ATTRIBUTION_WINDOW_MS} of
 *    the run → `unknown`; none → `orphaned`.
 *
 * Only `orphaned` is safe to end without asking.
 *
 * `packages/web/src/server/run-liveness.ts` mirrors this classifier (web takes
 * no runtime dependency on hench); `tests/e2e/run-liveness-parity.test.js`
 * requires identical verdicts. Change both together.
 *
 * Adapted from draft PR #484, with the run record's pid taking precedence over
 * lock files and EPERM counting as alive (see {@link isPidAlive}).
 *
 * @module hench/process/run-liveness
 */

import { readdirSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * A running run whose last heartbeat is older than this has stopped reporting.
 *
 * The same value as `RUN_STALE_THRESHOLD_MS` in
 * `packages/web/src/server/run-staleness.ts`, which every dashboard surface
 * reads; hench cannot import it (web depends on hench, not the reverse).
 */
export const RUN_STALE_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * How far apart a lock's `startedAt` and a run's `startedAt` may be before the
 * lock is ruled out as that run's owner.
 *
 * `hench run` acquires its lock immediately before recording the run, so the
 * two timestamps are seconds apart in practice. Locks are only optionally
 * tagged with a task id, so an untagged live lock has to be matched by start
 * time or not at all. Without this window one live hench process would make
 * every abandoned run on disk unattributable.
 */
export const LOCK_ATTRIBUTION_WINDOW_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Verdict on whether a run recorded as "running" is actually executing. */
export type RunLiveness = "live" | "foreign" | "unknown" | "orphaned";

/**
 * A `.hench/locks/<pid>.lock` entry held by a process that is still alive.
 *
 * Mirrors `LockFileData` in {@link ./limiter}.
 */
export interface LiveLock {
  pid: number;
  startedAt: string;
  /** Present only when the run named its task up front (not for `--auto` runs). */
  taskId?: string;
}

/** The subset of a run record this module reads. */
export interface RunLivenessInput {
  taskId?: string;
  startedAt?: string;
  lastActivityAt?: string;
  /** Hostname recorded by the process that started the run. */
  host?: string;
  /** Pid of the hench process driving the run; absent on older records. */
  pid?: number;
}

/** Everything needed to judge a run, gathered once per sweep. */
export interface LivenessContext {
  /** Locks whose pid is still alive, from {@link collectLiveLocks}. */
  liveLocks: readonly LiveLock[];
  /** This machine's hostname. Defaults to `os.hostname()`. */
  host?: string;
  /** Clock. Defaults to `Date.now()`. */
  now?: number;
  /** Pid probe. Defaults to {@link isPidAlive}. */
  isPidAlive?: (pid: number) => boolean;
}

/** The judgment on one run. */
export interface LivenessVerdict {
  liveness: RunLiveness;
  /** Human-readable justification, shown verbatim by the CLI and the dashboard. */
  reason: string;
  /** The pid executing this run, when one could be identified. */
  pid: number | null;
  /** Whether ending this run is safe without further confirmation. */
  canEnd: boolean;
}

/** Counts by verdict. */
export interface LivenessSummary {
  total: number;
  live: number;
  foreign: number;
  unknown: number;
  orphaned: number;
}

// ---------------------------------------------------------------------------
// Pid liveness
// ---------------------------------------------------------------------------

/**
 * Whether a process with this pid exists. EPERM means it exists but belongs
 * to someone else, so it counts as alive — matching
 * `packages/web/src/server/run-staleness.ts`.
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Read a locks directory and return the locks whose owning process is alive.
 *
 * A missing directory, an unreadable file or a corrupt lock yields no entry:
 * none of them is evidence of a live process.
 */
export function collectLiveLocks(
  locksDir: string,
  probe: (pid: number) => boolean = isPidAlive,
): LiveLock[] {
  let files: string[];
  try {
    files = readdirSync(locksDir);
  } catch {
    return [];
  }

  const live: LiveLock[] = [];
  for (const file of files) {
    if (!file.endsWith(".lock")) continue;
    let lock: LiveLock;
    try {
      lock = JSON.parse(readFileSync(join(locksDir, file), "utf-8")) as LiveLock;
    } catch {
      continue; // Corrupt or vanished lock — not evidence of a live process.
    }
    if (typeof lock?.pid === "number" && probe(lock.pid)) live.push(lock);
  }
  return live;
}

/** `<henchDir>/locks` — the directory {@link ./limiter} writes to. */
export function locksDirOf(henchDir: string): string {
  return join(henchDir, "locks");
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** Parse an ISO timestamp, returning null for missing or unparseable input. */
function epochOf(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** "3d 4h", "12m" — coarse age for reason strings. */
function describeAge(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "less than a minute";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/** Judge whether one run recorded as "running" is actually executing. */
export function classifyRunLiveness(
  run: RunLivenessInput,
  ctx: LivenessContext,
): LivenessVerdict {
  const now = ctx.now ?? Date.now();
  const host = ctx.host ?? hostname();
  const probe = ctx.isPidAlive ?? isPidAlive;
  const runStart = epochOf(run.startedAt);
  const lastSeen = epochOf(run.lastActivityAt) ?? runStart;

  // 1. Recorded elsewhere — local pids carry no information about it.
  if (run.host && run.host !== host) {
    return {
      liveness: "foreign",
      reason: `Recorded on host "${run.host}"; ${host} cannot inspect its processes.`,
      pid: null,
      canEnd: false,
    };
  }

  // 2. The run names its own pid.
  if (typeof run.pid === "number") {
    if (!probe(run.pid)) {
      const idle = lastSeen != null ? `; last heartbeat ${describeAge(now - lastSeen)} ago` : "";
      return {
        liveness: "orphaned",
        reason: `Hench process ${run.pid} is no longer running on ${host}${idle}.`,
        pid: null,
        canEnd: true,
      };
    }
    if (lastSeen == null || now - lastSeen > RUN_STALE_THRESHOLD_MS) {
      const age = lastSeen != null ? ` for ${describeAge(now - lastSeen)}` : "";
      return {
        liveness: "unknown",
        reason:
          `Process ${run.pid} exists but the run has stopped reporting${age}; ` +
          `it may be hung, or the pid may have been reused.`,
        pid: run.pid,
        canEnd: false,
      };
    }
    return {
      liveness: "live",
      reason: `Hench process ${run.pid} is running and reporting.`,
      pid: run.pid,
      canEnd: false,
    };
  }

  // 3. Older records without a pid: lock-file evidence.
  const namedLock = run.taskId
    ? ctx.liveLocks.find((l) => l.taskId === run.taskId)
    : undefined;
  if (namedLock) {
    return {
      liveness: "live",
      reason: `Held by live hench process ${namedLock.pid}.`,
      pid: namedLock.pid,
      canEnd: false,
    };
  }

  // Untagged live locks (from `--auto` runs) could belong to this run only if
  // they started around the same time as it did.
  const plausible = ctx.liveLocks.filter((l) => {
    if (l.taskId) return false; // tagged for a different task
    const lockStart = epochOf(l.startedAt);
    if (lockStart == null || runStart == null) return true; // cannot rule it out
    return Math.abs(lockStart - runStart) <= LOCK_ATTRIBUTION_WINDOW_MS;
  });
  if (plausible.length > 0) {
    const pids = plausible.map((l) => l.pid).join(", ");
    return {
      liveness: "unknown",
      reason:
        `${plausible.length} hench process${plausible.length === 1 ? "" : "es"} ` +
        `(pid ${pids}) started around the same time but recorded no task id, ` +
        `so this run cannot be confirmed either way.`,
      pid: plausible.length === 1 ? plausible[0]!.pid : null,
      canEnd: false,
    };
  }

  const idle = lastSeen != null ? `; last activity ${describeAge(now - lastSeen)} ago` : "";
  return {
    liveness: "orphaned",
    reason: `No hench process on ${host} holds a lock for this run${idle}.`,
    pid: null,
    canEnd: true,
  };
}

/** Tally verdicts. */
export function summarizeLiveness(
  verdicts: readonly Pick<LivenessVerdict, "liveness">[],
): LivenessSummary {
  const summary: LivenessSummary = { total: verdicts.length, live: 0, foreign: 0, unknown: 0, orphaned: 0 };
  for (const v of verdicts) summary[v.liveness] += 1;
  return summary;
}
