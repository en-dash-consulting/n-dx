/**
 * `hench run --resolve` (`ndx work --task=<id> --resolve [flags] <dir>`).
 *
 * Reports what a run with these flags would use — every setting with the
 * config key that supplied it — and every reason it would refuse to start, as
 * one JSON object on stdout. The dashboard shows this before a run starts, so
 * it never re-derives hench's defaults itself.
 *
 * Resolution is the run's own: the same config load, the same flag parsing
 * (run-settings.ts), the same model chain (agent-model.ts), the same tree,
 * claim and status checks. Always resolved as an autonomous (`--auto`) run,
 * because that is the only kind the dashboard starts.
 *
 * It acts on nothing: no claim, no `--reset-deferred` write, no PRD write, no
 * git write, no vendor CLI spawn, no orientation session, no LLM call. Each
 * check that a run would throw on is reported as a refusal instead, so a
 * refused run still exits 0 with a complete report.
 */

import { dirname, join } from "node:path";
import { resolveStore, findItem, matchesAssignee, resolveActor } from "../../prd/rex-gateway.js";
import type { PRDItem } from "../../prd/rex-gateway.js";
import { LLM_VENDOR, REVIEW_MODELS, getGitCommonDir, resolveReviewModel } from "../../prd/llm-gateway.js";
import type { LLMVendor } from "../../prd/llm-gateway.js";
import { PERMISSION_MODES } from "../../schema/index.js";
import { loadConfig, loadConfiguredHenchKeys } from "../../store/config.js";
import { loadLLMConfig, resolveLLMVendor, resolveVendorCliPath } from "../../store/project-config.js";
import { resolveHenchPaths } from "../../store/paths.js";
import { excludeHenchRuntimeArtifacts } from "../../store/artifacts.js";
import { listDirtyPaths } from "../../agent/lifecycle/uncommitted-work-gate.js";
import { explicitTaskRefusal } from "../../agent/planning/brief.js";
import { reviewModelSource } from "../../agent/analysis/adversarial-review.js";
import { captureRunGitOrigin } from "../../process/git-origin.js";
import { TaskClaims, TaskClaimedElsewhereError } from "../../process/task-claims.js";
import { CLIError, requireLLMCLI } from "../errors.js";
import { result as output, warn } from "../output.js";
import { checkAgentModel } from "./agent-model.js";
import { VENDOR_PROVIDERS } from "./provider-support.js";
import { readTreeConformanceRefusal } from "./run.js";
import {
  parseBudgetFlags,
  parsePermissionModeFlag,
  parseReviewOptions,
  resolveRunPermissionMode,
  resolveRunProvider,
  reviewProviderError,
  selectCliModelOverride,
} from "./run-settings.js";

/** One resolved setting and the config key (or rule) that supplied it. */
export interface Resolved<T> {
  value: T;
  /**
   * `cli-flag`, `hench.<key>`, `hench.models.<vendor>`, an `llm.*` key,
   * `vendor-default`, `autonomous-default` or `built-in`.
   */
  source: string;
}

/** Why a run with these flags would refuse to start. */
export type RunRefusalCode =
  | "task-not-found"
  | "prd-unreadable"
  | "not-actionable"
  | "claimed-elsewhere"
  | "tree-not-conformant"
  | "vendor-unset"
  | "vendor-cli-missing"
  | "provider-unsupported"
  | "model-vendor-mismatch"
  | "dirty-tree";

export interface RunRefusal {
  code: RunRefusalCode;
  message: string;
  /** What to do about it, when the run's own error carries advice. */
  hint?: string;
  /** tree-not-conformant only: whether `rex migrate-slugs` fixes it. */
  migratable?: boolean;
}

/** A per-run option the dashboard may send, and how it reaches the command line. */
export interface RunOption {
  /** Key in {@link RunResolution.resolved}. */
  key: keyof ResolvedSettings;
  /** The `hench run` / `ndx work` flag, without the leading `--`. */
  flag: string;
  type: "enum" | "boolean" | "integer" | "string";
  /** Allowed values, for `enum`. */
  values?: readonly string[];
  /** `task`: shapes the agent's work. `launch`: how the run starts. */
  scope: "task" | "launch";
  description: string;
}

export interface ResolvedSettings {
  vendor: Resolved<LLMVendor>;
  model: Resolved<string>;
  provider: Resolved<string>;
  permissionMode: Resolved<string | null>;
  review: Resolved<boolean>;
  /** Always the reviewer a review would use; `review.value` says whether one runs. `vendorDefault` is the vendor's built-in. */
  reviewModel: Resolved<string> & { vendorDefault: string };
  reviewOptional: Resolved<boolean>;
  skipTestGate: Resolved<boolean>;
  maxTurns: Resolved<number>;
  tokenBudget: Resolved<number>;
  fresh: Resolved<boolean>;
  allowDirty: Resolved<boolean>;
  resetDeferred: Resolved<boolean>;
}

