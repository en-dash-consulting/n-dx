/**
 * The finished-run summary's reading of the run record, kept pure so every
 * answer the page gives — what the work changed, what it cost, which commit it
 * landed — is testable without a DOM. `live-summary.ts` only lays them out.
 *
 * A record written before a field existed arrives without it, so each reading
 * below distinguishes "none" from "not recorded": a run whose tool calls were
 * never tallied must not read as a run that made no tool calls.
 *
 * @module web/viewer/views/live-summary-model
 */

import type { LiveTaskRun, RunRecordSummary, RunSummaryCounts } from "../hooks/index.js";
import { fmtDuration, formatTokenCount } from "../utils/format.js";
import { formatUsd } from "./live-model.js";

/** Shown in place of a number the record does not carry. */
export const NOT_RECORDED = "not recorded";

// ── Work summary ─────────────────────────────────────────────────────

export interface CountRow {
  key: keyof RunSummaryCounts;
  label: string;
  value: number;
}

const COUNT_LABELS: Array<{ key: keyof RunSummaryCounts; label: string }> = [
  { key: "filesChanged", label: "Files changed" },
  { key: "filesRead", label: "Files read" },
  { key: "commandsExecuted", label: "Commands run" },
  { key: "testsRun", label: "Test runs" },
  { key: "toolCallsTotal", label: "Tool calls" },
];

/**
 * The tool-call tallies, in a fixed order. Empty when the record has no
 * `structuredSummary` at all — the caller says "no work summary was recorded"
 * rather than printing five zeroes.
 */
export function workCounts(record: RunRecordSummary | null): CountRow[] {
  const counts = record?.structuredSummary?.counts;
  if (!counts) return [];
  return COUNT_LABELS
    .filter(({ key }) => typeof counts[key] === "number")
    .map(({ key, label }) => ({ key, label, value: counts[key] as number }));
}

export interface FileChange {
  /** Git status letter (A/M/D/R/C/T), or "?" when only the path was recorded. */
  status: string;
  path: string;
}

/**
 * Files the run changed: git's `STATUS\tPATH` list when the record has it,
 * else the plain path list with an unknown status. Paths may themselves
 * contain a tab, so only the first field is the status.
 */
export function fileChanges(record: RunRecordSummary | null): FileChange[] {
  const summary = record?.structuredSummary;
  if (!summary) return [];
  const withStatus = summary.fileChangesWithStatus;
  if (Array.isArray(withStatus) && withStatus.length > 0) {
    return withStatus.map((entry) => {
      const [status, ...rest] = entry.split("\t");
      const path = rest.join("\t");
      return { status: status || "?", path: path || entry };
    });
  }
  return (summary.filesChanged ?? []).map((path) => ({ status: "?", path }));
}

// ── Metrics ──────────────────────────────────────────────────────────

export interface MetricRow {
  key: string;
  label: string;
  value: string;
  /** Hover detail — the full list behind a count, or the breakdown behind a total. */
  title?: string;
}

/**
 * How many times the run re-spawned the vendor, and what for.
 *
 * `retryAttempts` is the direct count; `spawnCount` is every spawn including
 * the first, so one spawn is zero retries. Null when the record carries
 * neither, which is every record written before they existed.
 */
export function retryCount(record: RunRecordSummary | null): number | null {
  if (typeof record?.retryAttempts === "number") return record.retryAttempts;
  if (typeof record?.spawnCount === "number") return Math.max(0, record.spawnCount - 1);
  return null;
}

function spawnDetail(record: RunRecordSummary | null): string | undefined {
  const breakdown = record?.spawnBreakdown;
  if (!breakdown) return undefined;
  const parts = Object.entries(breakdown).map(([reason, n]) => `${reason}: ${n}`);
  return parts.length > 0 ? parts.join("\n") : undefined;
}

/**
 * The run's metrics, in the order the page lists them: how long it took, how
 * much of the agent it used, what it spent, and what it left behind.
 */
export function runMetrics(run: LiveTaskRun, record: RunRecordSummary | null): MetricRow[] {
  const counts = record?.structuredSummary?.counts;
  const retries = retryCount(record);
  const changes = fileChanges(record);
  const rows: MetricRow[] = [
    {
      key: "wall",
      label: "Wall time",
      value: run.startedAt && run.finishedAt ? fmtDuration(run.startedAt, run.finishedAt) : NOT_RECORDED,
    },
    { key: "turns", label: "Turns", value: run.turns !== null ? String(run.turns) : NOT_RECORDED },
    { key: "retries", label: "Retries", value: retries !== null ? String(retries) : NOT_RECORDED, title: spawnDetail(record) },
    {
      key: "tools",
      label: "Tool calls",
      value: typeof counts?.toolCallsTotal === "number" ? String(counts.toolCallsTotal) : NOT_RECORDED,
    },
    { key: "input", label: "Input tokens", value: formatTokenCount(run.tokens.input) },
    { key: "output", label: "Output tokens", value: formatTokenCount(run.tokens.output) },
    { key: "cache-write", label: "Cache write tokens", value: formatTokenCount(run.tokens.cacheCreationInput) },
    { key: "cache-read", label: "Cache read tokens", value: formatTokenCount(run.tokens.cacheReadInput) },
    { key: "cost", label: "Estimated cost", value: formatUsd(run.costUsd) },
    {
      key: "files",
      label: "Files changed",
      value: record?.structuredSummary ? String(changes.length) : NOT_RECORDED,
      title: changes.length > 0 ? changes.map((c) => c.path).join("\n") : undefined,
    },
  ];
  return rows;
}

// ── Commits ──────────────────────────────────────────────────────────

export interface RunCommit {
  sha: string;
  shortSha: string;
  subject: string;
}

/** The commits the run landed, skipping any entry without a sha. */
export function runCommits(record: RunRecordSummary | null): RunCommit[] {
  return (record?.commits ?? [])
    .filter((c): c is { sha: string; subject?: string } => typeof c.sha === "string" && c.sha.length > 0)
    .map((c) => ({ sha: c.sha, shortSha: c.sha.slice(0, 10), subject: c.subject ?? c.sha }));
}

// Where to open a commit lives in `../utils/commit-link.ts`: it is the
// viewer's one remote-URL reader, shared with the PRD tree's commits table.

// ── Follow-up capture ────────────────────────────────────────────────

/**
 * Where a follow-up task is filed: under the finished task's own parent, so it
 * lands beside the work it follows rather than at the root of the tree. Null
 * when the task has no recorded ancestors — the page then says it cannot file
 * one, which is honest, instead of inventing an epic.
 */
export function followUpParentId(epicChain: ReadonlyArray<{ id: string }>): string | null {
  return epicChain.length > 0 ? epicChain[epicChain.length - 1].id : null;
}

/** The body filed with a follow-up: what it follows, so the item stands alone later. */
export function followUpDescription(taskTitle: string, runId: string, note: string): string {
  return `${note.trim()}\n\nFollow-up from run ${runId} of "${taskTitle}".`;
}
