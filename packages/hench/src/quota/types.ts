/**
 * Quota-remaining result for a single vendor/model combination.
 *
 * Returned by `checkQuotaRemaining()` after each hench run completes.
 * A non-empty array means at least one provider was queried and
 * has remaining-quota data to surface to the user.
 *
 * `percentRemaining` is in the range [0, 100] where 100 means
 * fully available and 0 means exhausted.
 *
 * `unavailable` is set to `true` when the provider does not expose a
 * quota API (e.g. Google / Gemini). Formatters render these entries as
 * "quota unavailable" rather than a percentage.
 */
export interface QuotaRemaining {
  /** Provider vendor identifier, e.g. "claude", "codex", or "google". */
  vendor: string;
  /** Resolved model identifier, e.g. "claude-opus-4-5". */
  model: string;
  /** Percentage of quota (or configured budget) still available: 0–100. */
  percentRemaining: number;
  /**
   * When true the provider did not return quota data and the entry exists
   * solely to surface a "quota unavailable" notice to the user.
   */
  unavailable?: boolean;
  /**
   * Optional human-readable reason shown alongside an `unavailable` entry,
   * e.g. explaining that Codex `codex login` (session auth) cannot query the
   * billing quota API. Ignored when `unavailable` is not set.
   */
  notice?: string;
}
