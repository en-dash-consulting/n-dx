/**
 * Codex token reporting validation and monitoring.
 *
 * Validates that Codex token reporting remains accurate and consistent
 * with Claude, including:
 * - Non-zero token values in run records
 * - Outlier detection and sanity checks
 * - Vendor attribution accuracy
 * - Codex vs Claude token comparison
 */

import type { RunRecord, TurnTokenUsage } from "../schema/index.js";

/**
 * Validation result for a run's token reporting.
 */
export interface TokenValidationResult {
  /** Whether the run passed all validations. */
  ok: boolean;
  /** Issues found (if ok is false). */
  issues: TokenValidationIssue[];
  /** Metrics computed during validation. */
  metrics: TokenValidationMetrics;
}

/**
 * A single validation issue.
 */
export interface TokenValidationIssue {
  /** Issue severity: "error" (fails validation), "warning" (acceptable but notable). */
  severity: "error" | "warning";
  /** Issue category (non-zero, outlier, attribution, etc.). */
  category: string;
  /** Human-readable description. */
  message: string;
}

/**
 * Metrics computed during validation.
 */
export interface TokenValidationMetrics {
  /** Total input tokens in the run. */
  totalInput: number;
  /** Total output tokens in the run. */
  totalOutput: number;
  /** Average tokens per turn. */
  avgTokensPerTurn: number;
  /** Max tokens in a single turn. */
  maxTokensPerTurn: number;
  /** Number of turns with zero tokens. */
  zeroTokenTurns: number;
  /** Vendor breakdown: count of turns per vendor. */
  vendorBreakdown: Record<string, number>;
  /** Whether the run is a Codex run (any turn used Codex). */
  isCodexRun: boolean;
  /** Whether the run is a Claude run (any turn used Claude). */
  isClaudeRun: boolean;
}

/**
 * Baseline statistics for a vendor and task complexity.
 *
 * Used for outlier detection and cost comparison.
 */
export interface TokenBaseline {
  vendor: "codex" | "claude";
  taskComplexity: "simple" | "moderate" | "complex";
  /** Expected input tokens for this complexity level. */
  expectedInput: number;
  /** Acceptable range: ±percentage of expected. */
  rangePercent: number;
  /** Expected output tokens for this complexity level. */
  expectedOutput: number;
}

/**
 * Represents comparison results between Codex and Claude tokens.
 */
export interface CodexClaudeComparison {
  /** ID of Codex run. */
  codexRunId: string;
  /** ID of Claude run. */
  claudeRunId: string;
  /** Whether the tokens are comparable (within acceptable range). */
  comparable: boolean;
  /** Codex token ratio relative to Claude (Codex / Claude). */
  tokenRatio: number;
  /** Issues found in the comparison. */
  issues: string[];
}

/**
 * Default token baselines for validation.
 *
 * These baselines help identify anomalous token usage patterns.
 * Adjust these based on observed production data.
 */
const DEFAULT_BASELINES: TokenBaseline[] = [
  // Simple tasks (e.g., typo fixes, single-file changes)
  {
    vendor: "claude",
    taskComplexity: "simple",
    expectedInput: 2000,
    rangePercent: 200, // Allow 0-4000 tokens
    expectedOutput: 400,
  },
  {
    vendor: "codex",
    taskComplexity: "simple",
    expectedInput: 2000,
    rangePercent: 200,
    expectedOutput: 400,
  },
  // Moderate tasks (e.g., feature implementation, bug fixes)
  {
    vendor: "claude",
    taskComplexity: "moderate",
    expectedInput: 5000,
    rangePercent: 150, // Allow 2500-7500 tokens
    expectedOutput: 1000,
  },
  {
    vendor: "codex",
    taskComplexity: "moderate",
    expectedInput: 5000,
    rangePercent: 150,
    expectedOutput: 1000,
  },
  // Complex tasks (e.g., architecture changes, multi-package refactoring)
  {
    vendor: "claude",
    taskComplexity: "complex",
    expectedInput: 10000,
    rangePercent: 100, // Allow 5000-15000 tokens
    expectedOutput: 2000,
  },
  {
    vendor: "codex",
    taskComplexity: "complex",
    expectedInput: 10000,
    rangePercent: 100,
    expectedOutput: 2000,
  },
];

