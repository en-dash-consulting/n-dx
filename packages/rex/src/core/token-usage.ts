/**
 * Token usage aggregation across all n-dx packages.
 *
 * Reads token data from:
 * - Rex execution log (`analyze_token_usage` events in .rex/execution-log.jsonl)
 * - Hench run records (.hench/runs/*.json)
 *
 * Sourcevision token usage is not currently persisted to a log file,
 * so it is not included in aggregate reporting.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { LogEntry } from "../schema/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Aggregated token usage for a single package. */
export interface PackageTokenUsage {
  /** Total input tokens. */
  inputTokens: number;
  /** Total output tokens. */
  outputTokens: number;
  /** Number of LLM calls. */
  calls: number;
}

/** Combined token usage across all packages. */
export interface AggregateTokenUsage {
  /** Per-package breakdown. */
  packages: {
    rex: PackageTokenUsage;
    hench: PackageTokenUsage;
  };
  /** Total tokens across all packages. */
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCalls: number;
}

/** Time-based filter options for token usage queries. */
export interface TokenUsageFilter {
  /** Only include usage on or after this ISO timestamp. */
  since?: string;
  /** Only include usage on or before this ISO timestamp. */
  until?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyPackageUsage(): PackageTokenUsage {
  return { inputTokens: 0, outputTokens: 0, calls: 0 };
}

function isInRange(timestamp: string, filter: TokenUsageFilter): boolean {
  if (filter.since && timestamp < filter.since) return false;
  if (filter.until && timestamp > filter.until) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Rex token usage from execution log
// ---------------------------------------------------------------------------

/**
 * Extract rex token usage from execution log entries.
 *
 * Looks for `analyze_token_usage` events whose `detail` field
 * contains JSON-serialized AnalyzeTokenUsage data.
 */
export function extractRexTokenUsage(
  logEntries: LogEntry[],
  filter: TokenUsageFilter = {},
): PackageTokenUsage {
  const usage = emptyPackageUsage();

  for (const entry of logEntries) {
    if (entry.event !== "analyze_token_usage") continue;
    if (!entry.detail) continue;
    if (!isInRange(entry.timestamp, filter)) continue;

    try {
      const data = JSON.parse(entry.detail) as {
        calls?: number;
        inputTokens?: number;
        outputTokens?: number;
      };
      if (typeof data.calls === "number") usage.calls += data.calls;
      if (typeof data.inputTokens === "number") usage.inputTokens += data.inputTokens;
      if (typeof data.outputTokens === "number") usage.outputTokens += data.outputTokens;
    } catch {
      // Malformed detail — skip
    }
  }

  return usage;
}

// ---------------------------------------------------------------------------
// Hench token usage from run records
// ---------------------------------------------------------------------------

/** Minimal shape of a hench RunRecord for token extraction. */
interface HenchRunSummary {
  startedAt: string;
  tokenUsage: { input: number; output: number };
}

/**
 * Read hench run files and aggregate token usage.
 *
 * Reads `.hench/runs/*.json` files directly to avoid coupling to the
 * hench package's internal modules.
 */
export async function extractHenchTokenUsage(
  projectDir: string,
  filter: TokenUsageFilter = {},
): Promise<PackageTokenUsage> {
  const usage = emptyPackageUsage();
  const runsDir = join(projectDir, ".hench", "runs");

  let files: string[];
  try {
    files = await readdir(runsDir);
  } catch {
    return usage;
  }

  const jsonFiles = files.filter((f) => f.endsWith(".json"));

  for (const file of jsonFiles) {
    try {
      const raw = await readFile(join(runsDir, file), "utf-8");
      const run = JSON.parse(raw) as HenchRunSummary;

      if (!run.startedAt || !run.tokenUsage) continue;
      if (!isInRange(run.startedAt, filter)) continue;

      usage.calls += 1; // Each run counts as one aggregate call
      usage.inputTokens += run.tokenUsage.input ?? 0;
      usage.outputTokens += run.tokenUsage.output ?? 0;
    } catch {
      // Invalid run file — skip
    }
  }

  return usage;
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

/**
 * Aggregate token usage across all packages.
 *
 * @param logEntries Rex execution log entries (from store.readLog())
 * @param projectDir Project root directory (for reading hench runs)
 * @param filter Optional time-based filter
 */
export async function aggregateTokenUsage(
  logEntries: LogEntry[],
  projectDir: string,
  filter: TokenUsageFilter = {},
): Promise<AggregateTokenUsage> {
  const rex = extractRexTokenUsage(logEntries, filter);
  const hench = await extractHenchTokenUsage(projectDir, filter);

  return {
    packages: { rex, hench },
    totalInputTokens: rex.inputTokens + hench.inputTokens,
    totalOutputTokens: rex.outputTokens + hench.outputTokens,
    totalCalls: rex.calls + hench.calls,
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Format a number with locale-aware commas. */
function fmt(n: number): string {
  return n.toLocaleString();
}

/**
 * Format aggregate token usage for CLI display.
 * Returns an array of lines (without trailing newlines).
 */
export function formatAggregateTokenUsage(usage: AggregateTokenUsage): string[] {
  const total = usage.totalInputTokens + usage.totalOutputTokens;

  if (total === 0) {
    return ["Token usage: none recorded"];
  }

  const lines: string[] = [];

  lines.push(
    `Token usage: ${fmt(total)} tokens (${fmt(usage.totalInputTokens)} in / ${fmt(usage.totalOutputTokens)} out)`,
  );

  // Per-package breakdown — only show packages with usage
  const { rex, hench } = usage.packages;
  const parts: string[] = [];

  if (rex.inputTokens + rex.outputTokens > 0) {
    const rexTotal = rex.inputTokens + rex.outputTokens;
    parts.push(`rex: ${fmt(rexTotal)} (${rex.calls} calls)`);
  }

  if (hench.inputTokens + hench.outputTokens > 0) {
    const henchTotal = hench.inputTokens + hench.outputTokens;
    parts.push(`hench: ${fmt(henchTotal)} (${hench.calls} runs)`);
  }

  if (parts.length > 0) {
    lines.push(`  ${parts.join("  ·  ")}`);
  }

  return lines;
}
