import { PROJECT_DIRS } from "../prd/llm-gateway.js";
export type { MemoryThrottleConfig } from "../process/memory-throttle.js";
export type { MemoryMonitorConfig } from "../process/memory-monitor.js";
export type { RuntimePoolConfig } from "../process/pool.js";
import type { MemoryThrottleConfig } from "../process/memory-throttle.js";
import type { MemoryMonitorConfig } from "../process/memory-monitor.js";
import type { RuntimePoolConfig } from "../process/pool.js";

export const HENCH_SCHEMA_VERSION = "hench/v1";

/**
 * Supported project languages for language-aware guard configuration.
 * "auto" triggers detection during `hench init`.
 */
export type ProjectLanguage = "typescript" | "javascript" | "go";

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
  /** When true, the agent is running in self-heal mode (structural fixes). */
  selfHeal?: boolean;
  /** Detected project language. Drives guard defaults during init. */
  language?: ProjectLanguage;
  /**
   * When true, the CLI loop uses EventAccumulator for result accumulation
   * instead of inline SpawnResult mutation. Spin detection and token budget
   * checks operate on the RuntimeEvent stream via the accumulator.
   *
   * This is a migration flag — both paths produce equivalent run records.
   * Will be removed once the event pipeline is validated in production.
   */
  useEventPipeline?: boolean;
  /**
   * When true, the API loop resolves the LLM provider via ProviderRegistry
   * instead of a hardcoded Claude vendor check. Enables registry-based
   * provider resolution for future multi-vendor API support.
   *
   * This is a migration flag — both paths produce identical results for
   * Claude. Will be removed once the registry path is validated.
   */
  useRegistryProvider?: boolean;
  /** Discovered claude CLI path, persisted by ndx init to avoid re-discovery on every run. */
  claudePath?: string;
}

// ── Language-specific guard defaults ──────────────────────────────────

/** Guard defaults for JS/TS projects (the existing default). */
const JS_TS_GUARD_DEFAULTS: GuardConfig = {
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
};

/** Guard defaults for Go projects. */
const GO_GUARD_DEFAULTS: GuardConfig = {
  blockedPaths: [`${PROJECT_DIRS.HENCH}/**`, `${PROJECT_DIRS.REX}/**`, ".git/**", "vendor/**"],
  allowedCommands: ["go", "make", "git", "golangci-lint"],
  commandTimeout: 30000,
  maxFileSize: 1048576,
  spawnTimeout: 300000,          // 5 minutes
  maxConcurrentProcesses: 3,
  allowedGitSubcommands: [
    "status", "add", "commit", "diff", "log",
    "branch", "checkout", "stash", "show", "rev-parse",
  ],
};

/**
 * Returns the language-appropriate guard defaults.
 * Falls back to JS/TS defaults for unknown languages.
 */
export function guardDefaultsForLanguage(language?: ProjectLanguage): GuardConfig {
  if (language === "go") return { ...GO_GUARD_DEFAULTS };
  return { ...JS_TS_GUARD_DEFAULTS };
}

/**
 * Default hench configuration. When `language` is provided, guard defaults
 * are tuned for that language's toolchain. Omitting it preserves the
 * existing JS/TS defaults for backward compatibility.
 */
