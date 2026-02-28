/**
 * Public API for the hench package.
 *
 * ## API philosophy: types + schema constants + config factory
 *
 * Hench is a **CLI tool**, not a library. Other packages interact with it
 * exclusively through:
 *
 * 1. **Subprocess spawning** — `cli.js` and `web.js` invoke `hench run`
 * 2. **Filesystem reads** — the web dashboard and rex's token-usage module
 *    read `.hench/config.json` and `.hench/runs/*.json` directly from disk
 *
 * This public API exports types, schema constants, and the default config
 * factory — enough for consumers to validate JSON file shapes at compile
 * time and generate default configurations without creating unnecessary
 * runtime coupling to the agent engine.
 *
 * Each package's public surface reflects its actual consumption pattern —
 * see PACKAGE_GUIDELINES.md for the full decision tree.
 *
 * Runtime functions (agent loops, tool dispatch, guard rails) are
 * intentionally kept internal. Consumers should use the CLI binary
 * rather than calling hench as a library.
 *
 * @module hench/public
 */

// ---- Schema constants & config factory ------------------------------------

export { HENCH_SCHEMA_VERSION, DEFAULT_HENCH_CONFIG } from "./schema/v1.js";

// ---- Schema types (config, run records) ------------------------------------

export type {
  HenchConfig,
  GuardConfig,
  PolicyLimitsConfig,
  MemoryThrottleConfig,
  MemoryMonitorConfig,
  RuntimePoolConfig,
  RetryConfig,
  Provider,
  RunRecord,
  RunStatus,
  ToolCallRecord,
  TokenUsage,
  TurnTokenUsage,
  CommandRecord,
  TestRecord,
  SummaryCounts,
  PostRunTestRecord,
  RunSummaryData,
} from "./schema/v1.js";

// ---- Task brief types ------------------------------------------------------

export type {
  TaskBrief,
  TaskBriefTask,
  TaskBriefParent,
  TaskBriefSibling,
  TaskBriefProject,
  TaskBriefLogEntry,
} from "./schema/v1.js";

// ---- Workflow template types -----------------------------------------------

export { BUILT_IN_TEMPLATES } from "./schema/templates.js";

export type {
  WorkflowTemplate,
  TemplateConfigOverlay,
} from "./schema/templates.js";

// ---- Adaptive workflow adjustment types ------------------------------------

export { DEFAULT_ADAPTIVE_SETTINGS } from "./agent/analysis/adaptive.js";

export type {
  AdaptiveSettings,
  AdjustmentCategory,
  AdjustmentPriority,
  ProjectMetrics,
  WorkflowAdjustment,
  AdjustmentNotification,
  AdaptiveAnalysis,
} from "./agent/analysis/adaptive.js";

// ---- Execution queue -------------------------------------------------------

export { ExecutionQueue, normalizePriority } from "./queue/index.js";

export type {
  TaskPriority,
  QueueEntry,
  QueueStatus,
} from "./queue/index.js";

// ---- Priority scheduling ---------------------------------------------------

export { resolveSchedulingPriority, extractPriorityFromTags } from "./queue/index.js";

export type {
  TaskPriorityMetadata,
} from "./queue/index.js";

// ---- Process concurrency limiter -------------------------------------------

export { ProcessLimiter, ProcessLimitReachedError } from "./process/limiter.js";

// ---- Process lifecycle validation ------------------------------------------

export { ProcessLifecycleValidator, LifecycleAuditTrail } from "./process/lifecycle.js";

export type {
  LifecycleEvent,
  TerminationReport,
  OrphanReport,
  ResourceSnapshot,
  ResourceThresholds,
  ProcessLifecycleValidatorOptions,
} from "./process/lifecycle.js";

// ---- Memory throttle --------------------------------------------------------

export {
  MemoryThrottle,
  MemoryThrottleRejectError,
  DEFAULT_MEMORY_THROTTLE_CONFIG,
} from "./process/memory-throttle.js";

export type {
  MemoryThrottleStatus,
  ThrottleDecision,
} from "./process/memory-throttle.js";

// ---- System memory monitor --------------------------------------------------

export {
  SystemMemoryMonitor,
  DEFAULT_MEMORY_MONITOR_CONFIG,
} from "./process/memory-monitor.js";

export type {
  SystemMemorySnapshot,
  SpawnMemoryCheck,
} from "./process/memory-monitor.js";

// ---- Runtime process pool ---------------------------------------------------

export {
  RuntimePool,
  PoolExhaustedError,
  DEFAULT_RUNTIME_POOL_CONFIG,
} from "./process/pool.js";

export type {
  WorkerHandle,
  WorkerFactory,
  WorkerState,
  PooledRuntime,
  PooledRuntimeInfo,
  RuntimePoolStatus,
} from "./process/pool.js";

// ---- Process memory tracking -------------------------------------------------

export {
  ProcessMemoryTracker,
  DEFAULT_PROCESS_MEMORY_TRACKER_CONFIG,
} from "./process/process-memory-tracker.js";

export type {
  ProcessMemoryTrackerConfig,
  ProcessMemorySample,
  MemoryTrend,
  ProcessMemoryHistory,
  LeakReport,
  LeakDetectionSummary,
} from "./process/process-memory-tracker.js";

// ---- Concurrent execution metrics -------------------------------------------

export {
  ConcurrentExecutionMetrics,
  DEFAULT_CONCURRENT_EXECUTION_METRICS_CONFIG,
} from "./process/concurrent-execution-metrics.js";

export type {
  ConcurrentExecutionMetricsConfig,
  ExecutionMetricsSnapshot,
  TaskResourceMetrics,
  UtilizationPatterns,
  ExecutionMetricsSummary,
} from "./process/concurrent-execution-metrics.js";

// ---- Run file change detection ----------------------------------------------

export { RunChangeDetector } from "./store/run-change-detector.js";

export type {
  FileSnapshot,
  AggregationCheckpoint,
  RunFileChange,
  DeltaResult,
} from "./store/run-change-detector.js";

// ---- Run file archival ------------------------------------------------------

export {
  archiveOldRuns,
  identifyArchivableRuns,
  compressRunFile,
  readCompressedJSON,
  loadArchivalConfig,
  DEFAULT_ARCHIVAL_CONFIG,
} from "./store/run-archiver.js";

export type {
  ArchivalConfig,
  ArchivalResult,
  CompressedFileResult,
} from "./store/run-archiver.js";

// ---- Run history retention ---------------------------------------------------

export {
  enforceRetentionPolicy,
  identifyRetainableRuns,
  identifyWarningRuns,
  extractUsageStats,
  loadRetentionConfig,
  DEFAULT_RETENTION_CONFIG,
} from "./store/run-retention.js";

export type {
  RetentionConfig,
  RetentionResult,
  PreservedUsageStats,
  RetentionLogEntry,
} from "./store/run-retention.js";

export {
  startRetentionScheduler,
  runRetentionCycle,
  loadRetentionIntervalMs,
  DEFAULT_RETENTION_INTERVAL_MS,
} from "./store/run-retention-scheduler.js";

export type {
  WarningCallback,
  RetentionSchedulerOptions,
} from "./store/run-retention-scheduler.js";

// ---- Agent lifecycle types -------------------------------------------------

export type { AgentLoopOptions, AgentLoopResult } from "./agent/lifecycle/loop.js";
export type { CliLoopOptions, CliLoopResult } from "./agent/lifecycle/cli-loop.js";
export type { TokenBudgetResult } from "./agent/lifecycle/token-budget.js";
export type { CompletionValidationResult, CompletionValidationOptions } from "./validation/completion.js";
