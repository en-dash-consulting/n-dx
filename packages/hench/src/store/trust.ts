/**
 * Applying repository trust to a run.
 *
 * `@n-dx/llm-client` decides whether this user trusts what the checkout
 * ships as execution config (see its `repo-trust` module). This module is
 * hench's side of that decision: while a repository is *not* trusted, the
 * guard it declares is clamped to the baseline for the project's detected
 * language (marker files, not the config's `language`) —
 * allowlists intersect, blocked paths union — and a `bypassPermissions`
 * permission mode is lowered to `acceptEdits`, a `claudePath` or `apiKeyEnv`
 * it ships gives way to the user's `.n-dx.local.json` one (`apiKeyEnv` else
 * to the default `ANTHROPIC_API_KEY`), and the `guard.env.allow`
 * entries it ships are dropped (the user's `.n-dx.local.json` entries and
 * every `deny` entry stay). A `.n-dx.local.json` git tracks is the
 * repository's, so neither its `claudePath` nor its `allow` entries survive
 * the clamp. The repository's config can
 * only ever tighten what the user's own defaults allow. At baseline, a
 * root-anchored blocked path the baseline lists at any depth (an older
 * `node_modules/**`) is widened to that form.
 *
 * Two things this does not do. It does not refuse to run: an unattended
 * `ndx work --loop` on a fresh clone should still make progress, just under
 * the defaults, with the warning in its output and on the run record. And it
 * does not govern the vendor CLI's own tool calls: when `provider` is `cli`,
 * Claude Code or Codex executes tools under its own permission system, and
 * hench's guard applies only to hench's own tool loop. The permission-mode
 * clamp is what reaches a CLI run, with one exception that holds whatever the
 * trust state: n-dx's own config files (`NDX_CONFIG_BLOCKED_PATHS`) are
 * refused by the guard and denied to the Claude CLI's edit tools.
 *
 * @module hench/store/trust
 */

import { readFileSync } from "node:fs";
import {
  clampGuardToBaseline,
  evaluateRepoTrust,
  formatRepoTrustReport,
  guardBaselineForLanguage,
  resolveLayout,
  type RepoTrustEvaluation,
  type RepoTrustStoreOptions,
} from "../prd/llm-gateway.js";
import { DEFAULT_HENCH_CONFIG, type HenchConfig, type PermissionMode, type RunTrustRecord } from "../schema/index.js";

export interface RepoTrustApplied {
  evaluation: RepoTrustEvaluation;
  /** The config to run with: clamped when restricted, root dependency blocks widened at baseline, the input when trusted. */
  config: HenchConfig;
  /** The permission mode to run with: lowered from bypassPermissions when restricted. */
  permissionMode: PermissionMode | undefined;
  /** True when the guard, the environment policy, a binary/credential key or the permission mode was changed. */
  clamped: boolean;
}

/**
 * The `hench` section of the user's own `.n-dx.local.json`, which is
 * git-ignored and therefore theirs: a `claudePath` or `apiKeyEnv` set there
 * survives the clamp. Read directly rather than through the async override
 * loader because the clamp is applied synchronously per task.
 */
