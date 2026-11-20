/**
 * Shared constants for token usage functionality.
 *
 * Centralises the polling key and interval so that the token-usage view and
 * the polling integration tests reference the same source of truth.
 */

/** Polling-manager registration key for the token usage poller. */
export const TOKEN_USAGE_POLL_KEY = "token-usage";

/** Polling interval for automatic usage data refresh (ms). */
export const USAGE_POLL_INTERVAL_MS = 10_000;
