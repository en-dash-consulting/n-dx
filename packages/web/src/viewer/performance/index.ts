/**
 * Performance zone public interface.
 *
 * All cross-zone consumers should import from this barrel rather than
 * individual implementation files. Type-only imports are excluded per
 * the gateway pattern (erased at compile time, stay at call-site).
 */

// ── Graceful degradation ──────────────────────────────────────────────────────

export {
  isFeatureDisabled,
  onDegradationChange,
  type DegradableFeature,
  type DegradationState,
  type DegradationChangeHandler,
} from "./graceful-degradation.js";

// ── Memory monitor ────────────────────────────────────────────────────────────

export {
  formatBytes,
  formatRatio,
  type MemorySnapshot,
  type MemoryLevel,
} from "./memory-monitor.js";

// ── DOM update gate ───────────────────────────────────────────────────────────

export {
  createDomUpdateGate,
  type DomUpdateGate,
  type DomUpdateGateConfig,
} from "./dom-update-gate.js";

// ── Response buffer gate ──────────────────────────────────────────────────────

export {
  createResponseBufferGate,
  type ResponseBufferGate,
  type ResponseBufferGateConfig,
} from "./response-buffer-gate.js";

// ── Update batcher ────────────────────────────────────────────────────────────

export {
  createUpdateBatcher,
  type UpdateBatcher,
  type UpdateBatcherConfig,
} from "./update-batcher.js";

// ── Refresh throttle ──────────────────────────────────────────────────────────

export {
  type RefreshQueueState,
  type RefreshPriority,
} from "./refresh-throttle.js";

// ── DOM performance monitor ──────────────────────────────────────────────────

export {
  countDOMNodes,
  readHeapUsage,
  formatDuration,
  formatNodeCount,
  formatDelta,
  recordRender,
  recordUpdate,
  measureOperation,
  takeDOMSnapshot,
  computeSummary,
  onDOMSnapshot,
  setObservedContainer,
  startDOMPerformanceMonitor,
  stopDOMPerformanceMonitor,
  getLatestDOMSnapshot,
  getDOMSnapshotHistory,
  getRenderTimings,
  getUpdateComparisons,
  getObservedContainer,
  resetDOMPerformanceMonitor,
  type DOMNodeSnapshot,
  type RenderTiming,
  type UpdateComparison,
  type PerformanceSummary,
  type DOMPerformanceConfig,
  type DOMSnapshotHandler,
} from "./dom-performance-monitor.js";
