import { z, ZodError } from "zod";

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: ZodError };

const GuardConfigSchema = z.object({
  blockedPaths: z.array(z.string()),
  allowedCommands: z.array(z.string()),
  commandTimeout: z.number().positive(),
  maxFileSize: z.number().positive(),
});

const RetryConfigSchema = z.object({
  maxRetries: z.number().int().nonnegative(),
  baseDelayMs: z.number().positive(),
  maxDelayMs: z.number().positive(),
});

export const HenchConfigSchema = z.object({
  schema: z.string(),
  provider: z.enum(["cli", "api"]).default("cli"),
  model: z.string(),
  maxTurns: z.number().positive(),
  maxTokens: z.number().positive(),
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
});

const RunStatusSchema = z.enum(["running", "completed", "failed", "timeout", "error_transient"]);

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
});

export const RunRecordSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  taskTitle: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  status: RunStatusSchema,
  turns: z.number(),
  summary: z.string().optional(),
  error: z.string().optional(),
  tokenUsage: TokenUsageSchema,
  toolCalls: z.array(ToolCallRecordSchema),
  model: z.string(),
  retryAttempts: z.number().int().nonnegative().optional(),
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
