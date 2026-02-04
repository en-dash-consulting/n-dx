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

export type RunStatus = "running" | "completed" | "failed" | "timeout" | "error_transient";

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
  toolCalls: ToolCallRecord[];
  model: string;
  retryAttempts?: number;
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
