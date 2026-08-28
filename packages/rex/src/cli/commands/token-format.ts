/**
 * CLI presentation formatting for token usage data.
 *
 * These functions produce terminal-oriented strings for CLI display.
 * The domain core (token-usage.ts) exposes raw data structures;
 * this module composes them with CLI-specific formatting.
 */

import {
  aggregateTokenUsage,
  checkBudget,
} from "../../core/token-usage.js";
import { loadTokenUsageConfig, readTokenUsageLog } from "../../core/token-store.js";
import type {
  AggregateTokenUsage,
  BudgetCheckResult,
  PackageTokenUsage,
} from "../../core/token-usage.js";

/** Format a number with locale-aware commas. */
function fmt(n: number): string {
  return n.toLocaleString();
}

/**
 * Format aggregate token usage for CLI display.
 * Returns an array of lines (without trailing newlines).
 */
export function formatAggregateTokenUsage(usage: AggregateTokenUsage): string[] {
  const cacheTotal = usage.totalCacheCreationTokens + usage.totalCacheReadTokens;
  const total = usage.totalInputTokens + usage.totalOutputTokens + cacheTotal;

  if (total === 0) {
    return ["Token usage: none recorded"];
  }

  const lines: string[] = [];

  // Cache figures ride alongside the in/out split rather than inside the input
  // number. A resumed session re-reads its whole context, so its cache reads
  // can exceed fresh input by orders of magnitude while costing a fraction as
  // much — fusing them would misstate both the work and the money.
  const split = cacheTotal > 0
    ? `${fmt(usage.totalInputTokens)} in / ${fmt(usage.totalOutputTokens)} out / ` +
      `${fmt(usage.totalCacheCreationTokens)} cache write / ${fmt(usage.totalCacheReadTokens)} cache read`
    : `${fmt(usage.totalInputTokens)} in / ${fmt(usage.totalOutputTokens)} out`;

  lines.push(`Token usage: ${fmt(total)} tokens (${split})`);

  // Per-package breakdown — only show packages with usage
  const { rex, hench, sv } = usage.packages;
  const parts: string[] = [];

  // Per-package figures count the same four fields as the headline, so the
  // parts add up to the total a reader just saw.
  const pkgTotal = (p: PackageTokenUsage): number =>
    p.inputTokens + p.outputTokens + p.cacheCreationTokens + p.cacheReadTokens;

  if (pkgTotal(sv) > 0) {
    parts.push(`sv: ${fmt(pkgTotal(sv))} (${sv.calls} calls)`);
  }

  if (pkgTotal(rex) > 0) {
    parts.push(`rex: ${fmt(pkgTotal(rex))} (${rex.calls} calls)`);
  }

  if (pkgTotal(hench) > 0) {
    parts.push(`hench: ${fmt(pkgTotal(hench))} (${hench.calls} runs)`);
  }

  if (parts.length > 0) {
    lines.push(`  ${parts.join("  ·  ")}`);
  }

  return lines;
}

/**
 * Format budget check warnings for CLI display.
 *
 * Returns an array of formatted lines with severity indicators.
 * Returns an empty array when no budget is configured or usage is within bounds.
 */
export function formatBudgetWarnings(result: BudgetCheckResult): string[] {
  if (result.severity === "ok" || result.warnings.length === 0) return [];

  const prefix = result.severity === "exceeded" ? "⚠ BUDGET EXCEEDED" : "⚠ Budget warning";
  const lines: string[] = [`${prefix}:`];

  for (const warning of result.warnings) {
    lines.push(`  ${warning}`);
  }

  return lines;
}

/**
 * Pre-flight budget check for orchestration commands.
 *
 * Loads the rex config, aggregates current token usage, checks against
 * budget thresholds, and returns the result. Returns undefined if no
 * budget is configured.
 *
 * @param rexDir  Path to the `.rex/` directory.
 * @param projectDir  Project root directory.
 */
export async function preflightBudgetCheck(
  rexDir: string,
  projectDir: string,
): Promise<BudgetCheckResult | undefined> {
  let config;
  try {
    config = await loadTokenUsageConfig(rexDir);
  } catch {
    return undefined; // Config not available — skip
  }

  if (!config.budget) return undefined;

  const logEntries = await readTokenUsageLog(rexDir);
  const usage = await aggregateTokenUsage(logEntries, projectDir);

  return checkBudget(usage, config.budget);
}
