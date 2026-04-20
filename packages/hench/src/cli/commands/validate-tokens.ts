/**
 * CLI command: validate Codex token reporting accuracy.
 *
 * Usage:
 *   hench validate-tokens [--format=json] [--strict] [dir]
 *
 * Validates token reporting across all runs in .hench/runs/, checking for:
 *   - Non-zero token values in Codex runs
 *   - Outlier detection (tokens outside expected ranges)
 *   - Vendor attribution accuracy
 *   - Codex vs Claude comparability (when multiple runs exist)
 *
 * Returns exit code 1 if validation fails (with --strict flag).
 * Otherwise returns a summary report and exits 0.
 */

import { listRuns } from "../../store/runs.js";
import {
  validateTokenReporting,
  validateTokenReportingBatch,
  compareCodexAndClaude,
  validateVendorAttribution,
} from "../../quota/index.js";
import { section, subsection, stream, detail, info } from "../../types/output.js";
import type { RunRecord } from "../../schema/index.js";

interface ValidateTokensOptions {
  format?: string;
  strict?: string;
  limit?: string;
  "codex-only"?: string;
}

function findCodexAndClaudeRunPairs(runs: RunRecord[]): Array<[RunRecord, RunRecord]> {
  const byTaskId = new Map<string, { codex: RunRecord[]; claude: RunRecord[] }>();

  for (const run of runs) {
    const isCodex = run.turnTokenUsage?.some((t) => t.vendor === "codex") ?? false;
    const key = run.taskId;

    if (!byTaskId.has(key)) {
      byTaskId.set(key, { codex: [], claude: [] });
    }

    const bucket = byTaskId.get(key)!;
    if (isCodex) {
      bucket.codex.push(run);
    } else {
      bucket.claude.push(run);
    }
  }

  // Pair newest Codex with newest Claude for each task
  const pairs: Array<[RunRecord, RunRecord]> = [];
  for (const [, { codex, claude }] of byTaskId) {
    if (codex.length > 0 && claude.length > 0) {
      // Use the newest of each
      pairs.push([codex[0], claude[0]]);
    }
  }

  return pairs;
}

function formatTextReport(options: ValidateTokensOptions, runs: RunRecord[]) {
  section("Token Reporting Validation");

  if (runs.length === 0) {
    info("No runs found in .hench/runs/");
    return;
  }

  // Batch validation
  subsection("Batch Summary");
  const summary = validateTokenReportingBatch(runs);

  stream("Runs analyzed", `${summary.totalRuns}`);
  stream("Passed", `${summary.passedRuns}`);
  stream("Warnings", `${summary.warningRuns}`);
  stream("Failed", `${summary.failedRuns}`);

  if (summary.commonIssues.length > 0) {
    subsection("Most Common Issues");
    for (const { issue, count } of summary.commonIssues.slice(0, 5)) {
      stream(`${count}x`, issue);
    }
  }

  if (summary.codexSummary) {
    subsection("Codex Summary");
    stream("Total Codex runs", `${summary.codexSummary.totalCodexRuns}`);
    stream("With non-zero tokens", `${summary.codexSummary.codexRunsWithNonZeroTokens}`);
    stream("With zero tokens", `${summary.codexSummary.codexRunsWithZeroTokens}`);
    stream("Avg tokens per run", `${summary.codexSummary.averageTokensPerCodexRun}`);
  }

  // Per-run validation
  if (options["codex-only"] !== "true" || summary.codexSummary) {
    subsection("Per-Run Details");

    for (const run of runs) {
      const result = validateTokenReporting(run);
      const isCodex = run.turnTokenUsage?.some((t) => t.vendor === "codex") ?? false;

      const vendorLabel = isCodex ? "[Codex]" : "[Claude]";
      const statusLabel = result.ok ? "✓" : "✗";

      stream(`${statusLabel} ${vendorLabel} ${run.id}`, `Task: ${run.taskTitle}`);

      if (result.issues.length > 0) {
        for (const issue of result.issues) {
          const icon = issue.severity === "error" ? "✗" : "⚠";
          detail(`  ${icon} ${issue.message}`);
        }
      } else {
        detail(`  All checks passed`);
      }

      detail(`  Tokens: ${result.metrics.totalInput} input / ${result.metrics.totalOutput} output`);
    }
  }

  // Codex vs Claude comparison
  const pairs = findCodexAndClaudeRunPairs(runs);
  if (pairs.length > 0) {
    subsection("Codex vs Claude Comparison");
    for (const [codexRun, claudeRun] of pairs) {
      const comparison = compareCodexAndClaude(codexRun, claudeRun);
      const statusLabel = comparison.comparable ? "✓" : "⚠";
      stream(`${statusLabel} ${codexRun.taskTitle}`, `Ratio: ${(100 * comparison.tokenRatio).toFixed(0)}%`);

      if (comparison.issues.length > 0) {
        for (const issue of comparison.issues) {
          detail(`  • ${issue}`);
        }
      }
    }
  }
}

function formatJsonReport(options: ValidateTokensOptions, runs: RunRecord[]) {
  const summary = validateTokenReportingBatch(runs);

  const runsReport = runs.map((run) => {
    const result = validateTokenReporting(run);
    const isCodex = run.turnTokenUsage?.some((t) => t.vendor === "codex") ?? false;
    const attributionIssues = validateVendorAttribution(run);

    return {
      id: run.id,
      taskId: run.taskId,
      taskTitle: run.taskTitle,
      vendor: isCodex ? "codex" : "claude",
      validation: {
        ok: result.ok,
        issues: result.issues,
      },
      attribution: {
        ok: attributionIssues.length === 0,
        issues: attributionIssues,
      },
      metrics: result.metrics,
    };
  });

  const comparison = findCodexAndClaudeRunPairs(runs).map(([codexRun, claudeRun]) => {
    const comp = compareCodexAndClaude(codexRun, claudeRun);
    return {
      codexRunId: comp.codexRunId,
      claudeRunId: comp.claudeRunId,
      comparable: comp.comparable,
      tokenRatio: comp.tokenRatio,
      issues: comp.issues,
    };
  });

  const output = {
    summary,
    runsReport,
    comparison,
  };

  console.log(JSON.stringify(output, null, 2));
}

/**
 * Validate token reporting across runs.
 *
 * @param henchDir Path to .hench/ directory
 * @param flags CLI flags: --format, --strict, --limit, --codex-only
 */
export async function cmdValidateTokens(henchDir: string, flags: ValidateTokensOptions): Promise<void> {
  const format = flags.format === "json" ? "json" : "text";
  const strict = flags.strict === "true";
  const limit = flags.limit ? parseInt(flags.limit, 10) : 20;
  const codexOnly = flags["codex-only"] === "true";

  // Load runs
  const allRuns = await listRuns(henchDir, limit);
  if (allRuns.length === 0) {
    info("No runs found in .hench/runs/");
    return;
  }

  const runs = codexOnly
    ? allRuns.filter((r) => r.turnTokenUsage?.some((t) => t.vendor === "codex") ?? false)
    : allRuns;

  // Format and output
  if (format === "json") {
    formatJsonReport(flags, runs);
  } else {
    formatTextReport(flags, runs);
  }

  // Exit code based on validation
  const summary = validateTokenReportingBatch(runs);
  const hasFailed = summary.failedRuns > 0;

  if (strict && hasFailed) {
    process.exit(1);
  }
}
