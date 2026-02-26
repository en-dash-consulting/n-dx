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
