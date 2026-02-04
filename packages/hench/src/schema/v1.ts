export const HENCH_SCHEMA_VERSION = "hench/v1";

export interface GuardConfig {
  blockedPaths: string[];
  allowedCommands: string[];
  commandTimeout: number;
  maxFileSize: number;
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
    rexDir: ".rex",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    guard: {
      blockedPaths: [".hench/**", ".rex/**", ".git/**", "node_modules/**"],
      allowedCommands: ["npm", "npx", "node", "git", "tsc", "vitest"],
      commandTimeout: 30000,
      maxFileSize: 1048576,
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

export interface RunRecord {
  id: string;
  taskId: string;
  taskTitle: string;
  startedAt: string;
  finishedAt?: string;
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

export interface TaskBrief {
  task: TaskBriefTask;
  parentChain: TaskBriefParent[];
  siblings: TaskBriefSibling[];
  project: TaskBriefProject;
  workflow: string;
  recentLog: TaskBriefLogEntry[];
}
