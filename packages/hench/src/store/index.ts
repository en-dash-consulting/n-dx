export {
  ensureHenchDir,
  loadConfig,
  saveConfig,
  configExists,
  initConfig,
} from "./config.js";

export { saveRun, loadRun, listRuns } from "./runs.js";

export { RunChangeDetector } from "./run-change-detector.js";

export {
  enforceRetentionPolicy,
  identifyRetainableRuns,
  identifyWarningRuns,
  extractUsageStats,
  loadRetentionConfig,
  DEFAULT_RETENTION_CONFIG,
} from "./run-retention.js";

export type {
  RetentionConfig,
  RetentionResult,
  PreservedUsageStats,
  RetentionLogEntry,
} from "./run-retention.js";

export {
  startRetentionScheduler,
  runRetentionCycle,
  loadRetentionIntervalMs,
  DEFAULT_RETENTION_INTERVAL_MS,
} from "./run-retention-scheduler.js";

export type {
  WarningCallback,
  RetentionSchedulerOptions,
} from "./run-retention-scheduler.js";
