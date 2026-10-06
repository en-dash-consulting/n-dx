import { z, ZodError } from "zod";
import {
  SCHEMA_VERSION,
  isCompatibleSchema,
  VALID_STATUSES,
  VALID_LEVELS,
  VALID_PRIORITIES,
  VALID_REQUIREMENT_CATEGORIES,
  VALID_VALIDATION_TYPES,
  RUN_SETTING_MODEL_MAX_BYTES,
  RUN_SETTING_CONTEXT_NOTES_MAX_BYTES,
  RUN_SETTING_MAX_TURNS_MIN,
  RUN_SETTING_MAX_TURNS_MAX,
  RUN_SETTING_TIERS,
  RUN_SETTING_KEYS,
} from "./v1.js";
import { LLM_VENDORS } from "@n-dx/llm-client";
import type { RunSettings } from "./v1.js";

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: ZodError };

/** Helper: convert a Set<string> to a z.enum()-compatible tuple. */
function setToEnumValues<T extends string>(s: Set<T>): [T, ...T[]] {
  const arr = [...s];
  return arr as [T, ...T[]];
}

const ItemStatusSchema = z.enum(setToEnumValues(VALID_STATUSES));

const ItemLevelSchema = z.enum(setToEnumValues(VALID_LEVELS));

const PrioritySchema = z.enum(setToEnumValues(VALID_PRIORITIES));
const ProposalNodeKindSchema = z.enum(["epic", "feature", "task"]);

const RequirementCategorySchema = z.enum(setToEnumValues(VALID_REQUIREMENT_CATEGORIES));

const RequirementValidationTypeSchema = z.enum(setToEnumValues(VALID_VALIDATION_TYPES));

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

export const CommitAttributionSchema = z
  .object({
    hash: z.string(),
    author: z.string(),
    authorEmail: z.string(),
    timestamp: z.string(),
    message: z.string().optional(),
  })
  .strict();

export const WorkItemLinkSchema = z
  .object({
    system: z.string(),
    workItemId: z.string(),
    url: z.string().optional(),
    title: z.string().optional(),
    remoteStatus: z.string().optional(),
    syncState: z.enum(["pending", "synced", "error"]).optional(),
    lastSyncedAt: z.string().optional(),
    error: z.string().optional(),
  })
  .strict();

function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

function boundedString(maxBytes: number) {
  return z.string().refine((s) => utf8Bytes(s) <= maxBytes, {
    message: `must be at most ${maxBytes} bytes`,
  });
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const RunTierSchema =z.enum(RUN_SETTING_TIERS);

/**
 * Exact model ids keyed by vendor: known vendor names only (an unknown one is
 * rejected with the valid list), each id non-empty and bounded. An empty
 * object is stripped by {@link validateRunSettings}.
 */
const RunModelsSchema = z
  .record(z.string(), boundedString(RUN_SETTING_MODEL_MAX_BYTES).refine((s) => s.length > 0, { message: "must not be empty" }))
  .superRefine((models, ctx) => {
    for (const vendor of Object.keys(models)) {
      if (!(LLM_VENDORS as readonly string[]).includes(vendor)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [vendor],
          message: `unknown vendor "${vendor}"; valid vendors: ${LLM_VENDORS.join(", ")}`,
        });
      }
    }
  });

/**
 * A saved `run` block: known keys only, each with the dashboard's bounds.
 *
 * Writers validate, the document stays lenient: {@link validateRunSettings}
 * gates every writer that accepts `run` from a caller (MCP, `rex update`, web).
 * The document schema ({@link PRDItemSchema}) accepts any plain object, so one
 * hand-edited or newer-version block never blocks writes to other items; the
 * store round-trips it unchanged and `ndx work` ignores an invalid block.
 */
export const RunSettingsSchema = z
  .object({
    tier: RunTierSchema.optional(),
    models: RunModelsSchema.optional(),
    provider: z.enum(["cli", "api"]).optional(),
    permissionMode: z.enum(["default", "acceptEdits", "bypassPermissions"]).optional(),
    review: z.boolean().optional(),
    reviewTier: RunTierSchema.optional(),
    reviewModels: RunModelsSchema.optional(),
    reviewOptional: z.boolean().optional(),
    skipTestGate: z.boolean().optional(),
    maxTurns: z.number().int().min(RUN_SETTING_MAX_TURNS_MIN).max(RUN_SETTING_MAX_TURNS_MAX).optional(),
    tokenBudget: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    contextNotes: boundedString(RUN_SETTING_CONTEXT_NOTES_MAX_BYTES).optional(),
  })
  .strict();

