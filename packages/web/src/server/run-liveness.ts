/**
 * Liveness verdict for runs recorded as `status: "running"` — the web mirror.
 *
 * `packages/hench/src/process/run-liveness.ts` is canonical: hench owns
 * `.hench/runs/` and `.hench/locks/`. Web takes no runtime dependency on
 * hench, so the rules are copied here and pinned by
 * `tests/e2e/run-liveness-parity.test.js`, which feeds both
 * {@link classifyRunLiveness} implementations the same fixtures and requires
 * identical verdicts. Change both or neither.
 *
 * Evidence, in order:
 *
 * 1. The run's `host` differs from this machine → `foreign`.
 * 2. The run's own `pid`: alive with a fresh heartbeat → `live`; alive with a
 *    heartbeat older than {@link RUN_STALE_THRESHOLD_MS} → `unknown`; dead →
 *    `orphaned`.
 * 3. Records without a pid fall back to live lock files: a lock naming the
 *    task → `live`; untagged locks started within
 *    {@link LOCK_ATTRIBUTION_WINDOW_MS} of the run → `unknown`; none →
 *    `orphaned`.
 *
 * Web adds one rule hench cannot know, outside the mirrored classifier: a run
 * this dashboard spawned and still holds as a child process is `live`
 * ({@link judgeRunLiveness}).
 *
 * @module web/server/run-liveness
 */

import { readdirSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { isPidAlive, RUN_STALE_THRESHOLD_MS } from "./run-staleness.js";

export { RUN_STALE_THRESHOLD_MS };

/** How far apart a lock's and a run's `startedAt` may be for the lock to own the run. Mirrors hench. */
export const LOCK_ATTRIBUTION_WINDOW_MS = 5 * 60 * 1000;

/** Verdict on whether a run recorded as "running" is actually executing. */
export type RunLiveness = "live" | "foreign" | "unknown" | "orphaned";

/** A `<henchDir>/locks/<pid>.lock` entry held by a live process. */
export interface LiveLock {
  pid: number;
  startedAt: string;
  taskId?: string;
}

/** The subset of a run record the classifier reads. */
export interface RunLivenessInput {
  taskId?: string;
  startedAt?: string;
  lastActivityAt?: string;
  host?: string;
  pid?: number;
}

/** Everything needed to judge a run, gathered once per sweep. */
export interface LivenessContext {
  liveLocks: readonly LiveLock[];
  host?: string;
  now?: number;
  isPidAlive?: (pid: number) => boolean;
}

/** The judgment on one run. */
export interface LivenessVerdict {
  liveness: RunLiveness;
  /** Human-readable justification, shown verbatim. */
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

/**
 * The live lock files in `locksDir`. A missing directory, an unreadable file
 * or a corrupt lock yields no entry: none is evidence of a live process.
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

/** `<henchDir>/locks` — where hench's limiter writes. */
export function locksDirOf(henchDir: string): string {
  return join(henchDir, "locks");
}

function epochOf(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function describeAge(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "less than a minute";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/** Judge whether one run recorded as "running" is actually executing. Mirrors hench exactly. */
export function classifyRunLiveness(
  run: RunLivenessInput,
  ctx: LivenessContext,
): LivenessVerdict {
  const now = ctx.now ?? Date.now();
  const host = ctx.host ?? hostname();
  const probe = ctx.isPidAlive ?? isPidAlive;
  const runStart = epochOf(run.startedAt);
  const lastSeen = epochOf(run.lastActivityAt) ?? runStart;

  if (run.host && run.host !== host) {
    return {
      liveness: "foreign",
      reason: `Recorded on host "${run.host}"; ${host} cannot inspect its processes.`,
      pid: null,
      canEnd: false,
    };
  }

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

  const plausible = ctx.liveLocks.filter((l) => {
    if (l.taskId) return false;
    const lockStart = epochOf(l.startedAt);
    if (lockStart == null || runStart == null) return true;
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

/**
 * The classifier's input from a run record or digest, keeping only
 * well-typed fields: records come from other worktrees and hench versions.
 */
export function livenessInputOf(run: {
  taskId?: unknown;
  startedAt?: unknown;
  lastActivityAt?: unknown;
  host?: unknown;
  pid?: unknown;
}): RunLivenessInput {
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  return {
    taskId: str(run.taskId),
    startedAt: str(run.startedAt),
    lastActivityAt: str(run.lastActivityAt),
    host: str(run.host),
    pid: typeof run.pid === "number" && Number.isFinite(run.pid) ? run.pid : undefined,
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

// ---------------------------------------------------------------------------
// Web-only: runs this dashboard holds as child processes
// ---------------------------------------------------------------------------

/** A task execution this dashboard spawned, as `dashboardExecutionsFor` reports it. */
export interface DashboardExecution {
  taskId: string;
  status: string;
  startedAt: string;
}

/**
 * The run's verdict, with the dashboard's own children counted first.
 *
 * A run whose task this dashboard is executing, started no earlier than that
 * execution, is the dashboard's child: the server holds the process, so it is
 * `live` whatever its record says. The start-time check keeps an older record
 * for the same task — left `running` by a crash — from borrowing the
 * execution's liveness. Everything else goes to {@link classifyRunLiveness}.
 */
export function judgeRunLiveness(
  run: RunLivenessInput,
  ctx: LivenessContext,
  executions: readonly DashboardExecution[],
): LivenessVerdict {
  const runStart = epochOf(run.startedAt);
  const managed = run.taskId != null && runStart != null && executions.some((e) => {
    if (e.taskId !== run.taskId || (e.status !== "starting" && e.status !== "running")) return false;
    const execStart = epochOf(e.startedAt);
    return execStart != null && runStart >= execStart;
  });
  if (managed) {
    return {
      liveness: "live",
      reason: "Started by this dashboard, which still holds its process.",
      pid: typeof run.pid === "number" ? run.pid : null,
      canEnd: false,
    };
  }
  return classifyRunLiveness(run, ctx);
}
