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
