import { PROJECT_DIRS } from "@n-dx/llm-client";
export type { MemoryThrottleConfig } from "../process/memory-throttle.js";
export type { MemoryMonitorConfig } from "../process/memory-monitor.js";
export type { RuntimePoolConfig } from "../process/pool.js";
import type { MemoryThrottleConfig } from "../process/memory-throttle.js";
import type { MemoryMonitorConfig } from "../process/memory-monitor.js";
import type { RuntimePoolConfig } from "../process/pool.js";

export const HENCH_SCHEMA_VERSION = "hench/v1";

/**
 * Configurable subset of policy limits (all optional, defaults applied at runtime).
 *
 * Defined here (schema) rather than in guard/contracts so that schema/v1
 * stays self-contained and guard stays free of schema imports.  The two
 * definitions are structurally identical; TypeScript's structural typing
 * ensures they remain compatible wherever HenchConfig.guard is passed to
 * GuardRails (which accepts the guard-owned GuardConfig interface).
 */
export interface PolicyLimitsConfig {
  /** Maximum commands per minute (0 = unlimited). */
  maxCommandsPerMinute?: number;
  /** Maximum file writes per minute (0 = unlimited). */
  maxWritesPerMinute?: number;
  /** Maximum total bytes written in the session (0 = unlimited). */
  maxTotalBytesWritten?: number;
  /** Maximum total commands in the session (0 = unlimited). */
  maxTotalCommands?: number;
}

/**
 * Security guard configuration embedded in {@link HenchConfig}.
 *
 * Defined here (schema) rather than in guard/contracts so that schema/v1
 * stays self-contained and guard stays free of schema imports.  The two
 * definitions are structurally identical; TypeScript's structural typing
 * ensures they remain compatible wherever HenchConfig.guard is passed to
 * GuardRails (which accepts the guard-owned GuardConfig interface).
 */
