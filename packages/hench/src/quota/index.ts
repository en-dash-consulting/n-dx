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
 * `llm.codex.auth` allows an API key and one resolves (codex-api-key.ts). When
 * Codex is the active vendor but no key may be used (the `codex login`
 * session-auth path), an "unavailable" notice is surfaced instead.
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
export type { CodexQuotaKey } from "./codex-api-key.js";
export { resolveCodexQuotaKey } from "./codex-api-key.js";
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
import { resolveCodexQuotaKey } from "./codex-api-key.js";
import { fetchClaudeQuota } from "./claude-quota.js";
import { fetchGoogleQuota } from "./google-quota.js";
import { LLM_VENDOR, loadLLMConfig, resolveVendorModel } from "../prd/llm-gateway.js";
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
 * Codex: attempted when `llm.codex.auth` allows an API key and one resolves
 * (config read from process.cwd()).  Failures are silently discarded
 * to preserve inter-run loop continuity. When Codex is the active vendor and no
 * key is available (session auth via `codex login`), a single "unavailable"
 * notice entry is returned so the missing quota is explained rather than hidden.
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
    const claudeModel = resolveVendorModel(LLM_VENDOR.CLAUDE, llmConfig);
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
    const codexKey = resolveCodexQuotaKey(llmConfig);
    const codexModel = resolveVendorModel(LLM_VENDOR.CODEX, llmConfig);

    if (codexKey.key) {
      const codexResult = await fetchCodexQuota({ apiKey: codexKey.key, model: codexModel });
      if (codexResult.ok) {
        results.push(codexResult.quota);
      }
      // On failure: silently skip — the inter-run loop must never be interrupted
      // by quota-check errors.
    } else if (activeVendor === LLM_VENDOR.CODEX) {
      // No key may be used under llm.codex.auth (typically `codex login`
      // session auth). The billing quota API requires one, so say what would
      // enable quota instead of silently skipping.
      results.push({
        vendor: LLM_VENDOR.CODEX,
        model: codexModel,
        percentRemaining: 0,
        unavailable: true,
        notice: codexKey.notice,
      });
    }
  }

  // ── Google (Gemini) ─────────────────────────────────────────────────────────
  // Gemini does not expose a public quota API. When google is the active vendor,
  // emit a notice entry so the inter-run log is not silent about quota status.
  if (activeVendor === LLM_VENDOR.GOOGLE) {
    const googleModel = resolveVendorModel(LLM_VENDOR.GOOGLE, llmConfig);
    const googleResult = fetchGoogleQuota({ model: googleModel });
    if (googleResult.ok) {
      results.push(googleResult.quota);
    } else {
      // Always "unavailable" — surface it as an informational notice.
      results.push({
        vendor: LLM_VENDOR.GOOGLE,
        model: googleModel,
        percentRemaining: 0,
        unavailable: true,
      });
    }
  }

  return results;
}
