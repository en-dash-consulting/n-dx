/**
 * Centralized process execution abstraction.
 *
 * All child-process spawning within hench routes through this module.
 * The actual implementation lives in @n-dx/llm-client (foundation layer);
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
  getCurrentBranch,
  isExecutableOnPath,
  spawnTool,
  spawnManaged,
  ProcessPool,
  ProcessLimitError,
} from "../prd/llm-gateway.js";

export type {
  ExecResult,
  ExecOptions,
  SpawnToolOptions,
  SpawnToolResult,
  ManagedChild,
} from "../prd/llm-gateway.js";
