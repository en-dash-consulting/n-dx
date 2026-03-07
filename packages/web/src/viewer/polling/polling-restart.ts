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
 */

import {
  suspendAllSources,
  resumeAllSources,
  isGlobalSuspended,
  getGeneration,
  isGenerationCurrent,
} from "./polling-state.js";
import {
  onDegradationChange,
  isFeatureDisabled,
  type DegradationState,
} from "../performance/graceful-degradation.js";

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

function handleDegradationChange(state: DegradationState): void {
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
 */
export function startPollingRestart(): void {
  if (started) stopPollingRestart();

  started = true;
  coordinatorSuspended = false;

  // Subscribe to ongoing degradation changes.
  unsubscribeDegradation = onDegradationChange(handleDegradationChange);

  // Evaluate current state immediately (handles late-start scenarios).
  if (isFeatureDisabled("autoRefresh")) {
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

/**
 * Check if the coordinator is currently running.
 */
export function isPollingRestartStarted(): boolean {
  return started;
}

/**
 * Check if the coordinator has triggered a global suspension.
 */
export function isCoordinatorSuspended(): boolean {
  return coordinatorSuspended;
}

/**
 * Reset all module state (for testing).
 */
export function resetPollingRestart(): void {
  stopPollingRestart();
  started = false;
  coordinatorSuspended = false;
}
