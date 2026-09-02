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
  totalTokens,
} from "../../core/token-usage.js";
import { loadTokenUsageConfig, readTokenUsageLog } from "../../core/token-store.js";
import type {
  AggregateTokenUsage,
  BudgetCheckResult,
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
  const total =
    usage.totalInputTokens +
    usage.totalOutputTokens +
    usage.totalCacheCreationTokens +
    usage.totalCacheReadTokens;

  if (total === 0) {
    return ["Token usage: none recorded"];
  }

  const lines: string[] = [];

  // The split is spelled out rather than collapsed: the four kinds are billed
  // at four different rates, and on a warm agent loop cache reads dominate the
  // count while contributing least per token. One number would mislead in both
  // directions. Cache segments are omitted entirely when zero so projects that
  // never cache keep the original two-part line.
  const segments = [
    `${fmt(usage.totalInputTokens)} in`,
    `${fmt(usage.totalOutputTokens)} out`,
  ];
  if (usage.totalCacheCreationTokens > 0) {
    segments.push(`${fmt(usage.totalCacheCreationTokens)} cache write`);
  }
  if (usage.totalCacheReadTokens > 0) {
    segments.push(`${fmt(usage.totalCacheReadTokens)} cache read`);
  }

  lines.push(`Token usage: ${fmt(total)} tokens (${segments.join(" / ")})`);

  // Per-package breakdown — only show packages with usage
  const { rex, hench, sv } = usage.packages;
  const parts: string[] = [];

  if (totalTokens(sv) > 0) {
    parts.push(`sv: ${fmt(totalTokens(sv))} (${sv.calls} calls)`);
  }

  if (totalTokens(rex) > 0) {
    parts.push(`rex: ${fmt(totalTokens(rex))} (${rex.calls} calls)`);
  }

  if (totalTokens(hench) > 0) {
    parts.push(`hench: ${fmt(totalTokens(hench))} (${hench.calls} runs)`);
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
