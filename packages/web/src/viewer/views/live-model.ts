/**
 * The Live overview's reading of `GET /api/live`, kept pure so every state
 * the page can be in — idle, stuck runs, a mid-flight analysis, a crowded
 * machine — is testable without a DOM. The view (`live.ts`) only lays these
 * answers out.
 *
 * @module web/viewer/views/live-model
 */

import { isDeadRun, livenessBadge, needsAttention } from "../hooks/index.js";
import type {
  LiveAnalyzeProgress,
  LiveChainLink,
  LiveJobFull,
  LiveRunFull,
  LiveSnapshot,
  LiveWorktreeFull,
  MemoryPressure,
} from "../hooks/index.js";

// ── What is running ──────────────────────────────────────────────────

/**
 * Runs that need a look: stuck, no process behind them, or impossible to verify.
 * They are a section of their own — "Running now" would lie about them.
 */
export function attentionRuns(snapshot: LiveSnapshot): LiveRunFull[] {
  return snapshot.runs.filter(needsAttention);
}

/** Runs that are moving, newest first (the server's order). */
export function runningRuns(snapshot: LiveSnapshot): LiveRunFull[] {
  return snapshot.runs.filter((r) => !needsAttention(r));
}

/** Dead runs "End N dead runs" closes: orphaned, and the server agrees they can be ended. */
export function endableDeadRuns(snapshot: LiveSnapshot): LiveRunFull[] {
  return snapshot.runs.filter((r) => isDeadRun(r) && r.canEnd !== false);
}

/**
 * Whether a row offers a single-run End. Orphaned and unknown runs can be ended;
 * a foreign run belongs to another machine and never can, and a merely stale
 * one still has a process (use Mark stuck for that).
 */
export function canEndRun(run: LiveRunFull): boolean {
  return (run.liveness === "orphaned" || run.liveness === "unknown") && run.canEnd !== false;
}

/** The confirm text for "End N dead runs". */
export function endDeadPrompt(runs: readonly LiveRunFull[]): string {
  const dead = runs.length === 1 ? "1 dead run" : `${runs.length} dead runs`;
  return `End ${dead}? No process is executing ${runs.length === 1 ? "it" : "them"}; each is recorded as failed. Nothing is signalled.`;
}

/** The confirm text for ending one run whose liveness could not be verified — it names the reason. */
export function endUnknownPrompt(run: LiveRunFull): string {
  return `The server could not tell whether "${run.taskTitle ?? run.runId}" is still running: ${run.livenessReason ?? "no evidence either way"}\n\n`
    + "End it anyway? It is recorded as failed. If a process is still working on it, that process is not stopped.";
}

/** What a reconcile answer says happened, for the notice beside the button. */
export function reconcileNotice(
  result: { ended?: number; failed?: number; worktrees?: Array<{ outcomes?: Array<{ skipped?: string }> }> },
): string {
  const ended = result.ended ?? 0;
  const failed = result.failed ?? 0;
  const skipped = (result.worktrees ?? []).flatMap((w) => w.outcomes ?? []).filter((o) => o.skipped).length;
  const parts = [`Ended ${ended} ${ended === 1 ? "run" : "runs"}`];
  if (skipped > 0) parts.push(`${skipped} changed and were left alone`);
  if (failed > 0) parts.push(`${failed} could not be written`);
  return parts.join(" · ");
}

/** Why a row is listed: the server's reason when it has a verdict, else the heartbeat. */
export function attentionReason(run: LiveRunFull): string {
  if (run.livenessReason && livenessBadge(run.liveness)) return run.livenessReason;
  return run.heartbeatAgeMs === null ? "no heartbeat" : `no heartbeat for ${Math.round(run.heartbeatAgeMs / 60_000)} min`;
}

/**
 * Runs "Stop all" can end: emergency-stop terminates the executions of the
 * served worktree only, so runs in other worktrees and analysis jobs are not
 * counted — they would enable a button that stops nothing.
 */
export function stoppableRuns(snapshot: LiveSnapshot): LiveRunFull[] {
  return snapshot.runs.filter((r) => r.worktree.isServed);
}

/** The confirm text for "Stop all", naming how many runs it ends. */
export function stopAllPrompt(count: number): string {
  const runs = count === 1 ? "1 run" : `${count} runs`;
  return `Stop ${runs} in this worktree? Runs in other worktrees are not affected. New tasks stay paused until resumed.`;
}

export type RunningItem =
  | { kind: "run"; key: string; startedAt: string | null; run: LiveRunFull }
  | { kind: "job"; key: string; startedAt: string | null; job: LiveJobFull };

/** "Running now": moving runs and long jobs interleaved, newest first. */
export function runningItems(snapshot: LiveSnapshot): RunningItem[] {
  const items: RunningItem[] = [
    ...runningRuns(snapshot).map((run): RunningItem => ({ kind: "run", key: `run:${run.runId}`, startedAt: run.startedAt, run })),
    ...snapshot.jobs.map((job): RunningItem => ({ kind: "job", key: `job:${job.id}`, startedAt: job.startedAt, job })),
  ];
  return items.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
}

/**
 * Nothing running anywhere: no run, no job, and no execution the dashboard has
 * spawned that is still starting. Stuck runs count as running — a stuck run
 * is something to deal with, not an empty page.
 */
export function isIdle(snapshot: LiveSnapshot): boolean {
  return snapshot.runs.length === 0 && snapshot.jobs.length === 0 && snapshot.queue.starting.length === 0;
}

/** Sourcevision's phases, as the segments of the six-part bar. */
export type PhaseSegmentState = "done" | "active" | "pending";

