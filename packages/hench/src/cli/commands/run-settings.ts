/**
 * The flag → setting decisions `hench run` makes before it does anything.
 *
 * Extracted from `cmdRun` so `ndx work --resolve` reports what a run would use
 * by calling the code the run calls, not a copy of it. Each function here is
 * pure: the caller decides whether a returned error is thrown (a run) or
 * reported (resolve).
 */

import type { LLMConfig, LLMVendor } from "../../prd/llm-gateway.js";
import {
  LLM_VENDOR,
  REVIEW_MODELS,
  isModelCompatibleWithVendor,
  resolveModel,
  resolveReviewModel,
  resolveTaskModel,
} from "../../prd/llm-gateway.js";
import { validateRunSettings } from "../../prd/rex-gateway.js";
import type { PRDItem, RunSettings } from "../../prd/rex-gateway.js";
import type { HenchConfig, PermissionMode } from "../../schema/index.js";
import { PERMISSION_MODES, isPermissionMode } from "../../schema/index.js";
import { reviewModelSource } from "../../agent/analysis/adversarial-review.js";
import { CLIError } from "../errors.js";
import { checkAgentModel } from "./agent-model.js";
import type { AgentModelSource } from "./agent-model.js";
import { safeParseInt, safeParseNonNegInt } from "./constants.js";
import { isProviderSupported } from "./provider-support.js";
import type { HenchProvider } from "./provider-support.js";

/**
 * The portable tier a saved `run` block may name. Derived from rex's own field
 * rather than re-exported through the gateway, so it cannot drift from the
 * validator's definition and costs the gateway no export.
 */
type RunSettingTier = NonNullable<RunSettings["tier"]>;

/**
 * The two independent review controls, bundled so the run functions keep a
 * single positional slot for them.
 *
 * They are genuinely independent and may both be on. The adversarial pass runs
 * first, so its must-fix repairs are already in the tree when the diff gate
 * shows a human what they are approving.
 */
export interface ReviewOptions {
  /** `--approve-diff` — show the diff and prompt before finalizing. */
  approveDiff: boolean;
  /** `--review` — run the adversarial review pass after validation. */
  reviewPass: boolean;
  /** `--review-model` — override the model the reviewer runs on. */
  reviewModel?: string;
  /**
   * `--review-optional` — downgrade the missing-review gate to a warning.
   *
   * Off by default: `--review` is an opt-in gate, and a gate that silently
   * no-ops when its reviewer cannot start is worse than no gate at all.
   */
  reviewOptional: boolean;
  /**
   * `--no-review` — no review pass for this run, whatever the task saved.
   *
   * Distinct from the absence of `--review`: absence says nothing and lets a
   * task's `run.review` decide, while this overrules it. Saved `reviewModel`
   * and `reviewOptional` go with it — there is no reviewer for them to
   * configure.
   */
  noReview: boolean;
}

/**
 * The model override the command line carries for `vendor`: the
 * vendor-neutral `--model`, else the vendor-specific `--<vendor>-model`.
 * The vendor-specific pair is also recognized by `ndx init`, so
 * `ndx work --claude-model=…` works end-to-end.
 */
export function selectCliModelOverride(
  flags: Record<string, string>,
  vendor: LLMVendor,
): { value: string | undefined; flag: string | undefined } {
  if (flags.model !== undefined) return { value: flags.model, flag: "model" };
  const flag =
    vendor === LLM_VENDOR.CLAUDE
      ? "claude-model"
      : vendor === LLM_VENDOR.CODEX
        ? "codex-model"
        : "google-model";
  return flags[flag] !== undefined ? { value: flags[flag], flag } : { value: undefined, flag: undefined };
}

/**
 * Parse `--review`, `--approve-diff`, `--review-model` and `--review-optional`.
 *
 * `--review` selects the adversarial review pass; the interactive
 * diff-approval gate that used to own this flag moved to `--approve-diff`.
 *
 * @throws {CLIError} On an empty `--review-model`, or a companion flag passed
 *   without `--review`.
 */
