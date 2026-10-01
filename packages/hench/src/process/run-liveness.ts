/**
 * Liveness verification for runs recorded as `status: "running"`.
 *
 * A run file stays `"running"` until the process that owns it writes a terminal
 * status. A crash, a Ctrl-C, a machine restart or a `kill -9` never gets that
 * far, so the file says "running" forever and every surface that counts active
 * work — `hench status`, the dashboard's active-task list — counts runs nothing
 * is executing. Elapsed time cannot separate the two cases: a genuinely long
 * run and an abandoned one both look like "started hours ago".
 *
 * This module answers the question from evidence instead of from a timer:
 *
 * | Verdict    | Evidence                                                            |
 * |------------|---------------------------------------------------------------------|
 * | `live`     | a live PID lock names this task (or the caller owns the child)        |
 * | `foreign`  | recorded on another host — PIDs on this machine say nothing about it |
 * | `unknown`  | live hench processes exist but none can be attributed to this run    |
 * | `orphaned` | no process on this host could be running it                          |
 *
 * Only `orphaned` is safe to end without asking: every other verdict either has
 * a live process behind it or cannot be disproved from this machine.
 *
 * The evidence comes from `.hench/locks/<pid>.lock`, which `hench run` acquires
 * before starting work and releases on exit — see {@link ../process/limiter}.
 *
 * **This module is mirrored in `@n-dx/web` as `web/src/server/run-liveness.ts`,**
 * because the web package deliberately takes no runtime dependency on hench.
 * The two are pinned to identical verdicts by
 * `tests/e2e/run-liveness-parity.test.js`; change both, or that test fails.
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
 * How far apart a lock's `startedAt` and a run's `startedAt` may be before the
 * lock is ruled out as that run's owner.
 *
 * `hench run` acquires its lock immediately before recording the run, so the
 * two timestamps are seconds apart in practice. Locks are only *optionally*
 * tagged with a task id — `limiter.acquire(flags.task)` passes `undefined` when
 * the task was auto-selected — so an untagged live lock has to be matched by
 * start time or not at all. Without this window a single live hench process
 * would make every abandoned run on disk unattributable, which is exactly the
 * state this module exists to resolve.
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
 * Mirrors `LockFileData` in {@link ../process/limiter}.
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
}

/** Everything needed to judge a run, gathered once per audit sweep. */
export interface LivenessContext {
  /** Locks whose PID is still alive, from {@link collectLiveLocks}. */
  liveLocks: readonly LiveLock[];
  /** Task ids whose child process the caller spawned and still holds. */
  managedTaskIds: ReadonlySet<string>;
  /** This machine's hostname. Defaults to `os.hostname()`. */
  host?: string;
  /** Clock, injectable for deterministic tests. Defaults to `Date.now()`. */
  now?: number;
}

/** The judgment on one run. */
export interface LivenessVerdict {
  liveness: RunLiveness;
  /** Human-readable justification, shown verbatim by the CLI and the dashboard. */
  reason: string;
  /** The PID executing this run, when one could be identified. */
  pid: number | null;
  /** Whether ending this run is safe without further confirmation. */
  canEnd: boolean;
}

/** Counts by verdict, for the audit summary. */
export interface LivenessSummary {
  total: number;
  live: number;
  foreign: number;
  unknown: number;
  orphaned: number;
}

// ---------------------------------------------------------------------------
// PID liveness
// ---------------------------------------------------------------------------

/**
 * Check whether a process with the given PID exists.
 *
 * Signal 0 performs the permission and existence checks without delivering a
 * signal; Node maps this onto Windows too.
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read `.hench/locks/` and return the locks whose owning process is alive.
 *
 * A missing directory, an unreadable file or a corrupt lock yields no entry —
 * absence of evidence is handled by the caller, which treats it as "no process
 * is holding this", the whole point of the sweep.
 */
export function collectLiveLocks(locksDir: string): LiveLock[] {
  let files: string[];
  try {
    files = readdirSync(locksDir);
  } catch {
    return [];
  }

  const live: LiveLock[] = [];
  for (const file of files) {
    if (!file.endsWith(".lock")) continue;
    try {
      const lock = JSON.parse(readFileSync(join(locksDir, file), "utf-8")) as LiveLock;
      if (typeof lock.pid === "number" && isPidAlive(lock.pid)) {
        live.push(lock);
      }
    } catch {
      // Corrupt or vanished lock — not evidence of a live process.
    }
  }
  return live;
}

/** `<henchDir>/locks` — the directory {@link ../process/limiter} writes to. */
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

/**
 * Judge whether one run recorded as "running" is actually executing.
 *
 * Checks run in order of evidence strength: a process the caller owns, then a
 * lock naming the task, then the host check (which can only ever withhold a
 * verdict), then start-time attribution against untagged locks.
 */
export function classifyRunLiveness(
  run: RunLivenessInput,
  ctx: LivenessContext,
): LivenessVerdict {
  const now = ctx.now ?? Date.now();
  const host = ctx.host ?? hostname();

  // 1. The caller spawned it and still holds the handle — definitive.
  if (run.taskId && ctx.managedTaskIds.has(run.taskId)) {
    return {
      liveness: "live",
      reason: "This dashboard owns the running process.",
      pid: null,
      canEnd: false,
    };
  }

  // 2. A live lock names this task — definitive.
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

  // 3. Recorded elsewhere — local PIDs carry no information about it, so no
  //    amount of local evidence can condemn it.
  if (run.host && run.host !== host) {
    return {
      liveness: "foreign",
      reason: `Recorded on host "${run.host}"; ${host} cannot inspect its processes.`,
      pid: null,
      canEnd: false,
    };
  }

  // 4. Untagged live locks (from `--auto` runs) could belong to this run only
  //    if they started around the same time as it did.
  const runStart = epochOf(run.startedAt);
  const plausible = ctx.liveLocks.filter((l) => {
    if (l.taskId) return false; // tagged for a different task — already excluded
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

  // 5. Nothing on this host can be running it.
  const lastSeen = epochOf(run.lastActivityAt) ?? runStart;
  const idle = lastSeen != null ? `; last activity ${describeAge(now - lastSeen)} ago` : "";
  return {
    liveness: "orphaned",
    reason: `No hench process on ${host} holds a lock for this run${idle}.`,
    pid: null,
    canEnd: true,
  };
}

/** Tally verdicts for the audit summary. */
export function summarizeLiveness(
  verdicts: readonly Pick<LivenessVerdict, "liveness">[],
): LivenessSummary {
  const summary: LivenessSummary = {
    total: verdicts.length,
    live: 0,
    foreign: 0,
    unknown: 0,
    orphaned: 0,
  };
  for (const v of verdicts) summary[v.liveness] += 1;
  return summary;
}
