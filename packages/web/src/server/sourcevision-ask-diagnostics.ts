/**
 * What went wrong with an ask, and what to do about it.
 *
 * The panel has three distinct ways to be unusable and they call for three
 * different actions: run an analysis, fix credentials, or try again. A shared
 * "request failed" tells the user none of that — which is the specific outcome
 * this module exists to prevent.
 *
 * Shaped after `pr-markdown-refresh-diagnostics.ts`: a code per failure mode, a
 * summary that names the mode, and remediation the user can act on. Smaller
 * than that one, because the classification already exists —
 * `ClaudeClientError.reason` and `NoAnalysisError` do the diagnosis, and this
 * turns their verdict into something worth reading.
 *
 * ## Auth wording is not written here
 *
 * `authFailureGuidance` in `@n-dx/llm-client` is the single source of truth for
 * re-authentication, shared with `ndx init`, `ndx work`, and the analyzers. It
 * is vendor-aware — `claude logout && claude login` is wrong advice for a Google
 * key — and it ends every list with the same verification step. Re-wording it
 * here would give the dashboard its own dialect of the one message the whole
 * product agrees on, so this passes it through unchanged.
 *
 * @module web/server/sourcevision-ask-diagnostics
 * @see packages/llm-client/src/auth-guidance.ts — the canonical auth wording
 * @see packages/web/src/server/pr-markdown-refresh-diagnostics.ts — the pattern
 */

import { authFailureGuidance } from "@n-dx/llm-client";

/**
 * The ways an ask can fail, as the user experiences them.
 *
 * Distinct from `ClaudeClientError.reason` on purpose: `no_analysis` never
 * reaches a provider, and the codes below are what the panel branches on.
 */
export type AskFailureCode =
  | "no_analysis"
  | "auth"
  | "timeout"
  | "rate_limit"
  | "cli_not_found"
  | "provider_error";

/** A failure, stated so the panel can render it without inventing wording. */
export interface AskFailure {
  code: AskFailureCode;
  /** One line naming what happened. Never a raw provider payload. */
  summary: string;
  /** What to do, most important first. May be empty when there is nothing to do but retry. */
  remediation: string[];
  /**
   * Whether asking the same question again could plausibly work.
   *
   * A timeout and a rate limit pass; bad credentials and a missing CLI do not,
   * because retrying changes nothing until the user acts. Offering a retry that
   * cannot succeed is its own kind of unhelpful.
   */
  retryable: boolean;
}

/**
 * There is no analysis to ground an answer in.
 *
 * The remediation names the command, but the panel's real answer to this is the
 * analyze button it renders alongside — a user looking at a dashboard should not
 * have to go find a terminal.
 */
export function noAnalysisFailure(cliName = "ndx"): AskFailure {
  return {
    code: "no_analysis",
    summary:
      "This project has not been analyzed yet, so there is nothing to ground an answer in.",
    remediation: [`Run an analysis: ${cliName} analyze .`],
    retryable: false,
  };
}

/**
 * Map a classified provider failure to something actionable.
 *
 * `detail` is the provider's own message. It is carried on the summary for the
 * modes where it says something specific (a rate limit's reset window, a
 * provider's own complaint) and dropped for auth, where the canonical guidance
 * is more useful than the provider's phrasing and the raw text risks carrying a
 * payload into the UI.
 */
export function askFailureForReason(
  reason: string,
  vendor: string,
  detail: string,
): AskFailure {
  switch (reason) {
    case "auth": {
      const guidance = authFailureGuidance(vendor);
      return {
        code: "auth",
        summary: guidance.headline,
        remediation: [...guidance.remediation],
        retryable: false,
      };
    }
    case "rate-limit":
      return {
        code: "rate_limit",
        summary: `${vendor} is rate limiting this request.`,
        remediation: [
          "Wait for the limit to reset, then ask again.",
          ...(detail ? [`Provider said: ${detail}`] : []),
        ],
        retryable: true,
      };
    case "timeout":
      return {
        code: "timeout",
        summary: "The model did not answer in time.",
        remediation: [
          "Ask again — a shorter or narrower question is more likely to finish.",
        ],
        retryable: true,
      };
    case "not-found":
      return {
        code: "cli_not_found",
        summary: `The configured ${vendor} CLI was not found on PATH.`,
        remediation: [
          `Install the ${vendor} CLI, or point n-dx at it: ndx config llm.${vendor}.cli_path /path/to/${vendor}`,
          "Verify credentials: ndx auth",
        ],
        retryable: false,
      };
    default:
      return {
        code: "provider_error",
        summary: `The ${vendor} call failed.`,
        remediation: [
          ...(detail ? [`Provider said: ${detail}`] : []),
          "Ask again — if it keeps failing, check the provider's status.",
        ],
        retryable: true,
      };
  }
}

/** True when `value` is a well-formed failure — the contract the panel relies on. */
export function isAskFailure(value: unknown): value is AskFailure {
  if (typeof value !== "object" || value === null) return false;
  const f = value as Partial<AskFailure>;
  return (
    typeof f.code === "string"
    && typeof f.summary === "string"
    && f.summary.trim().length > 0
    && Array.isArray(f.remediation)
    && f.remediation.every((line) => typeof line === "string" && line.trim().length > 0)
    && typeof f.retryable === "boolean"
  );
}