export function parseReviewOptions(flags: Record<string, string>): ReviewOptions {
  const reviewPass = flags.review === "true";
  const noReview = flags["no-review"] === "true";
  const approveDiff = flags["approve-diff"] === "true";
  // Asking for a review and refusing one in the same breath has no reading
  // that is obviously right, and guessing either way silently gives the
  // operator the opposite of half their command line.
  if (reviewPass && noReview) {
    throw new CLIError(
      "--review and --no-review were both passed.",
      "Keep whichever one you meant: --review runs the adversarial pass, --no-review suppresses one the task saved.",
    );
  }
  const reviewModelFlag = flags["review-model"];
  if (reviewModelFlag !== undefined && !reviewModelFlag.trim()) {
    throw new CLIError(
      "--review-model requires a model id.",
      "Example: --review-model=claude-opus-5-5. Omit the flag to use the recommended default for your vendor.",
    );
  }
  if (reviewModelFlag && noReview) {
    throw new CLIError(
      "--review-model was passed with --no-review.",
      "There is no review pass to give a model to. Drop one of the two.",
    );
  }
  if (reviewModelFlag && !reviewPass) {
    throw new CLIError(
      "--review-model was passed without --review.",
      "The review model only applies to the adversarial review pass. Add --review, or drop --review-model.",
    );
  }
  const reviewOptional = flags["review-optional"] === "true";
  if (reviewOptional && noReview) {
    throw new CLIError(
      "--review-optional was passed with --no-review.",
      "It only relaxes a gate the review pass installs, and there is no pass. Drop one of the two.",
    );
  }
  if (reviewOptional && !reviewPass) {
    throw new CLIError(
      "--review-optional was passed without --review.",
      "It only relaxes the gate the review pass installs. Add --review, or drop --review-optional.",
    );
  }
  return {
    approveDiff,
    reviewPass,
    noReview,
    reviewModel: reviewModelFlag?.trim() || undefined,
    reviewOptional,
  };
}

/**
 * Validate `--permission-mode` against the supported Claude CLI modes.
 *
 * @throws {CLIError} On a value that is not one of them.
 */
export function parsePermissionModeFlag(flags: Record<string, string>): PermissionMode | undefined {
  const flag = flags["permission-mode"];
  if (flag !== undefined && !isPermissionMode(flag)) {
    throw new CLIError(
      `Invalid --permission-mode value "${flag}".`,
      `Use one of: ${PERMISSION_MODES.join(", ")}.`,
    );
  }
  return flag as PermissionMode | undefined;
}

/**
 * `--max-turns` and `--token-budget`. Undefined means "use hench config".
 *
 * @throws {CLIError} On a value that is not a positive (max-turns) or
 *   non-negative (token-budget) integer.
 */
export function parseBudgetFlags(flags: Record<string, string>): {
  maxTurns: number | undefined;
  tokenBudget: number | undefined;
} {
  return {
    maxTurns: flags["max-turns"] ? safeParseInt(flags["max-turns"], "max-turns") : undefined,
    tokenBudget:
      flags["token-budget"] != null ? safeParseNonNegInt(flags["token-budget"], "token-budget") : undefined,
  };
}

/**
 * `--skip-test-gate` and its negation.
 *
 * The gate is on by default, so the flag has always been one-directional.
 * Once `hench.skipFullTestGate` or a task's `run.skipTestGate` can turn it
 * off, a single run needs a way to put it back — which is what
 * `--no-skip-test-gate` is for. Neither flag means "leave it to config".
 *
 * @throws {CLIError} When both are passed.
 */
export function parseTestGateFlags(flags: Record<string, string>): {
  skip: boolean;
  noSkip: boolean;
} {
  const skip = flags["skip-test-gate"] === "true";
  const noSkip = flags["no-skip-test-gate"] === "true";
  if (skip && noSkip) {
    throw new CLIError(
      "--skip-test-gate and --no-skip-test-gate were both passed.",
      "Keep whichever one you meant: --skip-test-gate suppresses the full-suite gate, --no-skip-test-gate forces it to run.",
    );
  }
  return { skip, noSkip };
}

