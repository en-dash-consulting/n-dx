/**
 * Applying repository trust to a run.
 *
 * `@n-dx/llm-client` decides whether this user trusts what the checkout
 * ships as execution config (see its `repo-trust` module). This module is
 * hench's side of that decision: while a repository is *not* trusted, the
 * guard it declares is clamped to the baseline for the project's language —
 * allowlists intersect, blocked paths union — and a `bypassPermissions`
 * permission mode is lowered to `acceptEdits`. The repository's config can
 * only ever tighten what the user's own defaults allow.
 *
 * Two things this does not do. It does not refuse to run: an unattended
 * `ndx work --loop` on a fresh clone should still make progress, just under
 * the defaults, with the warning in its output and on the run record. And it
 * does not govern the vendor CLI's own tool calls: when `provider` is `cli`,
 * Claude Code or Codex executes tools under its own permission system, and
 * hench's guard applies only to hench's own tool loop. The permission-mode
 * clamp is what reaches a CLI run.
 *
 * @module hench/store/trust
 */

import {
  clampGuardToBaseline,
  evaluateRepoTrust,
  formatRepoTrustReport,
  guardBaselineForLanguage,
  type RepoTrustEvaluation,
  type RepoTrustStoreOptions,
} from "../prd/llm-gateway.js";
import type { HenchConfig, PermissionMode, RunTrustRecord } from "../schema/index.js";

export interface RepoTrustApplied {
  evaluation: RepoTrustEvaluation;
  /** The config to run with: clamped when restricted, the input otherwise. */
  config: HenchConfig;
  /** The permission mode to run with: lowered from bypassPermissions when restricted. */
  permissionMode: PermissionMode | undefined;
  /** True when either the guard or the permission mode was changed. */
  clamped: boolean;
}

/**
 * Evaluate trust for `projectDir` and return the config and permission mode
 * a run should actually use. Pure apart from reading the repository and the
 * user's trust store; never throws on a missing or unreadable file.
 */
export function applyRepoTrust(
  config: HenchConfig,
  projectDir: string,
  permissionMode: PermissionMode | undefined,
  options: RepoTrustStoreOptions = {},
): RepoTrustApplied {
  const evaluation = evaluateRepoTrust(projectDir, options);
  if (!evaluation.restricted) {
    return { evaluation, config, permissionMode, clamped: false };
  }
  const baseline = guardBaselineForLanguage(config.language);
  const guard = clampGuardToBaseline(config.guard, baseline);
  const lowered = permissionMode === "bypassPermissions" ? "acceptEdits" : permissionMode;
  const guardChanged =
    guard.allowedCommands.length !== config.guard.allowedCommands.length
    || guard.allowedGitSubcommands.length !== config.guard.allowedGitSubcommands.length
    || guard.blockedPaths.length !== config.guard.blockedPaths.length;
  return {
    evaluation,
    config: { ...config, guard },
    permissionMode: lowered,
    clamped: guardChanged || lowered !== permissionMode,
  };
}

/** The summary a run record carries, from an evaluation. */
export function trustSummaryForRun(evaluation: RepoTrustEvaluation): RunTrustRecord {
  return {
    state: evaluation.state,
    digest: evaluation.config.digest,
    restricted: evaluation.restricted,
    findings: evaluation.findings.filter((f) => f.severity === "warning").map((f) => f.message),
  };
}

/**
 * The warning `ndx work` prints once per invocation for a restricted
 * repository. Wording comes from the shared formatter so the dashboard, the
 * init review and this line agree; the CLI-provider note is hench's own.
 */
export function formatTrustWarningForRun(evaluation: RepoTrustEvaluation, provider: string | undefined): string[] {
  const lines = formatRepoTrustReport(evaluation, { acceptCommand: "ndx trust accept ." });
  if (provider === "cli") {
    lines.push("  Note: with provider=cli the vendor CLI runs its own tools under its own permission system;");
    lines.push("  hench's guard governs only hench's tool loop. The permission-mode clamp above is what applies here.");
  }
  return lines;
}