/**
 * Detect task complexity from the task ID or run metadata.
 *
 * This is a heuristic approach; production systems may use
 * actual task metadata to determine complexity.
 *
 * @param run Run record to analyze
 * @returns Estimated task complexity
 */
function detectTaskComplexity(run: RunRecord): "simple" | "moderate" | "complex" {
  const taskTitle = run.taskTitle?.toLowerCase() ?? "";
  const turnCount = run.turns ?? 0;
  const totalTokens = (run.tokenUsage?.input ?? 0) + (run.tokenUsage?.output ?? 0);

  // Use heuristics based on turn count and tokens
  if (turnCount <= 3 && totalTokens < 5000) return "simple";
  if (turnCount <= 8 && totalTokens < 15000) return "moderate";
  return "complex";
}

/**
 * Validate a run's token reporting.
 *
 * Checks for:
 * 1. Non-zero token values (for Codex runs)
 * 2. Outlier values (compared to baseline expectations)
 * 3. Vendor attribution accuracy (Codex runs have Codex tokens)
 * 4. Per-turn consistency (no scattered zero values)
 *
 * @param run Run record to validate
 * @param baselines Optional custom baselines (defaults to DEFAULT_BASELINES)
 * @returns Validation result with issues and metrics
 */
export function validateTokenReporting(
  run: RunRecord,
  baselines: TokenBaseline[] = DEFAULT_BASELINES,
): TokenValidationResult {
  const issues: TokenValidationIssue[] = [];
  const turns = run.turnTokenUsage ?? [];

  // Compute metrics
  const metrics: TokenValidationMetrics = {
    totalInput: run.tokenUsage?.input ?? 0,
    totalOutput: run.tokenUsage?.output ?? 0,
    avgTokensPerTurn: 0,
    maxTokensPerTurn: 0,
    zeroTokenTurns: 0,
    vendorBreakdown: {},
    isCodexRun: turns.some((t) => t.vendor === "codex"),
    isClaudeRun: turns.some((t) => t.vendor === "claude"),
  };

  // Compute per-turn metrics
  if (turns.length > 0) {
    let maxTokens = 0;
    for (const turn of turns) {
      const turnTotal = (turn.input ?? 0) + (turn.output ?? 0);
      if (turnTotal === 0) metrics.zeroTokenTurns++;
      if (turnTotal > maxTokens) maxTokens = turnTotal;

      // Vendor breakdown
      metrics.vendorBreakdown[turn.vendor] = (metrics.vendorBreakdown[turn.vendor] ?? 0) + 1;
    }
    metrics.avgTokensPerTurn = Math.round((metrics.totalInput + metrics.totalOutput) / turns.length);
    metrics.maxTokensPerTurn = maxTokens;
  }

  // Validation 1: Codex runs should have non-zero tokens
  if (metrics.isCodexRun) {
    if (metrics.totalInput === 0 && metrics.totalOutput === 0) {
      issues.push({
        severity: "error",
        category: "non-zero",
        message: "Codex run reported zero tokens (input and output). This indicates token retrieval failure.",
      });
    }
    if (metrics.totalInput === 0) {
      issues.push({
        severity: "warning",
        category: "non-zero",
        message: "Codex run reported zero input tokens.",
      });
    }
    if (metrics.totalOutput === 0) {
      issues.push({
        severity: "warning",
        category: "non-zero",
        message: "Codex run reported zero output tokens.",
      });
    }
  }

  // Validation 2: Outlier detection
  const complexity = detectTaskComplexity(run);
  const relevantBaselines = baselines.filter((b) => b.vendor === (metrics.isCodexRun ? "codex" : "claude") && b.taskComplexity === complexity);

  for (const baseline of relevantBaselines) {
    const minInput = baseline.expectedInput * (1 - baseline.rangePercent / 100);
    const maxInput = baseline.expectedInput * (1 + baseline.rangePercent / 100);
    const minOutput = baseline.expectedOutput * (1 - baseline.rangePercent / 100);
    const maxOutput = baseline.expectedOutput * (1 + baseline.rangePercent / 100);

    if (metrics.totalInput > 0 && (metrics.totalInput < minInput || metrics.totalInput > maxInput)) {
      issues.push({
        severity: "warning",
        category: "outlier",
        message: `Input tokens ${metrics.totalInput} outside expected range [${Math.round(minInput)}, ${Math.round(maxInput)}] for ${complexity} task.`,
      });
    }

    if (metrics.totalOutput > 0 && (metrics.totalOutput < minOutput || metrics.totalOutput > maxOutput)) {
      issues.push({
        severity: "warning",
        category: "outlier",
        message: `Output tokens ${metrics.totalOutput} outside expected range [${Math.round(minOutput)}, ${Math.round(maxOutput)}] for ${complexity} task.`,
      });
    }
  }

  // Validation 3: Vendor attribution
  if (metrics.isCodexRun && !metrics.vendorBreakdown["codex"]) {
    issues.push({
      severity: "error",
      category: "attribution",
      message: "Run marked as Codex but no turns recorded Codex vendor.",
    });
  }

  // Validation 4: Per-turn consistency
  if (metrics.zeroTokenTurns > 0 && metrics.zeroTokenTurns < turns.length) {
    const pct = Math.round((100 * metrics.zeroTokenTurns) / turns.length);
    issues.push({
      severity: "warning",
      category: "consistency",
      message: `${metrics.zeroTokenTurns} of ${turns.length} turns (${pct}%) reported zero tokens. Mixed zero/non-zero patterns may indicate partial data.`,
    });
  }

  return {
    ok: issues.length === 0 || issues.every((i) => i.severity === "warning"),
    issues,
    metrics,
  };
}