export interface RunResolution {
  /** The selected task, or null when the id is not in the PRD. */
  task: {
    id: string;
    title: string;
    status: string;
    level: string;
    blockedBy: string[];
    claimedBy: { worktree: string; pid: number; expiresAt: string } | null;
  } | null;
  workspace: { root: string; branch: string | null; isAnchor?: boolean; dirty: boolean };
  resolved: ResolvedSettings;
  options: RunOption[];
  refusals: RunRefusal[];
  /** The `ndx work` command line a run with these settings is. */
  command: string;
}

/**
 * Flags that change what a run does but are not settings the dashboard edits,
 * so they are not in {@link RUN_OPTIONS}. The command line still carries them:
 * dropping one prints a command that behaves differently (`--mine` scopes
 * `--reset-deferred` to the operator's own tasks).
 */
const PASSTHROUGH_FLAGS: ReadonlyArray<{ flag: string; type: "boolean" | "string" }> = [
  { flag: "mine", type: "boolean" },
  { flag: "priority", type: "string" },
  { flag: "context-file", type: "string" },
];

/**
 * Every per-run option, in command-line order. Values for `provider` are
 * narrowed to the active vendor's providers in the report.
 */
const RUN_OPTIONS: readonly RunOption[] = [
  { key: "model", flag: "model", type: "string", scope: "task", description: "Model the agent runs on, overriding hench.models and llm.* for this run." },
  { key: "provider", flag: "provider", type: "enum", values: ["cli", "api"], scope: "task", description: "Drive the vendor CLI or call its API directly." },
  { key: "permissionMode", flag: "permission-mode", type: "enum", values: PERMISSION_MODES, scope: "task", description: "Permission mode for the spawned Claude session (Claude only)." },
  { key: "review", flag: "review", type: "boolean", scope: "task", description: "Run the adversarial review pass after the task validates, before the commit." },
  { key: "reviewModel", flag: "review-model", type: "string", scope: "task", description: "Model the reviewer runs on (requires review)." },
  { key: "reviewOptional", flag: "review-optional", type: "boolean", scope: "task", description: "Downgrade the missing-review gate to a warning when the reviewer cannot start (requires review)." },
  { key: "skipTestGate", flag: "skip-test-gate", type: "boolean", scope: "task", description: "Skip the full test suite gate before the commit." },
  { key: "maxTurns", flag: "max-turns", type: "integer", scope: "task", description: "Turn limit for the agent loop (API provider)." },
  { key: "tokenBudget", flag: "token-budget", type: "integer", scope: "task", description: "Token budget for the run; 0 means unlimited." },
  { key: "fresh", flag: "fresh", type: "boolean", scope: "launch", description: "Discard the cached orientation session so the run re-orients." },
  { key: "allowDirty", flag: "allow-dirty", type: "boolean", scope: "launch", description: "Start even though the working tree has uncommitted changes." },
  { key: "resetDeferred", flag: "reset-deferred", type: "boolean", scope: "launch", description: "Reset deferred and failing tasks to pending before the run." },
];

/** Print the resolution as the only thing on stdout. */
export async function cmdResolve(dir: string, flags: Record<string, string>): Promise<void> {
  output(JSON.stringify(await resolveRun(dir, flags), null, 2));
}

/**
 * Resolve the run `hench run --task=<id> --auto [flags] <dir>` would be.
 *
 * @throws {CLIError} Without `--task`, or on flags a run would reject outright
 *   (an invalid `--permission-mode`, `--review-model` without `--review`, a
 *   non-numeric budget) — those are malformed requests, not refusals.
 */
