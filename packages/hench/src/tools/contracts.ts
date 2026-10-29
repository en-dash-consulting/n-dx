import type { PRDStore } from "../prd/rex-gateway.js";
import type { SystemMemoryMonitor } from "../process/memory-monitor.js";
import type { ToolSandbox } from "../guard/sandbox.js";
import type { PolicyEngine } from "../guard/policy.js";
import type { ConfigBackstop } from "../guard/config-backstop.js";

/**
 * Minimal guard contract required by tool handlers.
 * GuardRails satisfies this interface.
 */
export interface ToolGuard {
  checkPath(filepath: string): string;
  /**
   * Non-throwing form of `checkPath` for directory walks: whether an entry
   * passes the same containment and blocked-path checks. A walk leaves a
   * refused entry out and does not descend into it.
   */
  isPathAllowed(filepath: string): boolean;
  checkCommand(command: string): void;
  checkGitSubcommand(subcommand: string): void;
  recordFileRead(filepath: string): void;
  recordFileWrite(filepath: string, bytesWritten: number): void;
  readonly maxFileSize: number;
  readonly commandTimeout: number;
  /**
   * Environment for processes the tools spawn, already filtered of
   * credential-shaped variables. Optional so lightweight test guards need not
   * provide one; tools fall back to `process.env` when it is absent.
   */
  readonly childEnv?: NodeJS.ProcessEnv;
  /**
   * OS-level confinement every tool child is spawned inside. Optional so
   * lightweight test guards need not provide one; absent means unconfined.
   */
  readonly sandbox?: ToolSandbox | null;
  /**
   * The session policy engine whose audit the run record keeps. Optional so
   * lightweight test guards need not provide one; absent means no audit.
   */
  readonly policy?: Pick<PolicyEngine, "runAudit">;
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
