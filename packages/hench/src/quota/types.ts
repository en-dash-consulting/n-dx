/**
 * Quota-remaining result for a single vendor/model combination.
 *
 * Returned by `checkQuotaRemaining()` after each hench run completes.
 * A non-empty array means at least one provider was queried and
 * has remaining-quota data to surface to the user.
 *
 * `percentRemaining` is in the range [0, 100] where 100 means
 * fully available and 0 means exhausted.
 */
export interface QuotaRemaining {
  /** Provider vendor identifier, e.g. "claude" or "codex". */
  vendor: string;
  /** Resolved model identifier, e.g. "claude-opus-4-5". */
  model: string;
  /** Percentage of quota (or configured budget) still available: 0–100. */
  percentRemaining: number;
}
