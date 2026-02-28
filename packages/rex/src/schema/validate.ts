import { z, ZodError } from "zod";

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: ZodError };

const ItemStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "failing",
  "deferred",
  "blocked",
  "deleted",
]);

const ItemLevelSchema = z.enum(["epic", "feature", "task", "subtask"]);

const PrioritySchema = z.enum(["critical", "high", "medium", "low"]);
const ProposalNodeKindSchema = z.enum(["epic", "feature", "task"]);

const RequirementCategorySchema = z.enum([
  "technical",
  "performance",
  "security",
  "accessibility",
  "compatibility",
  "quality",
]);

const RequirementValidationTypeSchema = z.enum([
  "automated",
  "manual",
  "metric",
]);

export const RequirementSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    category: RequirementCategorySchema,
    validationType: RequirementValidationTypeSchema,
    acceptanceCriteria: z.array(z.string()),
    validationCommand: z.string().optional(),
    threshold: z.number().optional(),
    priority: PrioritySchema.optional(),
  })
  .strict();

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
      requirements: z.array(RequirementSchema).optional(),
      startedAt: z.string().optional(),
      completedAt: z.string().optional(),
      failureReason: z.string().optional(),
      mergedProposals: z.array(z.object({
        proposalNodeKey: z.string(),
        proposalTitle: z.string(),
        proposalKind: ProposalNodeKindSchema,
        reason: z.string(),
        score: z.number(),
        mergedAt: z.string(),
        source: z.literal("smart-add"),
      }).strict()).optional(),
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

const BudgetThresholdsSchema = z
  .object({
    tokens: z.number().int().nonnegative().optional(),
    cost: z.number().nonnegative().optional(),
    warnAt: z.number().min(0).max(100).optional(),
    abort: z.boolean().optional(),
  })
  .strict();

export const RexConfigSchema = z
  .object({
    schema: z.string(),
    project: z.string(),
    adapter: z.string(),
    validate: z.string().optional(),
    test: z.string().optional(),
    sourcevision: z.string().optional(),
    model: z.string().optional(),
    budget: BudgetThresholdsSchema.optional(),
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
