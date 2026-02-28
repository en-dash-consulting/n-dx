/**
 * Process execution — centralized child-process management.
 *
 * @module hench/process
 */

export {
  exec,
  execStdout,
  execShellCmd,
  getCurrentHead,
  getCurrentBranch,
  isExecutableOnPath,
} from "./exec.js";

export type {
  ExecResult,
  ExecOptions,
} from "./exec.js";

export { execShell } from "./exec-shell.js";
export type { ExecShellOptions } from "./exec-shell.js";

export { ProcessLimiter, ProcessLimitReachedError } from "./limiter.js";

export {
  ProcessLifecycleValidator,
  LifecycleAuditTrail,
} from "./lifecycle.js";

export type {
  LifecycleEvent,
  TerminationReport,
  OrphanReport,
  ResourceSnapshot,
  ResourceThresholds,
  ProcessLifecycleValidatorOptions,
} from "./lifecycle.js";

export {
  MemoryThrottle,
  MemoryThrottleRejectError,
  DEFAULT_MEMORY_THROTTLE_CONFIG,
} from "./memory-throttle.js";

export type {
  MemoryThrottleConfig,
  MemoryThrottleStatus,
  ThrottleDecision,
  SystemMemoryReader,
} from "./memory-throttle.js";

export {
  SystemMemoryMonitor,
  DEFAULT_MEMORY_MONITOR_CONFIG,
} from "./memory-monitor.js";

export type {
  MemoryMonitorConfig,
  SystemMemorySnapshot,
  SpawnMemoryCheck,
  MemoryMonitorOverrides,
} from "./memory-monitor.js";

export {
  RuntimePool,
  PoolExhaustedError,
  DEFAULT_RUNTIME_POOL_CONFIG,
} from "./pool.js";

export type {
  RuntimePoolConfig,
  WorkerHandle,
  WorkerFactory,
  WorkerState,
  PooledRuntime,
  PooledRuntimeInfo,
  RuntimePoolStatus,
} from "./pool.js";

export {
  ProcessMemoryTracker,
  DEFAULT_PROCESS_MEMORY_TRACKER_CONFIG,
} from "./process-memory-tracker.js";

export type {
  ProcessMemoryTrackerConfig,
  ProcessMemorySample,
  MemoryTrend,
  ProcessMemoryHistory,
  LeakReport,
  LeakDetectionSummary,
} from "./process-memory-tracker.js";

export {
  ConcurrentExecutionMetrics,
  DEFAULT_CONCURRENT_EXECUTION_METRICS_CONFIG,
} from "./concurrent-execution-metrics.js";

export type {
  ConcurrentExecutionMetricsConfig,
  ExecutionMetricsSnapshot,
  TaskResourceMetrics,
  UtilizationPatterns,
  ExecutionMetricsSummary,
} from "./concurrent-execution-metrics.js";