/** Which input supplied the effective permission mode. */
export type PermissionModeOrigin = "cli-flag" | "task.run" | "config" | "autonomous-default" | "built-in";

/**
 * The permission mode the spawned Claude session runs with.
 *
 * Precedence: `--permission-mode` > the task's saved `run.permissionMode` >
 * `hench.permissionMode` > the autonomous default (`acceptEdits`, so an
 * unattended run cannot stall in plan mode) > undefined (the Claude CLI's own
 * default). Other vendors have no such setting, so the winning value is
 * returned as `dropped` and `value` is undefined — the caller says so.
 */
export function resolveRunPermissionMode(params: {
  flag: PermissionMode | undefined;
  /** `run.permissionMode` from the selected task, when one is selected. */
  saved?: PermissionMode | undefined;
  configured: PermissionMode | undefined;
  autonomous: boolean;
  vendor: LLMVendor;
}): { value: PermissionMode | undefined; origin: PermissionModeOrigin; dropped?: PermissionMode } {
  const { flag, saved, configured, autonomous, vendor } = params;
  const chosen: { value: PermissionMode | undefined; origin: PermissionModeOrigin } =
    flag !== undefined
      ? { value: flag, origin: "cli-flag" }
      : saved !== undefined
        ? { value: saved, origin: "task.run" }
        : configured !== undefined
          ? { value: configured, origin: "config" }
          : autonomous
            ? { value: "acceptEdits", origin: "autonomous-default" }
            : { value: undefined, origin: "built-in" };
  if (chosen.value && vendor !== LLM_VENDOR.CLAUDE) {
    return { value: undefined, origin: chosen.origin, dropped: chosen.value };
  }
  return chosen;
}

/**
 * The provider a run uses, and the refusal when there is none it can.
 *
 * VENDOR_PROVIDERS (provider-support.ts) is the single source of truth:
 * claude accepts cli or api; codex only cli (no API loop); google and local
 * only api (no CLI binary exists). A vendor that rejects "cli" always accepts
 * "api", so an unsupported "cli" switches silently (`switched`) — ndx config /
 * ndx init persist hench.provider=api when local or google is selected, so
 * this is a safety net for projects configured outside those flows. An
 * unsupported "api" (codex only), or a value that is neither, has no fallback.
 */
export function resolveRunProvider(
  requested: string,
  vendor: LLMVendor,
): { provider: HenchProvider; switched: boolean; error?: CLIError } {
  if (requested !== "cli" && requested !== "api") {
    return {
      provider: requested as HenchProvider,
      switched: false,
      error: new CLIError(
        `Unknown provider "${requested}".`,
        "Use --provider=cli or --provider=api.",
      ),
    };
  }
  if (isProviderSupported(vendor, requested)) return { provider: requested, switched: false };
  if (requested === "cli") return { provider: "api", switched: true };
  return {
    provider: requested,
    switched: false,
    error: new CLIError(
      "Hench API provider is only supported for vendor=claude or vendor=google.",
      "Set 'n-dx config hench.provider cli' or switch vendor: 'n-dx config llm.vendor claude'.",
    ),
  };
}

/**
 * The adversarial review pass spawns a second vendor CLI session, so it exists
 * only on the CLI provider. Refused rather than accepted and ignored: a silent
 * no-op would report "reviewed" runs that were never reviewed.
 */
export function reviewProviderError(vendor: LLMVendor, provider: HenchProvider): CLIError | undefined {
  if (provider !== "api") return undefined;
  return new CLIError(
    `--review requires the CLI provider, but this run resolved to provider="api"` +
      `${vendor === LLM_VENDOR.GOOGLE || vendor === LLM_VENDOR.LOCAL ? ` (vendor="${vendor}" has no CLI binary)` : ""}.`,
    "Switch with 'ndx config hench.provider cli' on a vendor that has a CLI (claude, codex), or drop --review.",
  );
}

// ---------------------------------------------------------------------------
// Per-task run settings
// ---------------------------------------------------------------------------