export type RunSettingsCheck =
  | { ok: true; value: RunSettings | undefined }
  | { ok: false; error: string };

/**
 * The one validator every `run` writer (MCP, CLI, web, hench) shares.
 *
 * `value` is `undefined` for "no block": `{}`, `undefined` and `null` all mean
 * the item carries no saved settings. Keys whose value is `undefined` are
 * dropped, and an empty `models`/`reviewModels` object counts as absent.
 * `error` names the first offending key; an unknown key lists the valid ones.
 */
export function validateRunSettings(input: unknown): RunSettingsCheck {
  if (input === undefined || input === null) return { ok: true, value: undefined };
  const result = RunSettingsSchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = ["run", ...issue.path].join(".");
    if (issue.code === "unrecognized_keys") {
      return {
        ok: false,
        error: `${path}: unknown key ${issue.keys.map((k) => `"${k}"`).join(", ")}; valid keys: ${RUN_SETTING_KEYS.join(", ")}`,
      };
    }
    return { ok: false, error: `${path}: ${issue.message}` };
  }
  const value = Object.fromEntries(
    Object.entries(result.data).filter(
      ([, v]) => v !== undefined && !(isPlainObject(v) && Object.keys(v).length === 0),
    ),
  ) as RunSettings;
  return { ok: true, value: Object.keys(value).length === 0 ? undefined : value };
}

export const PRDItemSchema: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z
    .object({
      id: z.string(),
      title: z.string(),
      status: ItemStatusSchema,
      level: ItemLevelSchema,
      branch: z.string().optional(),
      sourceFile: z.string().optional(),
      description: z.string().optional(),
      acceptanceCriteria: z.array(z.string()).optional(),
      priority: PrioritySchema.optional(),
      tags: z.array(z.string()).optional(),
      source: z.string().optional(),
      blockedBy: z.array(z.string()).optional(),
      requirements: z.array(RequirementSchema).optional(),
      commits: z.array(CommitAttributionSchema).optional(),
      links: z.array(WorkItemLinkSchema).optional(),
      startedAt: z.string().optional(),
      completedAt: z.string().optional(),
      endedAt: z.string().optional(),
      activeIntervals: z
        .array(
          z
            .object({
              start: z.string(),
              end: z.string().optional(),
            })
            .strict(),
        )
        .optional(),
      failureReason: z.string().optional(),
      resolutionType: z.enum(["code-change", "config-override", "acknowledgment", "deferred", "unclassified"]).optional(),
      resolutionDetail: z.string().optional(),
      mergedProposals: z.array(z.object({
        proposalNodeKey: z.string(),
        proposalTitle: z.string(),
        proposalKind: ProposalNodeKindSchema,
        reason: z.string(),
        score: z.number(),
        mergedAt: z.string(),
        source: z.literal("smart-add"),
      }).strict()).optional(),
      run: z.record(z.string(), z.unknown()).optional(),
      children: z.array(PRDItemSchema).optional(),
    })
    .passthrough(),
);

export const PRDDocumentSchema = z
  .object({
    schema: z.string().refine(isCompatibleSchema, {
      message: `Incompatible PRD schema version, expected "${SCHEMA_VERSION}"`,
    }),
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

const LoEConfigSchema = z
  .object({
    taskThresholdWeeks: z.number().positive("taskThresholdWeeks must be a positive number").optional(),
    maxDecompositionDepth: z.number().int().positive("maxDecompositionDepth must be a positive integer").optional(),
    proposalCeiling: z.number().int().positive("proposalCeiling must be a positive integer").optional(),
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
    loe: LoEConfigSchema.optional(),
    structureHealth: z.object({
      maxTopLevelEpics: z.number().int().positive().optional(),
      maxTreeDepth: z.number().int().positive().optional(),
      maxChildrenPerContainer: z.number().int().positive().optional(),
      minChildrenPerContainer: z.number().int().positive().optional(),
    }).optional(),
    titleCollisionSimilarityThreshold: z.number().min(0).max(1).optional(),
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
