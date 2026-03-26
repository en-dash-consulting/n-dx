import { z, ZodError } from "zod";

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: ZodError };

const PolicyLimitsConfigSchema = z.object({
  maxCommandsPerMinute: z.number().int().nonnegative().optional(),
  maxWritesPerMinute: z.number().int().nonnegative().optional(),
  maxTotalBytesWritten: z.number().int().nonnegative().optional(),
  maxTotalCommands: z.number().int().nonnegative().optional(),
}).optional();

const MemoryThrottleConfigSchema = z.object({
  enabled: z.boolean().optional(),
  delayThreshold: z.number().min(0).max(100).optional(),
  rejectThreshold: z.number().min(0).max(100).optional(),
  baseDelayMs: z.number().positive().optional(),
  maxDelayMs: z.number().positive().optional(),
  maxRetries: z.number().int().nonnegative().optional(),
}).optional();

const MemoryMonitorConfigSchema = z.object({
  enabled: z.boolean().optional(),
  spawnThreshold: z.number().min(0).max(100).optional(),
}).optional();

const GuardConfigSchema = z.object({
  blockedPaths: z.array(z.string()),
  allowedCommands: z.array(z.string()),
  commandTimeout: z.number().positive(),
  maxFileSize: z.number().positive(),
  spawnTimeout: z.number().nonnegative().optional().default(300000),
  maxConcurrentProcesses: z.number().int().positive().optional().default(3),
  allowedGitSubcommands: z.array(z.string()).optional().default([
    "status", "add", "commit", "diff", "log",
    "branch", "checkout", "stash", "show", "rev-parse",
  ]),
  policy: PolicyLimitsConfigSchema,
  memoryThrottle: MemoryThrottleConfigSchema,
  memoryMonitor: MemoryMonitorConfigSchema,
});

const RetryConfigSchema = z.object({
  maxRetries: z.number().int().nonnegative(),
  baseDelayMs: z.number().positive(),
  maxDelayMs: z.number().positive(),
});

const ProjectLanguageSchema = z.enum(["typescript", "javascript", "go"]).optional();

export const HenchConfigSchema = z.object({
  schema: z.string(),
  provider: z.enum(["cli", "api"]).default("cli"),
  model: z.string(),
  maxTurns: z.number().positive(),
  maxTokens: z.number().positive(),
  tokenBudget: z.number().int().nonnegative().optional().default(0),
  rexDir: z.string(),
  apiKeyEnv: z.string(),
  guard: GuardConfigSchema,
  retry: RetryConfigSchema.optional().default({
    maxRetries: 3,
    baseDelayMs: 2000,
    maxDelayMs: 30000,
  }),
  loopPauseMs: z.number().int().nonnegative().optional().default(2000),
  maxFailedAttempts: z.number().int().positive().optional().default(3),
  language: ProjectLanguageSchema,
});

const RunStatusSchema = z.enum(["running", "completed", "failed", "timeout", "budget_exceeded", "error_transient"]);

const ToolCallRecordSchema = z.object({
  turn: z.number(),
  tool: z.string(),
  input: z.record(z.unknown()),
  output: z.string(),
  durationMs: z.number(),
});

const TokenUsageSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheCreationInput: z.number().optional(),
  cacheReadInput: z.number().optional(),
});

const TurnTokenUsageSchema = z.object({
  turn: z.number(),
  input: z.number(),
  output: z.number(),
  cacheCreationInput: z.number().optional(),
  cacheReadInput: z.number().optional(),
  vendor: z.string().optional(),
  model: z.string().optional(),
});

const CommandRecordSchema = z.object({
  command: z.string(),
  exitStatus: z.enum(["ok", "error", "timeout", "blocked"]),
  durationMs: z.number(),
});

const TestRecordSchema = z.object({
  command: z.string(),
  passed: z.boolean(),
  durationMs: z.number(),
});

const SummaryCountsSchema = z.object({
  filesRead: z.number(),
  filesChanged: z.number(),
  commandsExecuted: z.number(),
  testsRun: z.number(),
  toolCallsTotal: z.number(),
});

const PostRunTestRecordSchema = z.object({
  ran: z.boolean(),
  passed: z.boolean(),
  command: z.string().optional(),
  output: z.string().optional(),
  durationMs: z.number().optional(),
  targetedFiles: z.array(z.string()),
  error: z.string().optional(),
});

const RunSummaryDataSchema = z.object({
  filesChanged: z.array(z.string()),
  filesRead: z.array(z.string()),
  commandsExecuted: z.array(CommandRecordSchema),
  testsRun: z.array(TestRecordSchema),
  postRunTests: PostRunTestRecordSchema.optional(),
  counts: SummaryCountsSchema,
});

const RunMemoryStatsSchema = z.object({
  peakRssBytes: z.number(),
  systemAvailableAtStartBytes: z.number(),
  systemAvailableAtEndBytes: z.number(),
  systemTotalBytes: z.number(),
});

export const RunRecordSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  taskTitle: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  lastActivityAt: z.string().optional(),
  status: RunStatusSchema,
  turns: z.number(),
  summary: z.string().optional(),
  error: z.string().optional(),
  tokenUsage: TokenUsageSchema,
  turnTokenUsage: z.array(TurnTokenUsageSchema).optional(),
  toolCalls: z.array(ToolCallRecordSchema),
  model: z.string(),
  retryAttempts: z.number().int().nonnegative().optional(),
  structuredSummary: RunSummaryDataSchema.optional(),
  memoryStats: RunMemoryStatsSchema.optional(),
});

export function validateConfig(
  data: unknown,
): ValidationResult<z.infer<typeof HenchConfigSchema>> {
  const result = HenchConfigSchema.safeParse(data);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, errors: result.error };
}

export function validateRunRecord(
  data: unknown,
): ValidationResult<z.infer<typeof RunRecordSchema>> {
  const result = RunRecordSchema.safeParse(data);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, errors: result.error };
}

/**
 * Format Zod validation errors into clear, actionable messages.
 *
 * Each error includes the field path and what was expected, making it
 * easy to pinpoint and fix the issue.
 */
export function formatValidationErrors(errors: ZodError): string[] {
  return errors.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
}
