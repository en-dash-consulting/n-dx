/**
 * Client-side crash detection and automatic recovery.
 *
 * Detects memory-related browser crashes using a sessionStorage heartbeat:
 * a "running" flag is set on page load and cleared on clean unload. If the
 * flag is still present at next load, the previous session ended abnormally
 * — most likely an OOM crash or browser-killed tab (error code 5).
 *
 * Tracks crash history to detect crash loops and preserves the user's
 * navigation state so it can be restored after recovery.
 *
 * Designed as a standalone module with zero framework dependencies —
 * the Preact hook (`useCrashRecovery`) is provided separately.
 */

import type { ViewId } from "../types.js";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Saved navigation state that survives a crash. */
export interface SavedNavigationState {
  view: ViewId;
  selectedFile: string | null;
  selectedZone: string | null;
  selectedRunId: string | null;
  selectedTaskId: string | null;
  timestamp: string;
}

/** Result of crash detection performed at page load. */
export interface CrashDetectionResult {
  /** Whether a crash was detected (previous session didn't unload cleanly). */
  crashed: boolean;
  /** Whether multiple crashes happened recently (crash loop). */
  crashLoop: boolean;
  /** Number of recent crashes within the loop window. */
  recentCrashCount: number;
  /** Recovered navigation state from before the crash, if available. */
  recoveredState: SavedNavigationState | null;
}

