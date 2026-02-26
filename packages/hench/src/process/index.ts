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
