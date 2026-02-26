/**
 * Centralized polling manager with tab visibility integration.
 *
 * Provides a registry for all polling intervals across the application.
 * When the browser tab is backgrounded, all registered pollers are
 * suspended to conserve resources. When the tab regains focus, pollers
 * are resumed with their original intervals.
 *
 * Rapid visibility changes (e.g. quick alt-tab sequences) are debounced
 * to avoid thrashing interval creation/destruction.
 *
 * Designed as a standalone module with zero framework dependencies —
 * the Preact hook (`usePolling`) is provided separately.
 */

import {
  onVisibilityChange,
  isTabVisible,
  type TabVisibilitySnapshot,
} from "./tab-visibility.js";

// ─── Types ───────────────────────────────────────────────────────────────────

/** A registered poller entry in the registry. */
interface PollerEntry {
  /** Unique key identifying this poller. */
  readonly key: string;
  /** The function to call on each interval tick. */
  callback: () => void;
  /** The polling interval in milliseconds. */
  intervalMs: number;
  /** The active timer ID, or null if suspended. */
  timerId: ReturnType<typeof setInterval> | null;
}

/** Read-only view of a registered poller for external inspection. */
export interface PollerInfo {
  readonly key: string;
  readonly intervalMs: number;
  readonly active: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Debounce delay for visibility-triggered resume (ms).
 * Prevents thrashing when the user rapidly switches between tabs.
 * Suspension is immediate (no debounce) to stop work quickly.
 */
const RESUME_DEBOUNCE_MS = 100;

// ─── Module state ────────────────────────────────────────────────────────────

const pollers = new Map<string, PollerEntry>();
let visibilityUnsub: (() => void) | null = null;
let started = false;
let suspended = false;
let resumeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Internal helpers ────────────────────────────────────────────────────────

/** Start a poller's interval timer. */
function activatePoller(entry: PollerEntry): void {
  if (entry.timerId !== null) return; // already active
  entry.timerId = setInterval(entry.callback, entry.intervalMs);
}

/** Stop a poller's interval timer without removing it from the registry. */
function deactivatePoller(entry: PollerEntry): void {
  if (entry.timerId === null) return; // already inactive
  clearInterval(entry.timerId);
  entry.timerId = null;
}

/** Handle visibility change events from the tab-visibility module. */
function handleVisibilityChange(snapshot: TabVisibilitySnapshot): void {
  if (snapshot.isVisible) {
    // Tab became visible — resume with debounce to handle rapid toggling.
    if (resumeDebounceTimer !== null) {
      clearTimeout(resumeDebounceTimer);
    }
    resumeDebounceTimer = setTimeout(() => {
      resumeDebounceTimer = null;
      resumeAll();
    }, RESUME_DEBOUNCE_MS);
  } else {
    // Tab became hidden — suspend immediately.
    // Cancel any pending resume first.
    if (resumeDebounceTimer !== null) {
      clearTimeout(resumeDebounceTimer);
      resumeDebounceTimer = null;
    }
    suspendAll();
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Start the polling manager. Subscribes to tab visibility changes
 * and enables automatic suspend/resume of registered pollers.
 *
 * Safe to call multiple times — restarts cleanly.
 */
export function startPollingManager(): void {
  if (started) stopPollingManager();

  started = true;
  suspended = false;

  // Subscribe to tab visibility changes.
  visibilityUnsub = onVisibilityChange(handleVisibilityChange);

  // If the tab is currently hidden, start in suspended state.
  if (!isTabVisible()) {
    suspended = true;
  }
}

/**
 * Stop the polling manager. Unsubscribes from visibility changes
 * but does NOT clear registered pollers or their timers.
 */
export function stopPollingManager(): void {
  if (visibilityUnsub) {
    visibilityUnsub();
    visibilityUnsub = null;
  }

  if (resumeDebounceTimer !== null) {
    clearTimeout(resumeDebounceTimer);
    resumeDebounceTimer = null;
  }

  started = false;
}

/**
 * Register a polling interval. The callback will be called every
 * `intervalMs` milliseconds while the tab is visible.
 *
 * If the tab is currently hidden and the manager is started,
 * the poller is registered but not activated until the tab becomes visible.
 *
 * Returns an unregister function for cleanup.
 *
 * @param key - Unique identifier for this poller. Re-registering with the
 *              same key replaces the previous entry.
 * @param callback - Function to call on each tick.
 * @param intervalMs - Polling interval in milliseconds.
 */
export function registerPoller(
  key: string,
  callback: () => void,
  intervalMs: number
): () => void {
  // If a poller with this key already exists, clean it up first.
  const existing = pollers.get(key);
  if (existing) {
    deactivatePoller(existing);
  }

  const entry: PollerEntry = {
    key,
    callback,
    intervalMs,
    timerId: null,
  };

  pollers.set(key, entry);

  // Only activate if the manager is started and not suspended.
  if (started && !suspended) {
    activatePoller(entry);
  } else if (!started) {
    // Manager not started — activate immediately (unmanaged mode).
    activatePoller(entry);
  }

  return () => unregisterPoller(key);
}

/**
 * Remove a poller from the registry and clear its interval.
 */
export function unregisterPoller(key: string): void {
  const entry = pollers.get(key);
  if (!entry) return;
  deactivatePoller(entry);
  pollers.delete(key);
}

/**
 * Suspend all registered pollers. Clears their interval timers
 * but keeps them in the registry for later resumption.
 */
export function suspendAll(): void {
  suspended = true;
  for (const entry of pollers.values()) {
    deactivatePoller(entry);
  }
}

/**
 * Resume all registered pollers. Restarts their interval timers
 * with their original intervals.
 */
export function resumeAll(): void {
  suspended = false;
  for (const entry of pollers.values()) {
    activatePoller(entry);
  }
}

/**
 * Check if the polling manager is currently in a suspended state.
 */
export function isSuspended(): boolean {
  return suspended;
}

/**
 * Check if a specific poller is actively running (has a timer).
 */
export function isPollerActive(key: string): boolean {
  const entry = pollers.get(key);
  return entry !== null && entry !== undefined && entry.timerId !== null;
}

/**
 * Get read-only information about all registered pollers.
 */
export function getRegisteredPollers(): readonly PollerInfo[] {
  const result: PollerInfo[] = [];
  for (const entry of pollers.values()) {
    result.push({
      key: entry.key,
      intervalMs: entry.intervalMs,
      active: entry.timerId !== null,
    });
  }
  return result;
}

/**
 * Get the number of registered pollers.
 */
export function getPollerCount(): number {
  return pollers.size;
}

/**
 * Reset all module state (for testing). Clears all pollers, stops the
 * manager, and resets the suspended flag.
 */
export function resetPollingManager(): void {
  // Clear all pollers.
  for (const entry of pollers.values()) {
    deactivatePoller(entry);
  }
  pollers.clear();

  // Stop the manager.
  stopPollingManager();

  suspended = false;
}