/** Crash history entry persisted across reloads. */
interface CrashRecord {
  timestamp: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** sessionStorage key: set while the page is alive, cleared on clean unload. */
const HEARTBEAT_KEY = "ndx-crash-heartbeat";

/** sessionStorage key: saved navigation state for recovery. */
const NAV_STATE_KEY = "ndx-crash-nav-state";

/** sessionStorage key: JSON array of recent crash timestamps. */
const CRASH_HISTORY_KEY = "ndx-crash-history";

/** sessionStorage key: tracks whether we've already shown recovery for this session. */
const RECOVERY_SHOWN_KEY = "ndx-crash-recovery-shown";

/** Time window for crash loop detection (5 minutes). */
const CRASH_LOOP_WINDOW_MS = 5 * 60 * 1000;

/** Number of crashes within the window that constitutes a loop. */
const CRASH_LOOP_THRESHOLD = 2;

/** Maximum crash history entries to retain. */
const MAX_CRASH_HISTORY = 10;

// ─── Storage helpers ─────────────────────────────────────────────────────────

function storageAvailable(): boolean {
  try {
    const key = "__ndx_storage_test__";
    sessionStorage.setItem(key, "1");
    sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function getJSON<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function setJSON(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable — silently ignore.
  }
}

// ─── Crash history management ────────────────────────────────────────────────

function getCrashHistory(): CrashRecord[] {
  return getJSON<CrashRecord[]>(CRASH_HISTORY_KEY) ?? [];
}

function addCrashRecord(): CrashRecord[] {
  const history = getCrashHistory();
  history.push({ timestamp: new Date().toISOString() });

  // Trim to bounded size.
  const trimmed = history.slice(-MAX_CRASH_HISTORY);
  setJSON(CRASH_HISTORY_KEY, trimmed);
  return trimmed;
}

function getRecentCrashCount(history: CrashRecord[]): number {
  const cutoff = Date.now() - CRASH_LOOP_WINDOW_MS;
  return history.filter((r) => new Date(r.timestamp).getTime() > cutoff).length;
}

// ─── Heartbeat lifecycle ─────────────────────────────────────────────────────

/** Set the heartbeat flag — call once at page startup. */
function setHeartbeat(): void {
  try {
    sessionStorage.setItem(HEARTBEAT_KEY, new Date().toISOString());
  } catch {
    // noop
  }
}

/** Clear the heartbeat flag — called on clean page unload. */
function clearHeartbeat(): void {
  try {
    sessionStorage.removeItem(HEARTBEAT_KEY);
  } catch {
    // noop
  }
}

/** Check whether the heartbeat was left set from a previous load. */
function heartbeatPresent(): boolean {
  try {
    return sessionStorage.getItem(HEARTBEAT_KEY) !== null;
  } catch {
    return false;
  }
}

// ─── Module state ────────────────────────────────────────────────────────────

let initialized = false;
let detectionResult: CrashDetectionResult | null = null;
let unloadHandler: (() => void) | null = null;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Detect whether the previous session ended in a crash.
 *
 * Must be called **once** early in page startup (before any clean unload
 * has a chance to clear the heartbeat). Returns the detection result and
 * installs the heartbeat + unload handler for this session.
 *
 * Safe to call multiple times — returns the cached result after first call.
 */
export function detectCrash(): CrashDetectionResult {
  if (detectionResult) return detectionResult;

  if (!storageAvailable()) {
    detectionResult = {
      crashed: false,
      crashLoop: false,
      recentCrashCount: 0,
      recoveredState: null,
    };
    return detectionResult;
  }

  const crashed = heartbeatPresent();
  let recoveredState: SavedNavigationState | null = null;
  let recentCrashCount = 0;
  let crashLoop = false;

  if (crashed) {
    // Record this crash in history.
    const history = addCrashRecord();
    recentCrashCount = getRecentCrashCount(history);
    crashLoop = recentCrashCount >= CRASH_LOOP_THRESHOLD;

    // Recover saved navigation state.
    recoveredState = getJSON<SavedNavigationState>(NAV_STATE_KEY);
  }

  detectionResult = { crashed, crashLoop, recentCrashCount, recoveredState };

  // Install heartbeat for this session.
  setHeartbeat();

  // Clear heartbeat on clean unload so next load won't see a false crash.
  unloadHandler = () => clearHeartbeat();
  window.addEventListener("beforeunload", unloadHandler);

  // Mark recovery as not yet shown for this session.
  try {
    sessionStorage.removeItem(RECOVERY_SHOWN_KEY);
  } catch {
    // noop
  }

  initialized = true;
  return detectionResult;
}

/**
 * Save the current navigation state so it can be restored after a crash.
 *
 * Call this on every view change to keep the saved state fresh.
 */
export function saveNavigationState(state: Omit<SavedNavigationState, "timestamp">): void {
  if (!storageAvailable()) return;
  const full: SavedNavigationState = {
    ...state,
    timestamp: new Date().toISOString(),
  };
  setJSON(NAV_STATE_KEY, full);
}

/**
 * Clear the saved navigation state (e.g. after successful recovery).
 */
export function clearSavedNavigationState(): void {
  try {
    sessionStorage.removeItem(NAV_STATE_KEY);
  } catch {
    // noop
  }
}

/**
 * Mark that the recovery banner has been shown/dismissed in this session.
 */
export function markRecoveryShown(): void {
  try {
    sessionStorage.setItem(RECOVERY_SHOWN_KEY, "true");
  } catch {
    // noop
  }
}

/**
 * Check if recovery was already shown in this session.
 */
export function wasRecoveryShown(): boolean {
  try {
    return sessionStorage.getItem(RECOVERY_SHOWN_KEY) === "true";
  } catch {
    return false;
  }
}

/** Get the cached crash detection result (null if detectCrash hasn't been called). */
export function getDetectionResult(): CrashDetectionResult | null {
  return detectionResult;
}

/** Clear the crash history. */
export function clearCrashHistory(): void {
  try {
    sessionStorage.removeItem(CRASH_HISTORY_KEY);
  } catch {
    // noop
  }
}

/** Reset all module state (for testing). */
export function resetCrashDetector(): void {
  if (unloadHandler) {
    window.removeEventListener("beforeunload", unloadHandler);
    unloadHandler = null;
  }
  initialized = false;
  detectionResult = null;

  try {
    sessionStorage.removeItem(HEARTBEAT_KEY);
    sessionStorage.removeItem(NAV_STATE_KEY);
    sessionStorage.removeItem(CRASH_HISTORY_KEY);
    sessionStorage.removeItem(RECOVERY_SHOWN_KEY);
  } catch {
    // noop
  }
}

// ─── Test helpers ────────────────────────────────────────────────────────────

/** @internal Exported for testing only. */
export const _testHelpers = {
  HEARTBEAT_KEY,
  NAV_STATE_KEY,
  CRASH_HISTORY_KEY,
  RECOVERY_SHOWN_KEY,
  CRASH_LOOP_WINDOW_MS,
  CRASH_LOOP_THRESHOLD,
  MAX_CRASH_HISTORY,
  storageAvailable,
  getJSON,
  setJSON,
  getCrashHistory,
  addCrashRecord,
  getRecentCrashCount,
  setHeartbeat,
  clearHeartbeat,
  heartbeatPresent,
};
