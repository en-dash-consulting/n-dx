import { join } from "node:path";
import { CLIError, PROJECT_DIRS, info, result, warn } from "@n-dx/llm-client";
import {
  aggregateTokenUsage,
  estimateCost,
  collectTokenEvents,
  groupByCommand,
  groupByTimePeriod,
  checkBudget,
} from "../../core/token-usage.js";
import { loadTokenUsageConfig, readTokenUsageLog } from "../../core/token-store.js";
import { formatAggregateTokenUsage, formatBudgetWarnings } from "./token-format.js";
import { BudgetExceededError } from "./token-errors.js";
import type {
  AggregateTokenUsage,
  TokenUsageFilter,
  CommandTokenUsage,
  TimePeriod,
  PeriodBucket,
} from "../../core/token-usage.js";

const VALID_FORMATS = ["json", "tree"] as const;
const VALID_GROUPS: TimePeriod[] = ["day", "week", "month"];

/** Format a number with locale-aware commas. */
function fmt(n: number): string {
  return n.toLocaleString();
}

/**
 * Format detailed per-package breakdown for tree output.
 * Shows input/output split and call count for each package with usage.
 */
function formatPackageDetail(usage: AggregateTokenUsage): string[] {
  const lines: string[] = [];
  const entries: Array<{ name: string; pkg: typeof usage.packages.rex; unit: string }> = [
    { name: "rex", pkg: usage.packages.rex, unit: "calls" },
    { name: "hench", pkg: usage.packages.hench, unit: "runs" },
    { name: "sv", pkg: usage.packages.sv, unit: "calls" },
  ];

  for (const { name, pkg, unit } of entries) {
    const total = pkg.inputTokens + pkg.outputTokens;
    if (total === 0) continue;
    lines.push(
      `  ${name}: ${fmt(total)} tokens (${fmt(pkg.inputTokens)} in / ${fmt(pkg.outputTokens)} out) — ${pkg.calls} ${unit}`,
    );
  }

  return lines;
}

/**
 * Format per-command breakdown for tree output.
 */
function formatCommandDetail(commands: CommandTokenUsage[]): string[] {
  const lines: string[] = [];

  for (const cmd of commands) {
    const total = cmd.inputTokens + cmd.outputTokens;
    const unit = cmd.package === "hench" ? "runs" : "calls";
    lines.push(
      `  ${cmd.package} ${cmd.command}: ${fmt(total)} tokens (${fmt(cmd.inputTokens)} in / ${fmt(cmd.outputTokens)} out) — ${cmd.calls} ${unit}`,
    );
  }

  return lines;
}

/**
 * Format period buckets for tree output.
 */
function formatPeriodBuckets(buckets: PeriodBucket[]): string[] {
  const lines: string[] = [];

  for (const bucket of buckets) {
    const total = bucket.usage.totalInputTokens + bucket.usage.totalOutputTokens;
    lines.push(
      `  ${bucket.period}: ${fmt(total)} tokens (${fmt(bucket.usage.totalInputTokens)} in / ${fmt(bucket.usage.totalOutputTokens)} out) — ${bucket.estimatedCost.total}`,
    );
  }

  return lines;
}

