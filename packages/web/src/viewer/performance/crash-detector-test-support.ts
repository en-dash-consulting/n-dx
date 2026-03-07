/**
 * Test-only constants and helpers for crash-detector.ts.
 *
 * Separated from the production module to keep the public API surface
 * clean and avoid bundling internal implementation details into production.
 *
 * @internal Only import this file from test code.
 */

// Re-export the storage key constants so tests can verify storage behavior
// without coupling to the production module's internal naming.
export const HEARTBEAT_KEY = "ndx-crash-heartbeat";
export const NAV_STATE_KEY = "ndx-crash-nav-state";
export const CRASH_HISTORY_KEY = "ndx-crash-history";
export const RECOVERY_SHOWN_KEY = "ndx-crash-recovery-shown";

// Threshold constants for assertions
export const CRASH_LOOP_WINDOW_MS = 5 * 60 * 1000;
export const CRASH_LOOP_THRESHOLD = 2;
export const MAX_CRASH_HISTORY = 10;
