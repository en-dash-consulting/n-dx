/**
 * Quota-remaining sub-zone public barrel.
 *
 * Exports the `QuotaRemaining` type and the `checkQuotaRemaining` hook
 * that is called by the multi-run loops after each run completes.
 *
 * ## Provider coverage
 *
 * Codex (OpenAI): fetches real-time quota from the OpenAI billing API when
 * OPENAI_API_KEY (or llm.codex.api_key in .n-dx.json) is configured.
 *
 * On any fetch failure the provider is silently skipped so the caller's
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

import { fetchCodexQuota } from "./codex-quota.js";
import { loadLLMConfig, NEWEST_MODELS, resolveVendorModel } from "../prd/llm-gateway.js";
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
 * Codex: attempted when OPENAI_API_KEY is set or llm.codex.api_key appears
 * in .n-dx.json (read from process.cwd()).  Failures are silently discarded
 * to preserve inter-run loop continuity.
 *
 * @returns Array of per-vendor quota snapshots (may be empty).
 */
export async function checkQuotaRemaining(): Promise<QuotaRemaining[]> {
  const results: QuotaRemaining[] = [];

  // ── Codex (OpenAI) ──────────────────────────────────────────────────────
  const apiKey = process.env["OPENAI_API_KEY"];
  let codexApiKey: string | undefined = apiKey;
  let codexModel: string = NEWEST_MODELS.codex;

  try {
    const llmConfig = await loadLLMConfig(process.cwd());
    if (llmConfig.codex?.api_key) {
      codexApiKey = llmConfig.codex.api_key;
    }
    codexModel = resolveVendorModel("codex", llmConfig);
  } catch {
    // Config load failure is non-fatal — fall back to env var and default model.
  }

  if (codexApiKey) {
    const codexResult = await fetchCodexQuota({ apiKey: codexApiKey, model: codexModel });
    if (codexResult.ok) {
      results.push(codexResult.quota);
    }
    // On failure: silently skip — the inter-run loop must never be interrupted
    // by quota-check errors.
  }

  return results;
}
