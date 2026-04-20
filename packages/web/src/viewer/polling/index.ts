/**
 * Polling zone public interface.
 *
 * All cross-zone consumers should import from this barrel rather than
 * individual implementation files.
 */

export {
  startPollingManager,
  stopPollingManager,
  registerPoller,
  unregisterPoller,
  suspendAll,
  resumeAll,
  isSuspended,
  isPollerActive,
  getRegisteredPollers,
  getPollerCount,
  resetPollingManager,
} from "./polling-manager.js";

export {
  startPollingRestart,
  stopPollingRestart,
  type PollingRestartOptions,
} from "./engine/index.js";

export {
  createTickVisibilityGate,
} from "./tick-visibility-gate.js";

export {
  onTick,
  suspendTickTimer,
  resumeTickTimer,
  getTickTimerState,
  resetTickTimer,
} from "./tick-timer.js";

export {
  registerTickUpdater,
} from "./batched-tick-dispatcher.js";

// ── Polling state — cross-zone API ───────────────────────────────────────────

export {
  registerPollingSource,
  unregisterPollingSource,
  suspendAllSources,
  resumeAllSources,
  disposeAllSources,
  isGlobalSuspended,
  getGeneration,
  isGenerationCurrent,
  onPollingStateChange,
  getPollingState,
  resetPollingState,
  type PollingSourceCallbacks,
  type PollingSourceConfig,
  type PollingSourceInfo,
  type PollingSourceStatus,
  type PollingStateSnapshot,
  type PollingStateChangeHandler,
} from "./engine/index.js";

// ── Preact hooks ────────────────────────────────────────────────────────────

export {
  usePollingSuspension,
  type UsePollingSuspensionResult,
} from "./engine/index.js";

// ── Tab visibility ──────────────────────────────────────────────────────────

export {
  startTabVisibilityMonitor,
  stopTabVisibilityMonitor,
  onVisibilityChange,
  getTabVisibility,
  getTabVisibilitySnapshot,
  isTabVisible,
  getVisibilityCapabilities,
  getTransitionHistory,
  resetTabVisibility,
  detectVisibilityAPI,
  type TabVisibilityState,
  type TabVisibilitySnapshot,
  type VisibilityChangeHandler,
  type TabVisibilityConfig,
  type VisibilityDetectionMethod,
  type VisibilityAPICapabilities,
  type VisibilityTransition,
} from "./tab-visibility.js";
