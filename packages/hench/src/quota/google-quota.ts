/**
 * Google (Gemini) quota adapter.
 *
 * Google AI Studio does not expose a public billing or quota API equivalent
 * to OpenAI's /dashboard/billing endpoints. This adapter always returns an
 * "unavailable" result so the between-run quota log can surface a notice
 * without crashing or silently omitting the active vendor.
 *
 * If Google adds a quota API endpoint in the future, implement the fetch
 * here and update the result type accordingly — callers already handle both
 * ok:true and ok:false branches.
 */

import type { QuotaRemaining } from "./types.js";

// ── Result type ──────────────────────────────────────────────────────────────

/**
 * Discriminated-union result from `fetchGoogleQuota`.
 *
 * Currently always `ok: false` with `reason: "unavailable"` because Google
 * does not expose a public quota API. The type is future-proofed for when
 * a real endpoint becomes available.
 */
export type GoogleQuotaResult =
  | { readonly ok: true; readonly quota: QuotaRemaining }
  | { readonly ok: false; readonly reason: "unavailable" };

// ── Options ──────────────────────────────────────────────────────────────────

/** Options for `fetchGoogleQuota`. */
export interface FetchGoogleQuotaOptions {
  /** Model identifier embedded verbatim in the `QuotaRemaining` result. */
  model: string;
}

// ── Public adapter ────────────────────────────────────────────────────────────

/**
 * Fetch quota data for the Google (Gemini) provider.
 *
 * Always returns `{ ok: false, reason: "unavailable" }` because Google AI
 * Studio does not expose a public quota or billing API. Callers should treat
 * this as a signal to surface a "quota unavailable" notice in the log rather
 * than a hard error.
 *
 * @param options - Configuration including the resolved model identifier.
 * @returns Always `{ ok: false, reason: "unavailable" }`.
 */
export function fetchGoogleQuota(
  _options: FetchGoogleQuotaOptions,
): GoogleQuotaResult {
  return { ok: false, reason: "unavailable" };
}
