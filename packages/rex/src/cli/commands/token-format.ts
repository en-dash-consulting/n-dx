/**
 * CLI presentation formatting for token usage data.
 *
 * These functions produce terminal-oriented strings for CLI display.
 * The domain core (token-usage.ts) exposes raw data structures;
 * this module composes them with CLI-specific formatting.
 */

import { resolveStore } from "../../store/index.js";
import {
  aggregateTokenUsage,
  checkBudget,
} from "../../core/token-usage.js";
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
  const total = usage.totalInputTokens + usage.totalOutputTokens;

  if (total === 0) {
    return ["Token usage: none recorded"];
  }

  const lines: string[] = [];

  lines.push(
    `Token usage: ${fmt(total)} tokens (${fmt(usage.totalInputTokens)} in / ${fmt(usage.totalOutputTokens)} out)`,
  );

  // Per-package breakdown — only show packages with usage
  const { rex, hench, sv } = usage.packages;
  const parts: string[] = [];

  if (sv.inputTokens + sv.outputTokens > 0) {
    const svTotal = sv.inputTokens + sv.outputTokens;
    parts.push(`sv: ${fmt(svTotal)} (${sv.calls} calls)`);
  }

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
  const store = await resolveStore(rexDir);

  let config;
  try {
    config = await store.loadConfig();
  } catch {
    return undefined; // Config not available — skip
  }

  if (!config.budget) return undefined;

  const logEntries = await store.readLog();
  const usage = await aggregateTokenUsage(logEntries, projectDir);

  return checkBudget(usage, config.budget);
}