/** One resolved setting and the config key (or rule) that supplied it. */
export interface Resolved<T> {
  value: T;
  /**
   * `cli-flag`, `task.run` (or `task.run.tier` / `task.run.models` for the two
   * model settings, where which saved key won is the thing worth knowing),
   * `hench.<key>`, `hench.models.<vendor>`, an `llm.*` key, `vendor-default`,
   * `autonomous-default`, `repository-trust` or `built-in`.
   */
  source: string;
  /**
   * What this setting would resolve to if the task had saved nothing — the
   * project's own default. Only `ndx work --resolve` fills it in, and only for
   * a setting a saved block won, so the dashboard can show "project default: X
   * from llm.model" beside the saved value and know what Save would change.
   */
  fallback?: { value: T; source: string };
}

/** The portable tiers a saved `run` block may name, heaviest last. */
const TIER_ORDER = ["light", "standard", "heavy"] as const satisfies readonly RunSettingTier[];

/**
 * Weight recorded for a model that is in no tier this project can reach.
 * Distinct from a tier name so a usage report never files an opus run under
 * "standard" merely because that is the field's default.
 */
export const CUSTOM_WEIGHT = "custom";

/** The task class the agent loop runs as; the tier it routes to is the run's weight. */
const AGENT_TASK_CLASS = "agent.execute";

/**
 * The model `resolveTaskModel` picks for `vendor` at `tier`, resolved through
 * the same function the run's own chain uses rather than read off
 * `TIER_MODELS` directly — so a `llm.tiers.<vendor>.<tier>` override, and the
 * vendor-specific normalization of whatever it names, apply here exactly as
 * they do there. The route is forced to `tier`; nothing else is changed.
 */
function modelForTier(vendor: LLMVendor, llmConfig: LLMConfig | undefined, tier: RunSettingTier): string {
  return resolveTaskModel(
    AGENT_TASK_CLASS,
    { ...llmConfig, routes: { ...llmConfig?.routes, [AGENT_TASK_CLASS]: tier } },
    { vendor },
  ).model;
}

/**
 * The tier `model` belongs to for this project — the run record's `weight`.
 *
 * A model the route chain picked is recorded as the tier the route reached.
 * Anything else (a `--model` flag, a `hench.models` pin, a task's saved
 * `models` entry) is reverse-mapped through the vendor's tier table, which
 * `modelForTier` reads with this project's own `llm.tiers` overrides applied.
 * The standard tier's entry already resolves through `llm.model` /
 * `llm.<vendor>.model`, so a pinned model maps to "standard" without a second
 * rule for it.
 *
 * Several tiers can name the same model (on this repo `standard` and `heavy`
 * are both opus): the routed tier wins when it is among them, else the
 * heaviest, because overstating a cheap run is a smaller lie than filing an
 * expensive one as cheap. A model in no tier is {@link CUSTOM_WEIGHT}.
 */
export function weightOfModel(params: {
  vendor: LLMVendor;
  model: string;
  llmConfig: LLMConfig | undefined;
  /** The tier `agent.execute` routes to for this project. */
  routedTier: string;
  /** True when `model` came from the `llm.*` route chain rather than an override. */
  fromRouteChain: boolean;
}): string {
  const { vendor, model, llmConfig, routedTier, fromRouteChain } = params;
  if (fromRouteChain) return routedTier;
  const matches = TIER_ORDER.filter((tier) => modelForTier(vendor, llmConfig, tier) === model);
  if (matches.length === 0) return CUSTOM_WEIGHT;
  if (matches.some((tier) => tier === routedTier)) return routedTier;
  return matches[matches.length - 1];
}

/** Model rungs that come from the `llm.*` route chain rather than from an override. */
function isRouteChainRung(rung: string): boolean {
  return rung !== "cli-flag" && !rung.startsWith("hench.models.");
}

/**
 * Why a saved setting was not applied as written.
 *
 * Coded rather than prose because the dashboard shows these beside the field
 * they concern: a run can be started from a browser, where stderr goes
 * nowhere, and "your saved model cannot run on this vendor" is exactly what
 * the reader needs before they click Execute.
 */