export async function resolveRun(dir: string, flags: Record<string, string>): Promise<RunResolution> {
  const taskId = flags.task;
  if (!taskId || taskId === "true") {
    throw new CLIError(
      "--resolve requires --task=<id>.",
      "Resolve reports the settings of one task's run: ndx work --task=<id> --resolve .",
    );
  }

  // Flag parsing a run would throw on, before anything is read.
  const reviewOpts = parseReviewOptions(flags);
  const permissionModeFlag = parsePermissionModeFlag(flags);
  const budgets = parseBudgetFlags(flags);

  const henchDir = resolveHenchPaths(dir).henchDir;
  const config = await loadConfig(henchDir, { onInvalid: "use-defaults", onWarning: (m) => warn(m) });
  const configured = await loadConfiguredHenchKeys(henchDir);
  const henchSource = (key: string): string => (configured.has(key) ? `hench.${key}` : "built-in");
  const rexDir = join(dir, config.rexDir);
  const llmConfig = await loadLLMConfig(henchDir);
  const vendor = resolveLLMVendor(llmConfig);
  const refusals: RunRefusal[] = [];
  const refuse = (code: RunRefusalCode, err: CLIError, extra: Partial<RunRefusal> = {}): void => {
    refusals.push({ code, message: err.message, ...(err.suggestion ? { hint: err.suggestion } : {}), ...extra });
  };

  // ── Task ────────────────────────────────────────────────────────────────
  // A PRD that cannot be parsed is a refusal the dashboard can show, not a crash
  // that leaves it with no JSON.
  let prdItems: PRDItem[] | null = null;
  try {
    prdItems = (await (await resolveStore(rexDir)).loadDocument()).items;
  } catch (err) {
    refuse(
      "prd-unreadable",
      new CLIError(
        `The PRD could not be read: ${err instanceof Error ? err.message : String(err)}`,
        "Fix or restore the corrupt file under .rex/, then try again.",
      ),
    );
  }
  const entry = prdItems ? findItem(prdItems, taskId) : null;
  let task: RunResolution["task"] = null;
  if (!prdItems) {
    // Already refused above; there is no task to describe.
  } else if (!entry) {
    refuse("task-not-found", new CLIError(`Task not found: ${taskId}`, "Check the id with 'ndx status'."));
  } else {
    const claim = await TaskClaims.forProject(dir, { readOnly: true }).heldElsewhere(taskId);
    task = {
      id: entry.item.id,
      title: entry.item.title,
      status: entry.item.status,
      level: entry.item.level,
      blockedBy: entry.item.blockedBy ?? [],
      claimedBy: claim ? { worktree: claim.worktreeRoot, pid: claim.pid, expiresAt: claim.expiresAt } : null,
    };
    if (!(await wouldBeReset(entry.item, entry.parents, flags, dir))) {
      const notActionable = explicitTaskRefusal(entry.item);
      if (notActionable) refuse("not-actionable", notActionable);
    }
    if (claim) refuse("claimed-elsewhere", new TaskClaimedElsewhereError(taskId, claim, entry.item.title));
  }

  const treeRefusal = prdItems ? await readTreeConformanceRefusal(rexDir) : null;
  if (treeRefusal) {
    refusals.push({ code: "tree-not-conformant", message: treeRefusal.message, migratable: treeRefusal.migratable });
  }

  // ── Vendor and model ────────────────────────────────────────────────────
  if (!llmConfig.vendor) {
    refuse(
      "vendor-unset",
      new CLIError(
        "No LLM vendor configured for this project.",
        "Run 'ndx config llm.vendor claude' (or codex, google, local) to choose one.",
      ),
    );
  }
  const modelOverride = selectCliModelOverride(flags, vendor);
  const agentModel = checkAgentModel({
    vendor,
    cliModelOverride: modelOverride.value,
    henchModels: config.models,
    llmConfig,
  });
  if (agentModel.mismatch) refuse("model-vendor-mismatch", agentModel.mismatch);

  // ── Provider ────────────────────────────────────────────────────────────
  const requestedProvider = flags.provider ?? config.provider;
  const provider = resolveRunProvider(requestedProvider, vendor);
  if (provider.error) refuse("provider-unsupported", provider.error);
  const reviewError = reviewOpts.reviewPass ? reviewProviderError(vendor, provider.provider) : undefined;
  if (reviewError) refuse("provider-unsupported", reviewError);
  if (!provider.error && provider.provider === "cli" && vendor !== LLM_VENDOR.GOOGLE && vendor !== LLM_VENDOR.LOCAL) {
    // Looks the binary up on disk / PATH; the CLI itself is never started.
    try {
      requireLLMCLI(vendor, resolveVendorCliPath(llmConfig));
    } catch (err) {
      if (!(err instanceof CLIError)) throw err;
      refuse("vendor-cli-missing", err);
    }
  }

  // ── Working tree ────────────────────────────────────────────────────────
  const origin = captureRunGitOrigin(dir);
  const root = origin.worktreeRoot ?? dir;
  const commonDir = getGitCommonDir(dir);
  const dirty = (await excludeHenchRuntimeArtifacts(await listDirtyPaths(dir), dir)).length > 0;
  const allowDirty = flags["allow-dirty"] === "true";
  if (dirty && !allowDirty) {
    refuse(
      "dirty-tree",
      new CLIError(
        "Refusing to start an autonomous run with uncommitted changes in the working tree.",
        "Commit or stash them, or pass --allow-dirty to proceed anyway.",
      ),
    );
  }

  // ── Settings ────────────────────────────────────────────────────────────
  const permission = resolveRunPermissionMode({
    flag: permissionModeFlag,
    configured: config.permissionMode,
    autonomous: true,
    vendor,
  });
  const flagged = (flag: string): Resolved<boolean> =>
    flags[flag] === "true" ? { value: true, source: "cli-flag" } : { value: false, source: "built-in" };

  const resolved: ResolvedSettings = {
    vendor: { value: vendor, source: llmConfig.vendor ? "llm.vendor" : "built-in" },
    model: { value: agentModel.model, source: agentModel.rung },
    provider: {
      value: provider.provider,
      source: provider.switched ? "vendor-default" : flags.provider !== undefined ? "cli-flag" : henchSource("provider"),
    },
    permissionMode: {
      value: permission.value ?? null,
      source:
        permission.dropped !== undefined || permission.value === undefined
          ? "built-in"
          : permission.origin === "config"
            ? "hench.permissionMode"
            : permission.origin,
    },
    review: flagged("review"),
    reviewModel: {
      value: resolveReviewModel(vendor, llmConfig, reviewOpts.reviewModel),
      source: reviewModelKey(vendor, reviewModelSource(vendor, llmConfig, reviewOpts.reviewModel)),
      vendorDefault: REVIEW_MODELS[vendor] ?? "",
    },
    reviewOptional: reviewOpts.reviewOptional
      ? { value: true, source: "cli-flag" }
      : { value: false, source: "built-in" },
    skipTestGate:
      flags["skip-test-gate"] === "true"
        ? { value: true, source: "cli-flag" }
        : config.skipFullTestGate !== undefined
          ? { value: config.skipFullTestGate, source: "hench.skipFullTestGate" }
          : { value: false, source: "built-in" },
    maxTurns:
      budgets.maxTurns !== undefined
        ? { value: budgets.maxTurns, source: "cli-flag" }
        : { value: config.maxTurns, source: henchSource("maxTurns") },
    tokenBudget:
      budgets.tokenBudget !== undefined
        ? { value: budgets.tokenBudget, source: "cli-flag" }
        : { value: config.tokenBudget, source: henchSource("tokenBudget") },
    fresh: flagged("fresh"),
    allowDirty: flagged("allow-dirty"),
    resetDeferred: flagged("reset-deferred"),
  };

  return {
    task,
    workspace: {
      root,
      branch: origin.branch ?? null,
      ...(commonDir ? { isAnchor: dirname(commonDir) === root } : {}),
      dirty,
    },
    resolved,
    options: RUN_OPTIONS.map((option) =>
      option.key === "provider" ? { ...option, values: VENDOR_PROVIDERS[vendor] } : { ...option },
    ),
    refusals,
    command: formatRunCommand(taskId, dir, flags, modelOverride.value),
  };
}