export function DEFAULT_HENCH_CONFIG(language?: ProjectLanguage): HenchConfig {
  return {
    schema: HENCH_SCHEMA_VERSION,
    provider: "cli",
    model: "sonnet",
    maxTurns: 50,
    maxTokens: 8192,
    tokenBudget: 0,
    rexDir: PROJECT_DIRS.REX,
    apiKeyEnv: "ANTHROPIC_API_KEY",
    guard: guardDefaultsForLanguage(language),
    retry: {
      maxRetries: 3,
      baseDelayMs: 2000,
      maxDelayMs: 30000,
    },
    loopPauseMs: 2000,
    maxFailedAttempts: 3,
    ...(language ? { language } : {}),
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
  /**
   * Diagnostic status of token usage data for this turn.
   * - `complete` — both input and output fields were present and numeric
   * - `partial` — only one of input/output was present; the other was backfilled to 0
   * - `unavailable` — neither field was present; values are synthetic zeros
   */
  diagnosticStatus?: "complete" | "partial" | "unavailable";
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

/**
 * Diagnostic metadata for a single prompt section.
 *
 * Captured at prompt construction time and stored on the run record
 * so post-hoc analysis can verify prompt composition without replaying
 * the full prompt text.
 */
export interface PromptSectionDiagnostic {
  /** Section name (e.g. "system", "brief", "workflow"). */
  name: string;
  /** Byte length of the section content (UTF-8). */
  byteLength: number;
}

/**
 * Run-level diagnostics captured during execution.
 *
 * Provides observability into how token usage was parsed and whether
 * the data is trustworthy. Stored on the run record so that post-hoc
 * analysis can distinguish "vendor returned zeros" from "vendor omitted
 * usage data and we backfilled zeros".
 */
export interface RunDiagnostics {
  /**
   * Overall token diagnostic status for the run.
   * Derived from per-turn diagnostic statuses:
   * - `complete` — all turns reported complete token data
   * - `partial` — at least one turn had partial data
   * - `unavailable` — at least one turn had no token data
   */
  tokenDiagnosticStatus: "complete" | "partial" | "unavailable";
  /** Output parse mode used by the vendor wrapper (e.g. "stream-json", "json", "api-sdk"). */
  parseMode: string;
  /** Vendor-specific diagnostic notes (e.g. "codex_usage_missing"). */
  notes: string[];
  /**
   * Prompt section diagnostics from the initial prompt envelope.
   *
   * Captures the name and byte size of each section assembled into
   * the prompt, enabling observability into prompt composition without
   * storing the full prompt text.
   */
  promptSections?: PromptSectionDiagnostic[];

  // ── Runtime identity fields (captured at run start) ───────────────

  /**
   * LLM vendor active for this run (e.g. "claude", "codex").
   *
   * v1 additive field — old records without this field load normally.
   */
  vendor?: string;
  /**
   * Sandbox mode in effect (e.g. "workspace-write", "read-only").
   *
   * v1 additive field — old records without this field load normally.
   */
  sandbox?: string;
  /**
   * Approval policy in effect (e.g. "never", "on-request").
   *
   * v1 additive field — old records without this field load normally.
   */
  approvals?: string;
}

/**
 * Serializable representation of a RuntimeEvent for persistence.
 *
 * Mirrors the `RuntimeEvent` contract from `@n-dx/llm-client` but uses
 * plain (non-readonly) fields so that the type is JSON-serializable and
 * Zod-validatable. Stored on `RunRecord.events` when verbose/debug mode
 * is enabled.
 */
export interface PersistedRuntimeEvent {
  /** Event type. */
  type: string;
  /** Which vendor produced this event. */
  vendor: string;
  /** Monotonically increasing turn number (1-based). */
  turn: number;
  /** ISO 8601 timestamp when the event was received. */
  timestamp: string;

  // ── Type-specific payloads (only one is set per event) ──

  /** Assistant message text (type: "assistant"). */
  text?: string;

  /** Tool invocation details (type: "tool_use"). */
  toolCall?: {
    tool: string;
    input: Record<string, unknown>;
  };

  /** Tool execution result (type: "tool_result"). */
  toolResult?: {
    tool: string;
    output: string;
    durationMs: number;
  };

  /** Token usage for this turn or cumulative (type: "token_usage"). */
  tokenUsage?: TokenUsage;

  /** Failure details (type: "failure"). */
  failure?: {
    category: string;
    message: string;
    vendorDetail?: string;
  };

  /** Completion summary text (type: "completion"). */
  completionSummary?: string;
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
  /** Run-level diagnostics for token parsing and vendor observability. */
  diagnostics?: RunDiagnostics;
  /**
   * Full RuntimeEvent stream captured during the run.
   *
   * Only populated when verbose/debug mode is enabled (to avoid bloating
   * run records during normal operation). Useful for post-hoc debugging
   * and event pipeline analysis.
   *
   * v1 additive field — no migration needed. Existing records without
   * this field load normally.
   */
  events?: PersistedRuntimeEvent[];
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