export function phaseSegments(progress: LiveAnalyzeProgress | null): PhaseSegmentState[] {
  const phase = progress?.phase;
  const total = phase && phase.total > 0 ? phase.total : 6;
  return Array.from({ length: total }, (_, i): PhaseSegmentState => {
    if (!phase) return "pending";
    if (i + 1 < phase.index) return "done";
    return i + 1 === phase.index ? "active" : "pending";
  });
}

/** "Epic › Feature" — the task's ancestors, root first, or null when the PRD does not know it. */
export function chainLabel(chain: readonly LiveChainLink[]): string | null {
  return chain.length > 0 ? chain.map((c) => c.title).join(" › ") : null;
}

/** Human names for the long jobs the dashboard can run. */
const JOB_LABELS: Record<string, string> = {
  "sv-analyze": "Sourcevision analysis",
  analyze: "Project scan",
  "self-heal": "Self-heal",
  ci: "CI",
  reshape: "Reshape",
  refresh: "Refresh",
  recommend: "Recommendations",
};

export function jobLabel(job: Pick<LiveJobFull, "kind">): string {
  return JOB_LABELS[job.kind] ?? job.kind;
}

// ── Machine strip ────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 10) return `${Math.round(gb)} GB`;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

export function formatUsd(usd: number): string {
  if (usd === 0) return "$0";
  return usd < 1 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(usd < 100 ? 2 : 0)}`;
}

/** Seconds since the answer was generated; null for an unreadable timestamp. */
export function secondsSince(generatedAt: string, now: number): number | null {
  const ms = now - Date.parse(generatedAt);
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : null;
}

/** "updated 3 s ago". */
export function updatedLabel(generatedAt: string, now: number): string {
  const s = secondsSince(generatedAt, now);
  return s === null ? "updated" : `updated ${s} s ago`;
}

const PRESSURE_LABELS: Record<MemoryPressure, string> = {
  normal: "Normal",
  warn: "Warn",
  critical: "Critical",
  unknown: "Unknown",
};

/** "<available> available · floor <floor>" — omits the floor clause when there is none, and
 * collapses to a dash entirely when the reading itself is unknown (no bytes to show at all). */
function memoryDetail(memory: LiveSnapshot["machine"]["memory"]): string {
  if (memory.availableBytes === null) return "—";
  const available = `${formatBytes(memory.availableBytes)} available`;
  return memory.floorBytes === null ? available : `${available} · floor ${formatBytes(memory.floorBytes)}`;
}

export interface MachineTile {
  key: string;
  label: string;
  value: string;
  detail: string | null;
  /** Worth a second look: memory under the floor, no free slot. */
  warn: boolean;
}

/** The machine strip, one tile per question an operator asks before starting more work. */
export function machineTiles(machine: LiveSnapshot["machine"], runningJobs: number, starting: number): MachineTile[] {
  const { slots, memory, llm, worktrees, spend } = machine;
  return [
    {
      key: "slots",
      // The scope is in the label so the number cannot pass for the run list's count.
      label: slots.scope === "machine" ? "Hench slots · this machine" : "Hench slots · this repository",
      value: `${slots.inUse} of ${slots.max}`,
      detail: slots.queued > 0 ? `${starting} starting · ${slots.queued} queued` : `${starting} starting`,
      warn: slots.available <= 0,
    },
    { key: "jobs", label: "Running jobs", value: String(runningJobs), detail: null, warn: false },
    {
      key: "memory",
      label: "Memory",
      value: PRESSURE_LABELS[memory.pressure],
      detail: memoryDetail(memory),
      // A machine that could not be read (pressure "unknown") never warns —
      // belowFloor is already false for one, but pressure is checked directly too.
      warn: memory.pressure !== "unknown" && (memory.pressure === "warn" || memory.pressure === "critical" || memory.belowFloor),
    },
    {
      key: "model",
      label: "Model",
      value: llm.model ?? llm.vendor ?? "not configured",
      detail: llm.model && llm.vendor ? llm.vendor : null,
      warn: !llm.model && !llm.vendor,
    },
    {
      key: "worktrees",
      label: "Worktrees",
      value: String(worktrees.total),
      detail: `${worktrees.withLiveRun} with a live run`,
      warn: false,
    },
    {
      key: "spend",
      label: "Spend today",
      value: formatUsd(spend.todayUsd),
      detail: `${formatUsd(spend.inFlightUsd)} in flight`,
      warn: false,
    },
  ];
}

// ── Worktrees ────────────────────────────────────────────────────────

export interface WorktreeRow {
  worktree: LiveWorktreeFull;
  runs: number;
  stuck: number;
  jobs: number;
}

/**
 * Worktrees with something live, busiest first. Idle worktrees are not listed
 * by the server — only counted — so they are summarised as `idle`.
 */
export function worktreeRows(snapshot: LiveSnapshot): { rows: WorktreeRow[]; idle: number } {
  const byKey = new Map<string, WorktreeRow>();
  const row = (worktree: LiveWorktreeFull): WorktreeRow => {
    let r = byKey.get(worktree.key);
    if (!r) byKey.set(worktree.key, (r = { worktree, runs: 0, stuck: 0, jobs: 0 }));
    return r;
  };
  for (const run of snapshot.runs) {
    const r = row(run.worktree);
    r.runs++;
    if (needsAttention(run)) r.stuck++;
  }
  for (const start of snapshot.queue.starting) row(start.worktree).runs++;
  for (const job of snapshot.jobs) if (job.worktree) row(job.worktree).jobs++;
  const rows = [...byKey.values()].sort((a, b) => b.runs + b.jobs - (a.runs + a.jobs));
  return { rows, idle: Math.max(0, snapshot.machine.worktrees.total - rows.length) };
}