function localHenchOverrides(projectDir: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(resolveLayout(projectDir).localConfigFile, "utf-8"));
    const hench = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).hench
      : undefined;
    return hench && typeof hench === "object" && !Array.isArray(hench) ? (hench as Record<string, unknown>) : {};
  } catch {
    return {};
  }
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
  if (evaluation.state === "trusted") {
    return { evaluation, config, permissionMode, clamped: false };
  }
  // The detected language, never `config.language`: that is the repository's
  // own claim, and a JS checkout declaring swift would keep xcodebuild.
  const baseline = guardBaselineForLanguage(evaluation.config.detectedLanguage);
  if (!evaluation.restricted) {
    // A guard `ndx init` wrote before the dependency blocks reached any depth
    // lists only `node_modules/**`, reads as baseline, and would otherwise
    // leave packages/*/node_modules writable. Each root-anchored entry whose
    // `**/` form the baseline lists gains that form. Nothing the guard dropped
    // is re-added: at baseline that is the user's choice to make.
    const anyDepth = baseline.blockedPaths.filter((p) => p.startsWith("**/"));
    const widened = anyDepth.filter((p) => config.guard.blockedPaths.includes(p.slice(3)));
    const blockedPaths = [...new Set([...config.guard.blockedPaths, ...widened])];
    if (blockedPaths.length === config.guard.blockedPaths.length) {
      return { evaluation, config, permissionMode, clamped: false };
    }
    return { evaluation, config: { ...config, guard: { ...config.guard, blockedPaths } }, permissionMode, clamped: true };
  }
  // A local file the repository commits is its config, not the user's, and
  // the checkout is restricted here: none of it applies.
  const local = evaluation.config.localConfigTracked ? undefined : localHenchSection(projectDir);
  // `guard.env.allow` names credentials the agent's shell keeps, so only the
  // user's own `.n-dx.local.json` may add entries here; `deny` only removes.
  const localAllow = stringList(local?.guard?.env?.allow);
  const envAllow = config.guard.env?.allow ?? [];
  const envAllowChanged = envAllow.some((v) => !localAllow.includes(v));
  const env = config.guard.env || localAllow.length ? { ...config.guard.env, allow: localAllow } : undefined;
  const guard = { ...clampGuardToBaseline(config.guard, baseline), ...(env ? { env } : {}) };
  const lowered = permissionMode === "bypassPermissions" ? "acceptEdits" : permissionMode;
  const guardChanged =
    guard.allowedCommands.length !== config.guard.allowedCommands.length
    || guard.allowedGitSubcommands.length !== config.guard.allowedGitSubcommands.length
    || guard.blockedPaths.length !== config.guard.blockedPaths.length
    || envAllowChanged;
  const withheld = withoutRepositoryTestCommands(config, evaluation);
  const testCommandsWithheld =
    withheld.fullTestCommand !== config.fullTestCommand
    || withheld.testGate?.command !== config.testGate?.command
    || withheld.testGate?.rerunCommand !== config.testGate?.rerunCommand;
  // `claudePath` picks the binary a Claude run spawns, so only the user's own
  // `.n-dx.local.json` may set it here; the repository's copy is dropped.
  const { claudePath, ...rest } = withheld;
  const localClaudePath = typeof local?.claudePath === "string" && local.claudePath ? local.claudePath : undefined;
  // `apiKeyEnv` names the variable the API loop sends as the Anthropic key, so
  // the repository's choice gives way to the user's own or the default.
  const apiKeyEnv = typeof local?.apiKeyEnv === "string" && local.apiKeyEnv
    ? local.apiKeyEnv
    : DEFAULT_HENCH_CONFIG().apiKeyEnv;
  return {
    evaluation,
    config: { ...rest, ...(localClaudePath ? { claudePath: localClaudePath } : {}), apiKeyEnv, guard },
    permissionMode: lowered,
    clamped: guardChanged || lowered !== permissionMode || claudePath !== localClaudePath || apiKeyEnv !== config.apiKeyEnv
      || testCommandsWithheld,
  };
}

/**
 * The config with the test commands the repository set removed, so the gate
 * falls back to auto-detection as it would on a checkout that set none.
 *
 * Only a value the review read is removed: one that differs came from a layer
 * the review treats as the user's own (`.n-dx.local.json`), and stays.
 */
function withoutRepositoryTestCommands(config: HenchConfig, evaluation: RepoTrustEvaluation): HenchConfig {
  const reviewed = new Map<string, string>(evaluation.config.gateTestCommands.map((c) => [c.key, c.command]));
  const keep = (key: string, value: string | undefined) =>
    value !== undefined && reviewed.get(key) !== value ? value : undefined;
  const { fullTestCommand, testGate, ...rest } = config;
  const full = keep("fullTestCommand", fullTestCommand);
  const command = keep("testGate.command", testGate?.command);
  const rerunCommand = keep("testGate.rerunCommand", testGate?.rerunCommand);
  const gateRest = { ...testGate };
  delete gateRest.command;
  delete gateRest.rerunCommand;
  return {
    ...rest,
    ...(full !== undefined ? { fullTestCommand: full } : {}),
    ...(testGate
      ? { testGate: { ...gateRest, ...(command !== undefined ? { command } : {}), ...(rerunCommand !== undefined ? { rerunCommand } : {}) } }
      : {}),
    // The resolver's own `.n-dx.json` read returns only repository content.
    repositoryTestCommandsWithheld: true,
  };
}

interface LocalHenchSection {
  claudePath?: unknown;
  apiKeyEnv?: unknown;
  guard?: { env?: { allow?: unknown } };
}

/** The `hench` section of the machine-local config file, which the repository does not ship. */
function localHenchSection(projectDir: string): LocalHenchSection | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolveLayout(projectDir).localConfigFile, "utf-8"));
  } catch {
    // Absent or unreadable: the user set nothing locally.
    return undefined;
  }
  const hench = parsed && typeof parsed === "object" ? (parsed as { hench?: unknown }).hench : undefined;
  return hench && typeof hench === "object" ? (hench as LocalHenchSection) : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
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