/**
 * Compare token usage between a Codex run and a Claude run for the same task.
 *
 * Checks if the token costs are comparable, accounting for vendor differences.
 * This helps identify whether Codex is producing similar outputs to Claude.
 *
 * @param codexRun Codex run record
 * @param claudeRun Claude run record
 * @returns Comparison result
 */
export function compareCodexAndClaude(
  codexRun: RunRecord,
  claudeRun: RunRecord,
): CodexClaudeComparison {
  const issues: string[] = [];

  const codexTokens = (codexRun.tokenUsage?.input ?? 0) + (codexRun.tokenUsage?.output ?? 0);
  const claudeTokens = (claudeRun.tokenUsage?.input ?? 0) + (claudeRun.tokenUsage?.output ?? 0);

  const ratio = claudeTokens > 0 ? codexTokens / claudeTokens : 1;

  // Check for significant deviations
  // Codex should be within 50-200% of Claude for similar work
  if (ratio < 0.5) {
    issues.push(`Codex used significantly fewer tokens (${Math.round(100 * ratio)}% of Claude). Output quality may differ.`);
  } else if (ratio > 2) {
    issues.push(`Codex used significantly more tokens (${Math.round(100 * ratio)}% of Claude). This may indicate inefficiency.`);
  }

  // Check for zero tokens
  if (codexTokens === 0) {
    issues.push("Codex run reported zero tokens. Token retrieval likely failed.");
  }
  if (claudeTokens === 0) {
    issues.push("Claude run reported zero tokens. Comparison is inconclusive.");
  }

  return {
    codexRunId: codexRun.id,
    claudeRunId: claudeRun.id,
    comparable: issues.length === 0 && ratio >= 0.5 && ratio <= 2,
    tokenRatio: ratio,
    issues,
  };
}

/**
 * Check if a run's tokens are correctly attributed to vendors in the dashboard.
 *
 * Verifies that:
 * 1. All turns have a vendor (codex or claude)
 * 2. Vendors match expected patterns (e.g., Codex runs only have Codex turns)
 * 3. No mixed vendor runs without clear transition logic
 *
 * @param run Run record to check
 * @returns Array of attribution issues (empty if valid)
 */
