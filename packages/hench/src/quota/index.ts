/**
 * Quota-remaining sub-zone public barrel.
 *
 * Exports the `QuotaRemaining` type and the `checkQuotaRemaining` hook
 * that is called by the multi-run loops after each run completes.
 *
 * ## Provider coverage
 *
 * Claude (Anthropic): budget-based — reads the configured weekly token budget
 * from .n-dx.json (tokenUsage.weeklyBudget) and accumulated spend from
 * .hench/runs/*.json for the current ISO week.  Active when a weekly budget
 * is configured; silently skipped otherwise.
 *
 * Codex (OpenAI): fetches real-time quota from the OpenAI billing API when
 * OPENAI_API_KEY (or llm.codex.api_key in .n-dx.json) is configured.
 *
 * On any failure either provider is silently skipped so the caller's
 * inter-run loop is never interrupted by quota-check errors.
 */

export type { QuotaRemaining } from "./types.js";
export { formatQuotaLog } from "./format.js";
export type {
  QuotaFetchError,
  QuotaFetchErrorKind,
  CodexQuotaResult,
  FetchCodexQuotaOptions,
} from "./codex-quota.js";
export { fetchCodexQuota } from "./codex-quota.js";
export type { ClaudeQuotaResult, FetchClaudeQuotaOptions } from "./claude-quota.js";
export { fetchClaudeQuota } from "./claude-quota.js";
export type { GoogleQuotaResult, FetchGoogleQuotaOptions } from "./google-quota.js";
export { fetchGoogleQuota } from "./google-quota.js";
export type {
  TokenRetrievalError,
  TokenRetrievalErrorKind,
  CodexTokenRetrievalResult,
  FetchCodexTokenUsageOptions,
} from "./codex-token-retrieval.js";
export { fetchCodexTokenUsage } from "./codex-token-retrieval.js";
export type {
  TokenValidationResult,
  TokenValidationIssue,
  TokenValidationMetrics,
  TokenBaseline,
  CodexClaudeComparison,
  TokenValidationSummary,
} from "./token-validation.js";
export {
  validateTokenReporting,
  compareCodexAndClaude,
  validateVendorAttribution,
  validateTokenReportingBatch,
} from "./token-validation.js";
export { validateRunTokensPostRun } from "./token-validation-hook.js";

import { fetchCodexQuota } from "./codex-quota.js";
import { fetchClaudeQuota } from "./claude-quota.js";
import { fetchGoogleQuota } from "./google-quota.js";
import { loadLLMConfig, resolveVendorModel } from "../prd/llm-gateway.js";
import type { LLMConfig } from "../prd/llm-gateway.js";
import { resolveLLMVendor } from "../store/project-config.js";
import type { QuotaRemaining } from "./types.js";

/**
 * Check remaining API quota for all active providers.
 *
 * Called by every hench multi-run loop after each run completes and before
 * the next one begins.  Returns one entry per provider that successfully
 * returned quota data.  An empty array is a valid (no-op) result — callers
 * must never block or throw based on an empty return value.
 *
 * ## Provider resolution
 *
 * Claude: attempted unconditionally (no API key required); returns data only
 * when a weekly token budget is configured in .n-dx.json.
 *
 * Codex: attempted when OPENAI_API_KEY is set or llm.codex.api_key appears
 * in .n-dx.json (read from process.cwd()).  Failures are silently discarded
 * to preserve inter-run loop continuity.
 *
 * @returns Array of per-vendor quota snapshots (may be empty).
 */
export async function checkQuotaRemaining(): Promise<QuotaRemaining[]> {
  const results: QuotaRemaining[] = [];

  // Load LLM config once — shared between all provider sections.
  let llmConfig: LLMConfig = {};
  try {
    llmConfig = await loadLLMConfig(process.cwd());
  } catch {
    // Config load failure is non-fatal — each provider falls back gracefully.
  }

  const activeVendor = resolveLLMVendor(llmConfig);

  // ── Claude (Anthropic) ──────────────────────────────────────────────────────
  // Budget-based: reads .n-dx.json weeklyBudget + .hench/runs/ accumulated spend.
  // fetchClaudeQuota returns ok:false when no budget is configured — silent skip.
  {
    const claudeModel = resolveVendorModel("claude", llmConfig);
    const claudeResult = fetchClaudeQuota({
      projectDir: process.cwd(),
      model: claudeModel,
    });
    if (claudeResult.ok) {
      results.push(claudeResult.quota);
    }
  }

  // ── Codex (OpenAI) ──────────────────────────────────────────────────────────
  // Real-time: queries the OpenAI billing API when an API key is available.
  {
    const codexApiKey = llmConfig.codex?.api_key ?? process.env["OPENAI_API_KEY"];
    const codexModel = resolveVendorModel("codex", llmConfig);

    if (codexApiKey) {
      const codexResult = await fetchCodexQuota({ apiKey: codexApiKey, model: codexModel });
      if (codexResult.ok) {
        results.push(codexResult.quota);
      }
      // On failure: silently skip — the inter-run loop must never be interrupted
      // by quota-check errors.
    }
  }

  // ── Google (Gemini) ─────────────────────────────────────────────────────────
  // Gemini does not expose a public quota API. When google is the active vendor,
  // emit a notice entry so the inter-run log is not silent about quota status.
  if (activeVendor === "google") {
    const googleModel = resolveVendorModel("google", llmConfig);
    const googleResult = fetchGoogleQuota({ model: googleModel });
    if (googleResult.ok) {
      results.push(googleResult.quota);
    } else {
      // Always "unavailable" — surface it as an informational notice.
      results.push({
        vendor: "google",
        model: googleModel,
        percentRemaining: 0,
        unavailable: true,
      });
    }
  }

  return results;
}
