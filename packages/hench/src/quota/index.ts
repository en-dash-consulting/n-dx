/**
 * Quota-remaining sub-zone public barrel.
 *
 * Exports the `QuotaRemaining` type and the `checkQuotaRemaining` hook
 * that is called by the multi-run loops after each run completes.
 *
 * The stub implementation returns an empty array so the wiring compiles
 * and subsequent tasks can fill in the real calculation without touching
 * the call sites.
 */

export type { QuotaRemaining } from "./types.js";
export { formatQuotaLog } from "./format.js";

/**
 * Check remaining API quota / configured budget for all active providers.
 *
 * Called by every hench multi-run loop after each run completes and
 * before the next one begins.  Returns one entry per provider that has
 * quota data available.  An empty array is a valid (no-op) result and
 * must never cause the caller to block or throw.
 *
 * @returns Array of per-vendor quota snapshots; empty while the
 *          implementation is pending.
 */
export async function checkQuotaRemaining(): Promise<import("./types.js").QuotaRemaining[]> {
  return [];
}
