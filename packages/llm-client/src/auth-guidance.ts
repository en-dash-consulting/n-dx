/**
 * Canonical, vendor-aware re-authentication guidance.
 *
 * Single source of truth for the auth-failure message shown wherever a
 * provider rejects credentials — the core preflight (`ndx init` /
 * `ndx config llm.vendor`), the runtime LLM providers (`ndx work`), and the
 * domain analyzers (`ndx plan` / `ndx analyze`). Keeping the wording here
 * ensures every entry point states the same cause and the same fix.
 *
 * The guidance is deliberately JSON-free: it names the provider, states the
 * root cause, and gives the exact command(s) to fix it. Raw provider payloads
 * (JSON blobs, stack traces) must never be folded into these strings.
 */

import type { LLMVendor } from "./provider-interface.js";

/** Structured, colorable pieces of an auth-failure message. */
export interface AuthFailureGuidance {
  /** Human display name, e.g. "Claude", "Codex", "Google". */
  provider: string;
  /**
   * One-line headline naming the provider and stating the cause. Never
   * contains raw JSON or internal error fields.
   */
  headline: string;
  /**
   * Ordered remediation lines, most important first. Each is a short label
   * plus the exact command to run.
   */
  remediation: string[];
}

/** Shared cause statement so every surface reads identically. */
const CANONICAL_CAUSE = "Invalid or expired credentials";

/**
 * Canonical verification step appended to every vendor's remediation:
 * `ndx auth` re-runs the provider preflight, giving users a repeatable way
 * to confirm credentials after fixing them.
 */
export const VERIFY_CREDENTIALS_STEP = "Verify credentials: ndx auth";

/**
 * Return concise re-authentication guidance for a provider. Unknown vendors
 * fall back to Claude (the default vendor). The final remediation line is
 * always {@link VERIFY_CREDENTIALS_STEP}.
 */
export function authFailureGuidance(vendor: LLMVendor | string | undefined): AuthFailureGuidance {
  switch (vendor) {
    case "codex":
      return {
        provider: "Codex",
        headline: `Authentication failed for Codex — ${CANONICAL_CAUSE}.`,
        remediation: [
          "Re-authenticate: codex logout && codex login",
          "If needed, set the binary path: ndx config llm.codex.cli_path /path/to/codex",
          VERIFY_CREDENTIALS_STEP,
        ],
      };
    case "google":
      return {
        provider: "Google",
        headline: `Authentication failed for Google — ${CANONICAL_CAUSE}.`,
        remediation: [
          "Update your API key: ndx config llm.google.api_key <KEY>",
          "Or set the env var: export GEMINI_API_KEY=<KEY>",
          "Get a key: https://aistudio.google.com/apikey",
          VERIFY_CREDENTIALS_STEP,
        ],
      };
    case "claude":
    default:
      return {
        provider: "Claude",
        headline: `Authentication failed for Claude — ${CANONICAL_CAUSE}.`,
        remediation: [
          "Re-authenticate: claude logout && claude login",
          VERIFY_CREDENTIALS_STEP,
        ],
      };
  }
}

/**
 * Flatten {@link authFailureGuidance} into a single JSON-free line suitable
 * for an error `.message` — the headline plus the primary remediation
 * command, ending with the {@link VERIFY_CREDENTIALS_STEP} verification step.
 */
export function authFailureMessage(vendor: LLMVendor | string | undefined): string {
  const guidance = authFailureGuidance(vendor);
  return `${guidance.headline} ${guidance.remediation[0]}. ${VERIFY_CREDENTIALS_STEP}.`;
}
