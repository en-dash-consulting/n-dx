/**
 * Graceful degradation manager for memory-constrained environments.
 *
 * Subscribes to the memory monitor and progressively disables non-essential
 * features as memory usage rises through threshold levels. Features are
 * re-enabled automatically when memory pressure subsides.
 *
 * Degradation tiers (cumulative — each tier includes all previous restrictions):
 *
 *   normal   → All features active.
 *   elevated → Pause data polling, skip deferred module loading.
 *   warning  → Disable CSS animations (and other non-essential UI motion).
 *   critical → Disable detail panel, reduce to minimal UI.
 *
 * Designed as a standalone module with zero framework dependencies —
 * the Preact hook (`useGracefulDegradation`) is provided separately.
 */

import type { MemoryLevel, MemorySnapshot } from "./memory-monitor.js";
import { onSnapshot, getCurrentLevel, getLatestSnapshot } from "./memory-monitor.js";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Features that can be individually degraded.
 *
 * Each feature maps to a user-facing capability that consumes significant
 * memory or CPU. The degradation manager disables features from the bottom
 * of the list upwards as memory pressure increases.
 */
export type DegradableFeature =
  | "autoRefresh"      // Data polling for live updates
  | "deferredLoading"  // Background loading of non-critical data modules
  | "animations"       // CSS transitions and animations
  | "detailPanel";     // Side detail panel for file/zone inspection

/** Read-only snapshot of the current degradation state. */
export interface DegradationState {
  /** Current degradation tier, mirrors the memory level. */
  readonly tier: MemoryLevel;
  /** Set of features currently disabled due to memory pressure. */
  readonly disabledFeatures: ReadonlySet<DegradableFeature>;
  /** Whether *any* degradation is active (tier !== "normal"). */
  readonly isDegraded: boolean;
  /** Human-readable summary of what's disabled and why. */
  readonly summary: string;
}

/** Callback invoked when the degradation state changes. */
export type DegradationChangeHandler = (
  state: DegradationState,
  previousTier: MemoryLevel
) => void;

/** Configuration for the degradation manager. */
export interface DegradationConfig {
  /** Called when the degradation tier changes. */
  onChange: DegradationChangeHandler | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Which features to disable at each memory level.
 *
 * Degradation is cumulative: "warning" includes everything from "elevated"
 * plus its own additions.
 */
const TIER_FEATURES: Record<MemoryLevel, DegradableFeature[]> = {
  normal: [],
  elevated: ["autoRefresh", "deferredLoading"],
  warning: ["autoRefresh", "deferredLoading", "animations"],
  critical: ["autoRefresh", "deferredLoading", "animations", "detailPanel"],
};

const TIER_SUMMARIES: Record<MemoryLevel, string> = {
  normal: "",
  elevated:
    "Memory usage is elevated. Auto-refresh and background data loading have been paused to conserve memory.",
  warning:
    "High memory usage detected. Animations have been disabled. Close unused tabs or refresh the page.",
  critical:
    "Critical memory pressure. Most features are disabled to prevent a crash. Refresh the page to restore full functionality.",
};

const SEVERITY_ORDER: Record<MemoryLevel, number> = {
  normal: 0,
  elevated: 1,
  warning: 2,
  critical: 3,
};

// ─── Module state ────────────────────────────────────────────────────────────

let currentTier: MemoryLevel = "normal";
let disabledFeatures: Set<DegradableFeature> = new Set();
let config: DegradationConfig = { onChange: null };
let unsubscribeMonitor: (() => void) | null = null;
let listeners: Array<(state: DegradationState) => void> = [];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build the DegradationState snapshot from current module state. */
function buildState(): DegradationState {
  return {
    tier: currentTier,
    disabledFeatures: new Set(disabledFeatures),
    isDegraded: currentTier !== "normal",
    summary: TIER_SUMMARIES[currentTier],
  };
}

function notifyListeners(state: DegradationState): void {
  for (const listener of listeners) {
    try {
      listener(state);
    } catch (err) {
      console.error("[graceful-degradation] listener error:", err);
    }
  }
}

/**
 * Compute the disabled feature set for a given memory level.
 * Exported for testing.
 */
export function featuresForTier(tier: MemoryLevel): Set<DegradableFeature> {
  return new Set(TIER_FEATURES[tier]);
}

/**
 * Get the human-readable summary for a given memory level.
 * Exported for testing.
 */
export function summaryForTier(tier: MemoryLevel): string {
  return TIER_SUMMARIES[tier];
}

// ─── Snapshot handler ────────────────────────────────────────────────────────

function handleMemorySnapshot(snapshot: MemorySnapshot): void {
  const newTier = snapshot.level;

  if (newTier === currentTier) return;

  const previousTier = currentTier;
  currentTier = newTier;
  disabledFeatures = featuresForTier(newTier);

  const state = buildState();

  if (config.onChange) {
    config.onChange(state, previousTier);
  }

  notifyListeners(state);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Start the degradation manager. Subscribes to the memory monitor and
 * immediately evaluates the current memory level.
 *
 * Safe to call multiple times — restarts with new config.
 */
export function startDegradation(
  overrides: Partial<DegradationConfig> = {}
): void {
  stopDegradation();

  config = {
    onChange: overrides.onChange ?? null,
  };

  // Subscribe to ongoing memory snapshots.
  unsubscribeMonitor = onSnapshot(handleMemorySnapshot);

  // Evaluate current state immediately from the latest snapshot.
  const latest = getLatestSnapshot();
  if (latest) {
    handleMemorySnapshot(latest);
  }
}

/** Stop the degradation manager and clean up subscriptions. */
export function stopDegradation(): void {
  if (unsubscribeMonitor) {
    unsubscribeMonitor();
    unsubscribeMonitor = null;
  }
}

/** Subscribe to degradation state changes. Returns an unsubscribe function. */
export function onDegradationChange(
  listener: (state: DegradationState) => void
): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

/** Check whether a specific feature is currently disabled. */
export function isFeatureDisabled(feature: DegradableFeature): boolean {
  return disabledFeatures.has(feature);
}

/** Get the current degradation state. */
export function getDegradationState(): DegradationState {
  return buildState();
}

/** Get the current degradation tier. */
export function getCurrentTier(): MemoryLevel {
  return currentTier;
}

/** Reset all module state (for testing). */
export function resetDegradation(): void {
  stopDegradation();
  currentTier = "normal";
  disabledFeatures = new Set();
  config = { onChange: null };
  listeners = [];
}
