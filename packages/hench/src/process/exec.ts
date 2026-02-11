/**
 * Centralized process execution abstraction.
 *
 * All child-process spawning within hench routes through this module.
 * The actual implementation lives in @n-dx/claude-client (foundation layer);
 * this file re-exports those helpers so existing hench consumers continue
 * to import from their familiar `../process/exec.js` path.
 *
 * @module hench/process/exec
 */

export {
  exec,
  execStdout,
  execShellCmd,
  getCurrentHead,
} from "@n-dx/claude-client";

export type {
  ExecResult,
  ExecOptions,
} from "@n-dx/claude-client";
