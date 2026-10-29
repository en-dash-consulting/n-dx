import type { PRDStore } from "../prd/rex-gateway.js";
import type { SystemMemoryMonitor } from "../process/memory-monitor.js";
import type { ConfigBackstop } from "../guard/config-backstop.js";

/**
 * Minimal guard contract required by tool handlers.
 * GuardRails satisfies this interface.
 */
export interface ToolGuard {
  checkPath(filepath: string): string;
  checkCommand(command: string): void;
  checkGitSubcommand(subcommand: string): void;
  recordFileRead(filepath: string): void;
  recordFileWrite(filepath: string, bytesWritten: number): void;
  readonly maxFileSize: number;
  readonly commandTimeout: number;
  /**
   * `write_file` refuses to replace an existing file with content smaller than
   * this share of its size unless the call sets `rewrite: true`. 0 disables the
   * check; absent means the default (0.5). Optional so lightweight test guards
   * need not provide it.
   */
  readonly writeShrinkRatio?: number;
  /** Existing files at or below this many bytes are exempt (default 1024). */
  readonly writeShrinkMinBytes?: number;
  /**
   * Environment for processes the tools spawn, already filtered of
   * credential-shaped variables. Optional so lightweight test guards need not
   * provide one; tools fall back to `process.env` when it is absent.
   */
  readonly childEnv?: NodeJS.ProcessEnv;
}

/**
 * Context passed to tool implementations during agent execution.
 */
export interface ToolContext {
  guard: ToolGuard;
  projectDir: string;
  store: PRDStore;
  taskId: string;
  /** Test command for completion validation (from project config). */
  testCommand?: string;
  /** Commit hash captured before the agent started, for diffing against. */
  startingHead?: string;
  /** System memory monitor for pre-spawn checks. */
  memoryMonitor?: SystemMemoryMonitor;
  /** When true, the agent is in self-heal mode (stricter completion validation). */
  selfHeal?: boolean;
  /**
   * The run's snapshot of n-dx's own config files. `dispatchTool` puts back
   * whatever a call changed before the next call can read it.
   */
  configBackstop?: ConfigBackstop;
}

export interface RexUpdateStatusParams {
  status: string;
  reason?: string;
  resolutionType?: string;
}

export interface RexAppendLogParams {
  event: string;
  detail?: string;
}

export interface RexAddSubtaskParams {
  title: string;
  description?: string;
  priority?: string;
}

/**
 * Agent-core provided handlers for Rex mutations.
 * Tool dispatch depends on this interface instead of concrete Rex modules
 * to avoid a reverse dependency into orchestration code.
 */
export interface RexToolHandlers {
  updateStatus(
    ctx: ToolContext,
    params: RexUpdateStatusParams,
  ): Promise<string>;
  appendLog(
    ctx: ToolContext,
    params: RexAppendLogParams,
  ): Promise<string>;
  addSubtask(
    ctx: ToolContext,
    params: RexAddSubtaskParams,
  ): Promise<string>;
}

/**
 * Result returned by tool implementations.
 */
export type ToolResult = string;
