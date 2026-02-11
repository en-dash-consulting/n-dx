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
} from "./exec.js";

export type {
  ExecResult,
  ExecOptions,
} from "./exec.js";
