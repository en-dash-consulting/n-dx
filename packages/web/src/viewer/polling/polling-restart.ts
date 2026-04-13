/**
 * Polling restart coordinator.
 *
 * Bridges the graceful-degradation system to the centralized polling-state
 * manager. When memory pressure disables the `autoRefresh` feature, this
 * module calls `suspendAllSources()` to halt all non-essential polling
 * sources in one atomic operation. When pressure subsides and `autoRefresh`
 * is re-enabled, it calls `resumeAllSources()` to restart everything at
 * original intervals.
 *
 * This provides a safety net that ensures **all** polling loops stop and
 * restart together, even if an individual component forgets to handle
 * degradation on its own. Components that also track degradation individually
 * (e.g. status-indicators, use-app-data) coexist harmlessly — suspending
 * an already-suspended source or resuming an already-active one is a no-op
 * in both polling-state and polling-manager.
 *
 * Flow:
 *
 *   memory-monitor  →  graceful-degradation  →  polling-restart
 *                                                     ↓
 *                                               polling-state
 *                                                ↓         ↓
 *                                          polling-manager  tick-timer
 *
 * Designed as a standalone module with zero framework dependencies.
 * The degradation callbacks are injected by the caller (bootstrap.ts) so
 * this module does not depend on the performance zone directly.
 */

import {
  suspendAllSources,
  resumeAllSources,
  isGlobalSuspended,
  getGeneration,
  isGenerationCurrent,
} from "./polling-state.js";

// ─── Injection types ─────────────────────────────────────────────────────────

/** Minimal degradation state slice required by this module. */
type DegradationStateSlice = { disabledFeatures: ReadonlySet<string> };

/**
 * Callbacks injected by bootstrap.ts to decouple this module from the
 * performance zone. Follows the injection seam pattern (see CLAUDE.md).
 */
export interface PollingRestartOptions {
  /** Subscribe to degradation state changes. Returns an unsubscribe function. */
  onDegradationChange: (
    handler: (state: DegradationStateSlice) => void,
  ) => () => void;
  /**
   * Check whether a specific feature is currently disabled.
   * Only `"autoRefresh"` is checked by this module; the narrow type ensures
   * any `(feature: DegradableFeature) => boolean` implementation is assignable
   * without needing to import DegradableFeature here.
   */
  isFeatureDisabled: (feature: "autoRefresh") => boolean;
}

// ─── Module state ────────────────────────────────────────────────────────────

let unsubscribeDegradation: (() => void) | null = null;
let started = false;

/**
 * Whether the coordinator has triggered a global suspension.
 * Tracked separately from polling-state's `isGlobalSuspended()` so we
 * only call `resumeAllSources()` if **we** were the ones who suspended
 * — avoids interfering with other suspension triggers (e.g. a future
 * manual pause button).
 */
let coordinatorSuspended = false;

// ─── Internal handler ────────────────────────────────────────────────────────

function handleDegradationChange(state: DegradationStateSlice): void {
  const autoRefreshDisabled = state.disabledFeatures.has("autoRefresh");

  if (autoRefreshDisabled && !coordinatorSuspended) {
    // Memory pressure activated — suspend all non-essential sources.
    coordinatorSuspended = true;
    suspendAllSources();
  } else if (!autoRefreshDisabled && coordinatorSuspended) {
    // Memory pressure cleared — restart all sources at original intervals.
    coordinatorSuspended = false;
    resumeAllSources();
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Start the polling restart coordinator.
 *
 * Subscribes to degradation changes and evaluates the current state
 * immediately. If `autoRefresh` is already disabled (e.g. the coordinator
 * is started after memory pressure began), sources are suspended at once.
 *
 * Safe to call multiple times — restarts cleanly.
 *
 * @param options - Degradation callbacks injected by bootstrap.ts.
 */
export function startPollingRestart(options: PollingRestartOptions): void {
  if (started) stopPollingRestart();

  started = true;
  coordinatorSuspended = false;

  // Subscribe to ongoing degradation changes.
  unsubscribeDegradation = options.onDegradationChange(handleDegradationChange);

  // Evaluate current state immediately (handles late-start scenarios).
  if (options.isFeatureDisabled("autoRefresh")) {
    coordinatorSuspended = true;
    suspendAllSources();
  }
}

/**
 * Stop the polling restart coordinator.
 *
 * Unsubscribes from degradation changes. If the coordinator had
 * triggered a global suspension, sources are resumed to avoid
 * leaving polling permanently frozen.
 */
export function stopPollingRestart(): void {
  if (unsubscribeDegradation) {
    unsubscribeDegradation();
    unsubscribeDegradation = null;
  }

  // If we suspended sources, resume them so we don't leave
  // polling frozen after the coordinator is stopped.
  if (coordinatorSuspended) {
    coordinatorSuspended = false;
    resumeAllSources();
  }

  started = false;
}