export interface GuardConfig {
  blockedPaths: string[];
  allowedCommands: string[];
  commandTimeout: number;
  maxFileSize: number;
  /** Timeout in ms for spawn-based execution (spawnTool/spawnManaged). 0 = no timeout. */
  spawnTimeout: number;
  /** Maximum concurrent child processes allowed. */
  maxConcurrentProcesses: number;
  /** Allowed git subcommands. Centralizes the git safety allowlist in guard config. */
  allowedGitSubcommands: string[];
  /** Policy limits for session-aware rate limiting and resource tracking. */
  policy?: PolicyLimitsConfig;
  /** Memory-based execution throttling configuration. */
  memoryThrottle?: Partial<MemoryThrottleConfig>;
  /** Pre-spawn memory monitoring configuration. */
  memoryMonitor?: Partial<MemoryMonitorConfig>;
  /** Runtime process pool configuration for warm worker reuse. */
  pool?: Partial<RuntimePoolConfig>;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export type Provider = "cli" | "api";

export interface HenchConfig {
  schema: string;
  provider: Provider;
  model: string;
  maxTurns: number;
  maxTokens: number;
  /** Total token budget per run (input + output). 0 = unlimited. */
  tokenBudget: number;
  rexDir: string;
  apiKeyEnv: string;
  guard: GuardConfig;
  retry: RetryConfig;
  loopPauseMs: number;
  maxFailedAttempts: number;
}

export function DEFAULT_HENCH_CONFIG(): HenchConfig {
  return {
    schema: HENCH_SCHEMA_VERSION,
    provider: "cli",
    model: "sonnet",
    maxTurns: 50,
    maxTokens: 8192,
    tokenBudget: 0,
    rexDir: PROJECT_DIRS.REX,
    apiKeyEnv: "ANTHROPIC_API_KEY",
    guard: {
      blockedPaths: [`${PROJECT_DIRS.HENCH}/**`, `${PROJECT_DIRS.REX}/**`, ".git/**", "node_modules/**"],
      allowedCommands: ["npm", "npx", "node", "git", "tsc", "vitest"],
      commandTimeout: 30000,
      maxFileSize: 1048576,
      spawnTimeout: 300000,          // 5 minutes
      maxConcurrentProcesses: 3,
      allowedGitSubcommands: [
        "status", "add", "commit", "diff", "log",
        "branch", "checkout", "stash", "show", "rev-parse",
      ],
    },
    retry: {
      maxRetries: 3,
      baseDelayMs: 2000,
      maxDelayMs: 30000,
    },
    loopPauseMs: 2000,
    maxFailedAttempts: 3,
  };
}

export type RunStatus = "running" | "completed" | "failed" | "timeout" | "budget_exceeded" | "error_transient";

export interface ToolCallRecord {
  turn: number;
  tool: string;
  input: Record<string, unknown>;
  output: string;
  durationMs: number;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheCreationInput?: number;
  cacheReadInput?: number;
}

/** Token usage for a single API turn. */
export interface TurnTokenUsage {
  turn: number;
  input: number;
  output: number;
  cacheCreationInput?: number;
  cacheReadInput?: number;
  /** LLM vendor used for this token event (e.g. "claude", "codex"). */
  vendor?: string;
  /** Model used for this token event. */
  model?: string;
}

export interface CommandRecord {
  command: string;
  exitStatus: "ok" | "error" | "timeout" | "blocked";
  durationMs: number;
}

export interface TestRecord {
  command: string;
  passed: boolean;
  durationMs: number;
}

export interface SummaryCounts {
  filesRead: number;
  filesChanged: number;
  commandsExecuted: number;
  testsRun: number;
  toolCallsTotal: number;
}

export interface PostRunTestRecord {
  /** Whether tests were executed. */
  ran: boolean;
  /** Whether all tests passed. */
  passed: boolean;
  /** The command that was executed. */
  command?: string;
  /** Human-readable test output (truncated). */
  output?: string;
  /** Duration in ms. */
  durationMs?: number;
  /** Test files that were specifically targeted. Empty if full suite. */
  targetedFiles: string[];
  /** Error message if tests couldn't be run. */
  error?: string;
}

export interface RunSummaryData {
  filesChanged: string[];
  filesRead: string[];
  commandsExecuted: CommandRecord[];
  testsRun: TestRecord[];
  /** Automatic post-task test results. */
  postRunTests?: PostRunTestRecord;
  counts: SummaryCounts;
}

export interface RunMemoryStats {
  /** Peak RSS of the hench process during this run (bytes). */
  peakRssBytes: number;
  /** System available memory at run start (bytes). -1 if unavailable. */
  systemAvailableAtStartBytes: number;
  /** System available memory at run end (bytes). -1 if unavailable. */
  systemAvailableAtEndBytes: number;
  /** System total memory (bytes). */
  systemTotalBytes: number;
}

export interface RunRecord {
  id: string;
  taskId: string;
  taskTitle: string;
  startedAt: string;
  finishedAt?: string;
  /** ISO timestamp of the most recent agent activity. Updated on every periodic save. */
  lastActivityAt?: string;
  status: RunStatus;
  turns: number;
  summary?: string;
  error?: string;
  tokenUsage: TokenUsage;
  /** Per-turn token breakdown. One entry per API call. */
  turnTokenUsage?: TurnTokenUsage[];
  toolCalls: ToolCallRecord[];
  model: string;
  retryAttempts?: number;
  /** Structured metadata derived from tool calls at run finalization. */
  structuredSummary?: RunSummaryData;
  /** Memory usage statistics captured during the run. */
  memoryStats?: RunMemoryStats;
}

export interface TaskBriefTask {
  id: string;
  title: string;
  level: string;
  status: string;
  description?: string;
  acceptanceCriteria?: string[];
  priority?: string;
  tags?: string[];
  blockedBy?: string[];
  failureReason?: string;
}

export interface TaskBriefParent {
  id: string;
  title: string;
  level: string;
  description?: string;
}

export interface TaskBriefSibling {
  id: string;
  title: string;
  status: string;
}

export interface TaskBriefProject {
  name: string;
  validateCommand?: string;
  testCommand?: string;
}

export interface TaskBriefLogEntry {
  timestamp: string;
  event: string;
  detail?: string;
}

/**
 * A requirement included in the task brief for agent awareness.
 */
export interface TaskBriefRequirement {
  id: string;
  title: string;
  category: string;
  validationType: string;
  acceptanceCriteria: string[];
  /** Where this requirement was defined (item title). */
  source: string;
}

export interface TaskBrief {
  task: TaskBriefTask;
  parentChain: TaskBriefParent[];
  siblings: TaskBriefSibling[];
  /** Requirements that apply to this task (own + inherited). */
  requirements: TaskBriefRequirement[];
  project: TaskBriefProject;
  workflow: string;
  recentLog: TaskBriefLogEntry[];
}