export type SettingWarningCode =
  /** The whole block failed rex's validator and was ignored. */
  | "saved-settings-ignored"
  /** `models[vendor]` names a model this vendor cannot run. */
  | "saved-model-incompatible"
  /** `provider` names a loop this vendor does not have. */
  | "saved-provider-unavailable"
  /** `provider` lost to `--review`, which needs the CLI provider. */
  | "saved-provider-overridden"
  /** `review` cannot run on the provider this task resolved to. */
  | "saved-review-unsupported"
  /** `permissionMode` is a Claude-only setting on another vendor. */
  | "saved-permission-mode-dropped";

export interface SettingWarning {
  code: SettingWarningCode;
  message: string;
}

export interface TaskRunSettings {
  model: Resolved<string> & {
    /** The tier of {@link Resolved.value} — what the run record's `weight` is. */
    weight: string;
    /**
     * The coarser label the vendor/model header prints. A model saved on the
     * task reads as "configured": it is configured, just on the item rather
     * than in a config file, and the header's union has no finer word for it.
     */
    headerSource: AgentModelSource;
    /** Set when the winning model cannot run on the active vendor; a run refuses on it. */
    mismatch?: CLIError;
  };
  provider: Resolved<HenchProvider> & { switched: boolean; error?: CLIError };
  permissionMode: Resolved<PermissionMode | null> & {
    /** The mode a non-Claude vendor cannot honour; set when it was dropped. */
    dropped?: PermissionMode;
  };
  review: Resolved<boolean>;
  /** Always the reviewer a review would use; `review.value` says whether one runs. */
  reviewModel: Resolved<string> & { vendorDefault: string };
  reviewOptional: Resolved<boolean>;
  skipTestGate: Resolved<boolean>;
  maxTurns: Resolved<number>;
  tokenBudget: Resolved<number>;
  /** `--context-file` text, else the task's saved `contextNotes`. */
  contextNotes: Resolved<string | null>;
  /** The saved block that was honoured; undefined when absent or ignored. */
  saved?: RunSettings;
  /** Operator-facing notes about the saved block — an ignored or skipped value. */
  warnings: SettingWarning[];
}

export interface TaskRunSettingsInput {
  flags: Record<string, string>;
  config: HenchConfig;
  /** Top-level keys actually present in hench's config files, for `hench.<key>` sources. */
  configuredHenchKeys: ReadonlySet<string>;
  llmConfig: LLMConfig | undefined;
  vendor: LLMVendor;
  autonomous: boolean;
  /** The selected task. Omitted before selection, which resolves the invocation's defaults. */
  item?: Pick<PRDItem, "id" | "title" | "run">;
  /**
   * Repository trust, applied as a run applies it: while the checkout's
   * execution config is untrusted, `bypassPermissions` is lowered. Passed as a
   * function because the clamp reads the trust store, which this module does not.
   */
  clampPermissionMode?: (mode: PermissionMode | undefined) => PermissionMode | undefined;
  /** `--context-file` text, already read and trimmed by the caller. */
  contextFileText?: string;
}

/**
 * Every per-task setting a run uses, with the key that supplied it.
 *
 * One function, two callers: the run path (`cmdRun` for the invocation's
 * defaults, `runOne` again once a task is selected) and `ndx work --resolve`.
 * A second copy is how `--resolve` would come to report a model the run does
 * not use, so the precedence lives here and nowhere else.
 *
 * Precedence for every setting: CLI flag > the task's saved `run` block >
 * `hench.*` > `llm.*` > the built-in default. A saved block that fails rex's
 * own validator is ignored whole, with one warning — a run must not stop
 * because somebody hand-edited one field of one item's front matter.
 */