export async function cmdUsage(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const format = flags.format;
  const group = flags.group as TimePeriod | undefined;

  if (format && !VALID_FORMATS.includes(format as (typeof VALID_FORMATS)[number])) {
    throw new CLIError(
      `Unknown format: "${format}"`,
      `Valid formats: ${VALID_FORMATS.join(", ")}`,
    );
  }

  if (group && !VALID_GROUPS.includes(group)) {
    throw new CLIError(
      `Unknown group period: "${group}"`,
      `Valid periods: ${VALID_GROUPS.join(", ")}`,
    );
  }

  const rexDir = join(dir, PROJECT_DIRS.REX);

  // Build time filter
  const tokenFilter: TokenUsageFilter = {};
  if (flags.since) tokenFilter.since = flags.since;
  if (flags.until) tokenFilter.until = flags.until;

  const logEntries = await readTokenUsageLog(rexDir);

  // Collect individual events for command and period breakdowns
  const events = await collectTokenEvents(logEntries, dir, tokenFilter);
  const commands = groupByCommand(events);

  // Aggregate totals (reuse existing infrastructure)
  const usage = await aggregateTokenUsage(logEntries, dir, tokenFilter);
  const cost = estimateCost(usage);

  // Period grouping (optional)
  const periodBuckets = group ? groupByTimePeriod(events, group) : undefined;

  // Budget checking
  const config = await loadTokenUsageConfig(rexDir);
  const budgetResult = config.budget
    ? checkBudget(usage, config.budget)
    : undefined;

  if (format === "json") {
    const output: Record<string, unknown> = { ...usage };
    output.estimatedCost = {
      total: cost.total,
      inputCost: cost.inputCost,
      outputCost: cost.outputCost,
    };

    // Per-command breakdown
    output.commands = commands.map((cmd) => ({
      package: cmd.package,
      command: cmd.command,
      inputTokens: cmd.inputTokens,
      outputTokens: cmd.outputTokens,
      calls: cmd.calls,
    }));

    // Period breakdown (if --group specified)
    if (periodBuckets) {
      output.periods = periodBuckets.map((b) => ({
        period: b.period,
        ...b.usage,
        estimatedCost: {
          total: b.estimatedCost.total,
          inputCost: b.estimatedCost.inputCost,
          outputCost: b.estimatedCost.outputCost,
        },
      }));
      output.group = group;
    }

    // Only include filter if filters were applied
    if (tokenFilter.since || tokenFilter.until) {
      const filter: Record<string, string> = {};
      if (tokenFilter.since) filter.since = tokenFilter.since;
      if (tokenFilter.until) filter.until = tokenFilter.until;
      output.filter = filter;
    }

    // Budget status (when configured)
    if (budgetResult) {
      output.budget = {
        severity: budgetResult.severity,
        tokens: budgetResult.tokens,
        cost: budgetResult.cost,
        warnings: budgetResult.warnings,
      };
    }

    result(JSON.stringify(output, null, 2));
    return;
  }

  // Tree output
  for (const line of formatAggregateTokenUsage(usage)) {
    result(line);
  }

  // Detailed output (only when there is data)
  const total = usage.totalInputTokens + usage.totalOutputTokens;
  if (total > 0) {
    // Per-package breakdown
    info("");
    info("By package:");
    for (const line of formatPackageDetail(usage)) {
      info(line);
    }

    // Per-command breakdown
    if (commands.length > 0) {
      info("");
      info("By command:");
      for (const line of formatCommandDetail(commands)) {
        info(line);
      }
    }

    // Period breakdown
    if (periodBuckets && periodBuckets.length > 0) {
      info("");
      info(`By ${group}:`);
      for (const line of formatPeriodBuckets(periodBuckets)) {
        info(line);
      }
    }

    // Cost estimation
    info("");
    info(`Estimated cost: ${cost.total} (based on Sonnet pricing)`);
  }

  // Filter notice
  if (tokenFilter.since || tokenFilter.until) {
    const parts: string[] = [];
    if (tokenFilter.since) parts.push(`since ${tokenFilter.since}`);
    if (tokenFilter.until) parts.push(`until ${tokenFilter.until}`);
    info(`  (filtered: ${parts.join(", ")})`);
  }

  // Budget warnings
  if (budgetResult) {
    const budgetLines = formatBudgetWarnings(budgetResult);
    if (budgetLines.length > 0) {
      warn("");
      for (const line of budgetLines) {
        warn(line);
      }
    }

    if (budgetResult.severity === "exceeded" && config.budget?.abort) {
      throw new BudgetExceededError(budgetResult.warnings);
    }
  }
}