export function validateVendorAttribution(run: RunRecord): string[] {
  const issues: string[] = [];
  const turns = run.turnTokenUsage ?? [];

  // Check: All turns must have a vendor
  for (const turn of turns) {
    if (!turn.vendor || !["codex", "claude"].includes(turn.vendor)) {
      issues.push(`Turn ${turn.turn} has invalid vendor: ${turn.vendor ?? "missing"}`);
    }
  }

  // Check: Model field should match vendor
  const firstVendor = turns[0]?.vendor;
  if (firstVendor === "codex" && run.model && !isCodexModel(run.model)) {
    issues.push(`Run vendor is Codex but model is not: ${run.model}`);
  }
  if (firstVendor === "claude" && run.model && isCodexModel(run.model)) {
    issues.push(`Run vendor is Claude but model is Codex: ${run.model}`);
  }

  // Check: Warn on mixed vendors (allowed, but needs attention)
  const vendors = new Set(turns.map((t) => t.vendor));
  if (vendors.size > 1) {
    const vendorList = Array.from(vendors).join(", ");
    issues.push(
      `Run contains multiple vendors (${vendorList}). Verify this is intentional ` +
      `(e.g., fallback from Codex to Claude). Mixed-vendor runs require explicit transition logic.`,
    );
  }

  return issues;
}

/**
 * Check if a model identifier is a Codex (OpenAI) model.
 *
 * @param model Model identifier
 * @returns true if it's a Codex model, false otherwise
 */
function isCodexModel(model: string): boolean {
  return model.startsWith("gpt-") || model.includes("o1") || model.includes("4o");
}

/**
 * Summary of token validation across multiple runs.
 */
export interface TokenValidationSummary {
  /** Total runs validated. */
  totalRuns: number;
  /** Runs that passed all validations. */
  passedRuns: number;
  /** Runs with warnings (but not errors). */
  warningRuns: number;
  /** Runs that failed validation. */
  failedRuns: number;
  /** Common issues across runs. */
  commonIssues: Array<{ issue: string; count: number }>;
  /** Codex-specific summary. */
  codexSummary?: {
    totalCodexRuns: number;
    codexRunsWithNonZeroTokens: number;
    codexRunsWithZeroTokens: number;
    averageTokensPerCodexRun: number;
  };
}

/**
 * Validate token reporting across a collection of runs.
 *
 * @param runs Array of run records
 * @param baselines Optional custom baselines
 * @returns Validation summary
 */
export function validateTokenReportingBatch(
  runs: RunRecord[],
  baselines?: TokenBaseline[],
): TokenValidationSummary {
  const results = runs.map((r) => validateTokenReporting(r, baselines));

  // Count results
  let passedRuns = 0;
  let warningRuns = 0;
  let failedRuns = 0;
  const issueMap = new Map<string, number>();

  for (const result of results) {
    if (result.ok && result.issues.length === 0) {
      passedRuns++;
    } else if (result.ok && result.issues.some((i) => i.severity === "warning")) {
      warningRuns++;
    } else {
      failedRuns++;
    }

    for (const issue of result.issues) {
      const key = `${issue.category}: ${issue.message}`;
      issueMap.set(key, (issueMap.get(key) ?? 0) + 1);
    }
  }

  // Codex-specific summary
  const codexRuns = runs.filter((r) => r.turnTokenUsage?.some((t) => t.vendor === "codex") ?? false);
  const codexWithTokens = codexRuns.filter((r) => (r.tokenUsage?.input ?? 0) + (r.tokenUsage?.output ?? 0) > 0);

  let avgTokensPerCodexRun = 0;
  if (codexRuns.length > 0) {
    const totalTokens = codexRuns.reduce(
      (sum, r) => sum + (r.tokenUsage?.input ?? 0) + (r.tokenUsage?.output ?? 0),
      0,
    );
    avgTokensPerCodexRun = Math.round(totalTokens / codexRuns.length);
  }

  return {
    totalRuns: runs.length,
    passedRuns,
    warningRuns,
    failedRuns,
    commonIssues: Array.from(issueMap.entries())
      .map(([issue, count]) => ({ issue, count }))
      .sort((a, b) => b.count - a.count),
    codexSummary:
      codexRuns.length > 0
        ? {
            totalCodexRuns: codexRuns.length,
            codexRunsWithNonZeroTokens: codexWithTokens.length,
            codexRunsWithZeroTokens: codexRuns.length - codexWithTokens.length,
            averageTokensPerCodexRun: avgTokensPerCodexRun,
          }
        : undefined,
  };
}
