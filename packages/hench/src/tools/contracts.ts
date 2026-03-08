import type { PRDStore } from "../prd/rex-gateway.js";
import type { SystemMemoryMonitor } from "../process/memory-monitor.js";

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
}

export interface RexUpdateStatusParams {
  status: string;
  reason?: string;
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