/**
 * Whether `--reset-deferred` would return this deferred task to pending before
 * the run selects it — scoped to the operator's own items under `--mine`, as
 * the reset is.
 */
async function wouldBeReset(
  item: PRDItem,
  parents: PRDItem[],
  flags: Record<string, string>,
  dir: string,
): Promise<boolean> {
  if (flags["reset-deferred"] !== "true" || item.status !== "deferred") return false;
  if (flags.mine !== "true") return true;
  return matchesAssignee(item, parents, await resolveActor(dir));
}

/** The config key behind each `reviewModelSource` answer. */
function reviewModelKey(vendor: LLMVendor, source: ReturnType<typeof reviewModelSource>): string {
  if (source === "flag") return "cli-flag";
  if (source === "vendor-config") return `llm.${vendor}.reviewModel`;
  if (source === "shared-config") return "llm.reviewModel";
  return "vendor-default";
}

/** Quote a command-line word for a POSIX shell only when it needs it. */
function shellWord(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}

/**
 * The `ndx work` command a run with these settings is: the task, `--auto`,
 * then each run option the flags carry in {@link RUN_OPTIONS} order, then the
 * {@link PASSTHROUGH_FLAGS}. A model
 * given as `--<vendor>-model` is written as `--model`, which it is equivalent
 * to and which outranks it.
 */
function formatRunCommand(
  taskId: string,
  dir: string,
  flags: Record<string, string>,
  model: string | undefined,
): string {
  const words = ["ndx", "work", `--task=${shellWord(taskId)}`, "--auto"];
  for (const option of RUN_OPTIONS) {
    const value = option.key === "model" ? model : flags[option.flag];
    if (value === undefined) continue;
    if (option.type === "boolean") {
      if (value === "true") words.push(`--${option.flag}`);
    } else {
      words.push(`--${option.flag}=${shellWord(value)}`);
    }
  }
  for (const { flag, type } of PASSTHROUGH_FLAGS) {
    const value = flags[flag];
    if (value === undefined) continue;
    if (type === "boolean") {
      if (value === "true") words.push(`--${flag}`);
    } else {
      words.push(`--${flag}=${shellWord(value)}`);
    }
  }
  words.push(shellWord(dir));
  return words.join(" ");
}