export function resolveTaskRunSettings(input: TaskRunSettingsInput): TaskRunSettings {
  const { flags, config, configuredHenchKeys, llmConfig, vendor, autonomous, item } = input;
  const warnings: SettingWarning[] = [];

  const reviewOpts = parseReviewOptions(flags);
  const permissionModeFlag = parsePermissionModeFlag(flags);
  const budgets = parseBudgetFlags(flags);
  const testGate = parseTestGateFlags(flags);

  // The saved block, or nothing. `validateRunSettings` is rex's — the same one
  // every writer gates on — so "what hench honours" cannot drift from "what
  // the dashboard and MCP are allowed to save".
  let saved: RunSettings | undefined;
  if (item?.run !== undefined) {
    const check = validateRunSettings(item.run);
    if (check.ok) {
      saved = check.value;
    } else {
      warnings.push({
        code: "saved-settings-ignored",
        message:
          `Ignoring the run settings saved on "${item.title}" (${item.id}): ${check.error}. ` +
          `Running with this project's configured settings instead.`,
      });
    }
  }

  const henchSource = (key: string): string => (configuredHenchKeys.has(key) ? `hench.${key}` : "built-in");

  // -- Model ---------------------------------------------------------------
  const routed = resolveTaskModel(AGENT_TASK_CLASS, llmConfig, { vendor });
  const cliModel = selectCliModelOverride(flags, vendor).value;
  const savedModel = saved?.models?.[vendor]?.trim();
  // A pin saved under this vendor's name that this vendor cannot run is the
  // one saved value that must never wedge a loop: warn, skip it, carry on down
  // the chain. `local` serves whatever LM Studio has loaded, so every string
  // is legitimate there and the check does not apply.
  const savedModelUsable =
    savedModel !== undefined
    && savedModel.length > 0
    && (vendor === LLM_VENDOR.LOCAL || isModelCompatibleWithVendor(vendor, savedModel));
  if (savedModel !== undefined && savedModel.length > 0 && !savedModelUsable) {
    warnings.push({
      code: "saved-model-incompatible",
      message:
        `The model "${savedModel}" saved on "${item?.title}" cannot run on vendor="${vendor}" — ` +
        `falling back to this project's configured model.`,
    });
  }
  // A saved tier is portable, so it resolves per vendor. `local` is excluded:
  // LM Studio serves whichever model is loaded, so every tier there resolves to
  // the same string and honouring the tier would only record a weight the run
  // did not have. The chain continues instead, and the weight reverse-maps.
  const savedTier = vendor === LLM_VENDOR.LOCAL ? undefined : saved?.tier;
  const savedTierModel = savedTier ? modelForTier(vendor, llmConfig, savedTier) || undefined : undefined;

  const agentModel = checkAgentModel({
    vendor,
    cliModelOverride: cliModel,
    henchModels: config.models,
    llmConfig,
  });
  const weightOf = (value: string, fromRouteChain: boolean): string =>
    weightOfModel({ vendor, model: value, llmConfig, routedTier: routed.tier, fromRouteChain });

  let model: TaskRunSettings["model"];
  if (cliModel) {
    model = {
      value: agentModel.model,
      source: agentModel.rung,
      weight: weightOf(agentModel.model, false),
      headerSource: agentModel.source,
    };
  } else if (savedModelUsable) {
    const value = resolveModel(savedModel as string);
    model = { value, source: "task.run.models", weight: weightOf(value, false), headerSource: "configured" };
  } else if (savedTierModel) {
    model = {
      value: savedTierModel,
      source: "task.run.tier",
      weight: savedTier as string,
      headerSource: "configured",
    };
  } else {
    model = {
      value: agentModel.model,
      source: agentModel.rung,
      weight: weightOf(agentModel.model, isRouteChainRung(agentModel.rung)),
      headerSource: agentModel.source,
      ...(agentModel.mismatch ? { mismatch: agentModel.mismatch } : {}),
    };
  }

  // -- Provider ------------------------------------------------------------
  // A saved provider the active vendor has no loop for (`api` on codex) is
  // skipped like an incompatible saved model: warn, fall back to the project's
  // provider, and carry on. Refusing instead would end a whole `--loop` on one
  // task's saved value, and saved blocks are vendor-agnostic by design — a task
  // saved under Claude is meant to run under Codex. A provider that only needs
  // switching (`cli` on google, which has no CLI binary) is not this case:
  // `resolveRunProvider` switches it silently and reports no error.
  const savedProvider = saved?.provider;
  const savedProviderCheck = savedProvider ? resolveRunProvider(savedProvider, vendor) : undefined;
  // `--review` is an operator-typed gate that refuses rather than no-ops, so a
  // saved provider that would make the review impossible loses to it — again a
  // warning rather than a throw, for the same reason.
  const savedProviderBlocksReview =
    savedProviderCheck !== undefined
    && reviewOpts.reviewPass
    && reviewProviderError(vendor, savedProviderCheck.provider) !== undefined;
  const savedProviderUsable =
    savedProviderCheck !== undefined && savedProviderCheck.error === undefined && !savedProviderBlocksReview;
  if (savedProviderCheck?.error) {
    warnings.push({
      code: "saved-provider-unavailable",
      message:
        `The provider "${savedProvider}" saved on "${item?.title}" is not available for ` +
        `vendor="${vendor}" — running on this project's configured provider instead.`,
    });
  } else if (savedProviderBlocksReview) {
    warnings.push({
      code: "saved-provider-overridden",
      message:
        `Ignoring the provider "${savedProvider}" saved on "${item?.title}": --review needs the ` +
        `CLI provider, and the flag outranks a saved setting.`,
    });
  }
  const requestedProvider = flags.provider ?? (savedProviderUsable ? savedProvider : config.provider);
  const providerSource =
    flags.provider !== undefined
      ? "cli-flag"
      : savedProviderUsable
        ? "task.run"
        : henchSource("provider");
  const resolvedProvider = resolveRunProvider(requestedProvider as string, vendor);

  // -- Permission mode -----------------------------------------------------
  const permission = resolveRunPermissionMode({
    flag: permissionModeFlag,
    saved: saved?.permissionMode,
    configured: config.permissionMode,
    autonomous,
    vendor,
  });
  const clamped = input.clampPermissionMode ? input.clampPermissionMode(permission.value) : permission.value;
  // The mode exists only on Claude. `cmdRun` says so once for the invocation's
  // own mode; a mode that came from the task has no other voice, so it would
  // otherwise vanish without a word.
  if (permission.dropped !== undefined && permission.origin === "task.run") {
    warnings.push({
      code: "saved-permission-mode-dropped",
      message:
        `The permission mode "${permission.dropped}" saved on "${item?.title}" is a Claude CLI ` +
        `feature; ignoring it for vendor="${vendor}".`,
    });
  }

  // -- Review --------------------------------------------------------------
  // The review pass spawns a second vendor CLI session, so it exists only on
  // the CLI provider. `--review` still refuses on the API provider (the
  // operator asked for a gate and must not be told it ran), but a task that
  // merely *saved* `review: true` is asking for an addition, not stating a
  // precondition — dropping it with a warning beats ending the loop. The
  // caller refuses the flag case; this only decides the saved one.
  const savedReviewUnsupported =
    !reviewOpts.reviewPass
    && !reviewOpts.noReview
    && saved?.review === true
    && reviewProviderError(vendor, resolvedProvider.provider) !== undefined;
  if (savedReviewUnsupported) {
    warnings.push({
      code: "saved-review-unsupported",
      message:
        `The review pass saved on "${item?.title}" needs the CLI provider, but this task ` +
        `resolved to provider="${resolvedProvider.provider}" — running it without a review.`,
    });
  }
  const review: Resolved<boolean> = reviewOpts.reviewPass
    ? { value: true, source: "cli-flag" }
    : reviewOpts.noReview
      ? { value: false, source: "cli-flag" }
      : savedReviewUnsupported
        ? { value: false, source: "vendor-unsupported" }
        : saved?.review !== undefined
          ? { value: saved.review, source: "task.run" }
          : { value: false, source: "built-in" };
  const vendorDefault = REVIEW_MODELS[vendor] ?? "";
  const savedReviewModel = saved?.reviewModels?.[vendor]?.trim();
  const savedReviewTierModel = saved?.reviewTier
    ? modelForTier(vendor, llmConfig, saved.reviewTier) || undefined
    : undefined;
  let reviewModel: TaskRunSettings["reviewModel"];
  if (reviewOpts.reviewModel) {
    reviewModel = {
      value: resolveReviewModel(vendor, llmConfig, reviewOpts.reviewModel),
      source: "cli-flag",
      vendorDefault,
    };
  } else if (savedReviewModel) {
    reviewModel = {
      value: resolveReviewModel(vendor, llmConfig, savedReviewModel),
      source: "task.run.reviewModels",
      vendorDefault,
    };
  } else if (savedReviewTierModel) {
    reviewModel = { value: savedReviewTierModel, source: "task.run.reviewTier", vendorDefault };
  } else {
    reviewModel = {
      value: resolveReviewModel(vendor, llmConfig, undefined),
      source: reviewModelKey(vendor, reviewModelSource(vendor, llmConfig, undefined)),
      vendorDefault,
    };
  }

  return {
    model,
    provider: {
      value: resolvedProvider.provider,
      source: resolvedProvider.switched ? "vendor-default" : providerSource,
      switched: resolvedProvider.switched,
      ...(resolvedProvider.error ? { error: resolvedProvider.error } : {}),
    },
    permissionMode: {
      ...(permission.dropped !== undefined ? { dropped: permission.dropped } : {}),
      value: clamped ?? null,
      source:
        clamped !== permission.value
          ? "repository-trust"
          : permission.dropped !== undefined || permission.value === undefined
            ? "built-in"
            : permission.origin === "config"
              ? "hench.permissionMode"
              : permission.origin,
    },
    review,
    reviewModel,
    // `--no-review` carries the saved companion settings with it: there is no
    // reviewer left for them to relax.
    reviewOptional: reviewOpts.reviewOptional
      ? { value: true, source: "cli-flag" }
      : reviewOpts.noReview
        ? { value: false, source: "cli-flag" }
        : saved?.reviewOptional !== undefined
          ? { value: saved.reviewOptional, source: "task.run" }
          : { value: false, source: "built-in" },
    // `false` is a meaningful saved value: it re-enables a gate
    // `hench.skipFullTestGate` turns off. Either flag outranks it; an absent
    // flag says nothing, which is why the pair exists rather than one flag
    // with two readings.
    skipTestGate: testGate.skip
      ? { value: true, source: "cli-flag" }
      : testGate.noSkip
        ? { value: false, source: "cli-flag" }
        : saved?.skipTestGate !== undefined
          ? { value: saved.skipTestGate, source: "task.run" }
          : config.skipFullTestGate !== undefined
            ? { value: config.skipFullTestGate, source: "hench.skipFullTestGate" }
            : { value: false, source: "built-in" },
    maxTurns:
      budgets.maxTurns !== undefined
        ? { value: budgets.maxTurns, source: "cli-flag" }
        : saved?.maxTurns !== undefined
          ? { value: saved.maxTurns, source: "task.run" }
          : { value: config.maxTurns, source: henchSource("maxTurns") },
    tokenBudget:
      budgets.tokenBudget !== undefined
        ? { value: budgets.tokenBudget, source: "cli-flag" }
        : saved?.tokenBudget !== undefined
          ? { value: saved.tokenBudget, source: "task.run" }
          : { value: config.tokenBudget, source: henchSource("tokenBudget") },
    // Saved notes reach the agent the way `--context-file` does. An explicit
    // `--context-file` replaces them rather than appending: the flag is the
    // operator saying what context this run gets.
    contextNotes:
      input.contextFileText !== undefined
        ? { value: input.contextFileText, source: "cli-flag" }
        : saved?.contextNotes
          ? { value: saved.contextNotes, source: "task.run" }
          : { value: null, source: "built-in" },
    ...(saved ? { saved } : {}),
    warnings,
  };
}

/** The config key behind each `reviewModelSource` answer. */
export function reviewModelKey(vendor: LLMVendor, source: ReturnType<typeof reviewModelSource>): string {
  if (source === "flag") return "cli-flag";
  if (source === "vendor-config") return `llm.${vendor}.reviewModel`;
  if (source === "shared-config") return "llm.reviewModel";
  return "vendor-default";
}
