import { z, ZodError } from "zod";

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: ZodError };

const ItemStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "deferred",
  "blocked",
]);

const ItemLevelSchema = z.enum(["epic", "feature", "task", "subtask"]);

const PrioritySchema = z.enum(["critical", "high", "medium", "low"]);

export const PRDItemSchema: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z
    .object({
      id: z.string(),
      title: z.string(),
      status: ItemStatusSchema,
      level: ItemLevelSchema,
      description: z.string().optional(),
      acceptanceCriteria: z.array(z.string()).optional(),
      priority: PrioritySchema.optional(),
      tags: z.array(z.string()).optional(),
      source: z.string().optional(),
      blockedBy: z.array(z.string()).optional(),
      children: z.array(PRDItemSchema).optional(),
    })
    .passthrough(),
);

export const PRDDocumentSchema = z
  .object({
    schema: z.string(),
    title: z.string(),
    items: z.array(PRDItemSchema),
  })
  .passthrough();

export const RexConfigSchema = z
  .object({
    schema: z.string(),
    project: z.string(),
    adapter: z.string(),
    validate: z.string().optional(),
    test: z.string().optional(),
    sourcevision: z.string().optional(),
    future: z.record(z.unknown()).optional(),
  })
  .passthrough();

export const LogEntrySchema = z
  .object({
    timestamp: z.string(),
    event: z.string(),
    itemId: z.string().optional(),
    detail: z.string().optional(),
  })
  .passthrough();

export function validateDocument(
  data: unknown,
): ValidationResult<z.infer<typeof PRDDocumentSchema>> {
  const result = PRDDocumentSchema.safeParse(data);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, errors: result.error };
}

export function validateConfig(
  data: unknown,
): ValidationResult<z.infer<typeof RexConfigSchema>> {
  const result = RexConfigSchema.safeParse(data);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, errors: result.error };
}

export function validateLogEntry(
  data: unknown,
): ValidationResult<z.infer<typeof LogEntrySchema>> {
  const result = LogEntrySchema.safeParse(data);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, errors: result.error };
}
