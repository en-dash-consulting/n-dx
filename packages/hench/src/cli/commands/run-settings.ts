/**
 * The flag → setting decisions `hench run` makes before it does anything.
 *
 * Extracted from `cmdRun` so `ndx work --resolve` reports what a run would use
 * by calling the code the run calls, not a copy of it. Each function here is
 * pure: the caller decides whether a returned error is thrown (a run) or
 * reported (resolve).
 */

import type { LLMVendor } from "../../prd/llm-gateway.js";
import { LLM_VENDOR } from "../../prd/llm-gateway.js";
import type { PermissionMode } from "../../schema/index.js";
import { PERMISSION_MODES, isPermissionMode } from "../../schema/index.js";
import { CLIError } from "../errors.js";
import { safeParseInt, safeParseNonNegInt } from "./constants.js";
import { isProviderSupported } from "./provider-support.js";
import type { HenchProvider } from "./provider-support.js";

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
  const approveDiff = flags["approve-diff"] === "true";
  const reviewModelFlag = flags["review-model"];
  if (reviewModelFlag !== undefined && !reviewModelFlag.trim()) {
    throw new CLIError(
      "--review-model requires a model id.",
      "Example: --review-model=claude-opus-5. Omit the flag to use the recommended default for your vendor.",
    );
  }
  if (reviewModelFlag && !reviewPass) {
    throw new CLIError(
      "--review-model was passed without --review.",
      "The review model only applies to the adversarial review pass. Add --review, or drop --review-model.",
    );
  }
  const reviewOptional = flags["review-optional"] === "true";
  if (reviewOptional && !reviewPass) {
    throw new CLIError(
      "--review-optional was passed without --review.",
      "It only relaxes the gate the review pass installs. Add --review, or drop --review-optional.",
    );
  }
  return {
    approveDiff,
    reviewPass,
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

/** Which input supplied the effective permission mode. */
export type PermissionModeOrigin = "cli-flag" | "config" | "autonomous-default" | "built-in";

/**
 * The permission mode the spawned Claude session runs with.
 *
 * Precedence: `--permission-mode` > `hench.permissionMode` > the autonomous
 * default (`acceptEdits`, so an unattended run cannot stall in plan mode) >
 * undefined (the Claude CLI's own default). Other vendors have no such
 * setting, so the winning value is returned as `dropped` and `value` is
 * undefined — the caller says so.
 */
export function resolveRunPermissionMode(params: {
  flag: PermissionMode | undefined;
  configured: PermissionMode | undefined;
  autonomous: boolean;
  vendor: LLMVendor;
}): { value: PermissionMode | undefined; origin: PermissionModeOrigin; dropped?: PermissionMode } {
  const { flag, configured, autonomous, vendor } = params;
  const chosen: { value: PermissionMode | undefined; origin: PermissionModeOrigin } =
    flag !== undefined
      ? { value: flag, origin: "cli-flag" }
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
