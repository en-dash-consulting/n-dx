/**
 * LLM-powered reasoning for PRD reshape proposals.
 *
 * Builds prompts from the current PRD state + optional sourcevision context,
 * parses structured JSON responses via Zod, and returns typed ReshapeProposal
 * arrays.
 *
 * Mirrors the patterns in reason.ts: spawnClaude, extractJson,
 * repairTruncatedJson, Zod validation.
 *
 * @module analyze/reshape-reason
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PRDItem, AnalyzeTokenUsage } from "../schema/index.js";
import type { ReshapeProposal, ReshapeAction } from "../core/reshape.js";
import { walkTree } from "../core/tree.js";
import {
  spawnClaude,
  extractJson,
  repairTruncatedJson,
  readProjectContext,
  emptyAnalyzeTokenUsage,
  accumulateTokenUsage,
} from "./reason.js";

// ── Zod schemas for LLM response validation ──

const MergeActionSchema = z.object({
  action: z.literal("merge"),
  survivorId: z.string(),
  mergedIds: z.array(z.string()),
  title: z.string().optional(),
  description: z.string().optional(),
  reason: z.string(),
});

const UpdateActionSchema = z.object({
  action: z.literal("update"),
  itemId: z.string(),
  updates: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    acceptanceCriteria: z.array(z.string()).optional(),
    priority: z.enum(["critical", "high", "medium", "low"]).optional(),
  }),
  reason: z.string(),
});

const ReparentActionSchema = z.object({
  action: z.literal("reparent"),
  itemId: z.string(),
  newParentId: z.string().optional(),
  reason: z.string(),
});

const ObsoleteActionSchema = z.object({
  action: z.literal("obsolete"),
  itemId: z.string(),
  reason: z.string(),
});

const SplitChildSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  priority: z.enum(["critical", "high", "medium", "low"]).optional(),
  level: z.enum(["epic", "feature", "task", "subtask"]),
});

const SplitActionSchema = z.object({
  action: z.literal("split"),
  sourceId: z.string(),
  children: z.array(SplitChildSchema),
  reason: z.string(),
});

const ReshapeActionSchema = z.discriminatedUnion("action", [
  MergeActionSchema,
  UpdateActionSchema,
  ReparentActionSchema,
  ObsoleteActionSchema,
  SplitActionSchema,
]);

const ReshapeResponseSchema = z.array(ReshapeActionSchema);

// ── PRD summarization for prompts ──

function summarizePRD(items: PRDItem[]): string {
  const lines: string[] = [];
  for (const { item, parents } of walkTree(items)) {
    const indent = "  ".repeat(parents.length);
    const parts = [`${indent}- [${item.level}] "${item.title}" (id: ${item.id}, status: ${item.status})`];
    if (item.description) parts.push(`${indent}  description: ${item.description}`);
    if (item.acceptanceCriteria?.length) {
      parts.push(`${indent}  criteria: ${item.acceptanceCriteria.join("; ")}`);
    }
    if (item.priority) parts.push(`${indent}  priority: ${item.priority}`);
    lines.push(parts.join("\n"));
  }
  return lines.length > 0 ? lines.join("\n") : "(empty PRD)";
}

// ── Prompt building ──

const RESHAPE_SYSTEM_PROMPT = `You are a PRD architect reviewing an existing Product Requirements Document (PRD) for structural quality. Your job is to identify opportunities to improve the PRD through specific restructuring actions.

Analyze the PRD and propose actions from these types:

1. **merge** — Combine overlapping/duplicate items into one. Specify which item survives and which are absorbed.
2. **update** — Revise title, description, or acceptance criteria of items that are stale, vague, or could be clearer.
3. **reparent** — Move items to a better-fitting parent in the hierarchy (e.g., a task under the wrong feature).
4. **obsolete** — Mark items that are no longer relevant (they'll be set to "deferred" status).
5. **split** — Break overly broad items into focused children.

Guidelines:
- Reference items by their exact IDs from the PRD.
- Only propose changes that materially improve the PRD structure or clarity.
- Do NOT propose changes to items that are already completed.
- Provide a clear "reason" for every action explaining why it improves the PRD.
- For merges: pick the most descriptive/complete item as the survivor.
- For splits: ensure child items are at the appropriate hierarchy level.
- For updates: only propose when there's a meaningful improvement (not cosmetic rewording).

Respond with ONLY a valid JSON array of action objects. No explanation, no markdown fences, no commentary — just the JSON.`;

export const RESHAPE_FEW_SHOT = `Example output (for reference — do NOT include this in your response):
[
  {
    "action": "merge",
    "survivorId": "abc-123",
    "mergedIds": ["def-456"],
    "title": "Implement user authentication with OAuth2",
    "reason": "Both items describe OAuth2 authentication setup with overlapping acceptance criteria"
  },
  {
    "action": "update",
    "itemId": "ghi-789",
    "updates": {
      "description": "Handle rate limiting for external API calls with exponential backoff",
      "acceptanceCriteria": ["Returns 429 with retry-after header", "Implements exponential backoff up to 60s"]
    },
    "reason": "Original description was too vague — added specific retry strategy and verifiable criteria"
  },
  {
    "action": "split",
    "sourceId": "mno-345",
    "children": [
      {
        "title": "Validate form inputs on submit",
        "level": "task",
        "acceptanceCriteria": ["Required fields rejected with clear error", "Email format validated against RFC 5322"]
      },
      {
        "title": "Show inline error messages on validation failure",
        "level": "task"
      }
    ],
    "reason": "Original task bundled validation logic and error UX — splitting clarifies scope and ownership"
  },
  {
    "action": "reparent",
    "itemId": "pqr-678",
    "newParentId": "stu-901",
    "reason": "Belongs under the auth epic, not the dashboard epic"
  },
  {
    "action": "obsolete",
    "itemId": "jkl-012",
    "reason": "This migration task was for the old database schema which has been replaced by the v2 schema"
  }
]`;

const SMART_PRUNE_PROMPT = `You are reviewing this PRD to identify items that should be pruned — either because they are obsolete, redundant, or no longer relevant to the project's current direction.

Focus on finding:
1. **obsolete** items — tasks/features overtaken by events, deprecated approaches, or completed through other means
2. **merge** candidates — overlapping items that describe the same work in different words

Do NOT suggest:
- Removing items that are actively in_progress
- Removing items that are genuinely needed but not yet started
- Updating or reparenting items (this is a prune operation, not a full reshape)

Only propose "obsolete" and "merge" actions.`;

const POST_PRUNE_CONSOLIDATION_PROMPT = `You are a PRD architect reviewing a Product Requirements Document (PRD) that was just pruned — completed items have been archived and removed. Your job is to analyze the REMAINING (non-completed) items and propose restructuring to create clean, logical groupings.

Focus on these consolidation opportunities:

1. **reparent** — Move orphaned or misplaced items under a more logical parent epic/feature. After pruning, some items may be stranded under parents that no longer make sense.
2. **merge** — Combine similar items that are scattered across different parts of the tree. Look for items that describe overlapping work in different words.
3. **split** — Break overly broad items into focused children at the appropriate hierarchy level. Items that try to cover too much scope should become multiple specific items.
4. **update** — Revise stale titles/descriptions that no longer accurately reflect the work. After pruning, context may have shifted.
5. **obsolete** — Mark items that are no longer relevant given what was just completed (they may have been implicitly addressed by the pruned work).

Guidelines:
- Reference items by their exact IDs from the PRD.
- Prioritize creating clean logical groupings over cosmetic changes.
- Only propose changes that materially improve the PRD structure — skip trivial rewording.
- Do NOT propose changes to items that are already completed or in_progress.
- Ensure reparenting maintains proper hierarchy (epics > features > tasks > subtasks).
- For merges: pick the most descriptive/complete item as the survivor.
- For splits: ensure child items are at the appropriate hierarchy level below the source.
- Provide a clear "reason" for every action explaining how it improves post-prune organization.

Respond with ONLY a valid JSON array of action objects. No explanation, no markdown fences, no commentary — just the JSON. Return an empty array [] if no consolidation is needed.`;

export interface ReshapeReasonOptions {
  dir?: string;
  model?: string;
  /** When true, use prune-focused prompt instead of full reshape. */
  pruneMode?: boolean;
  /** When true, use post-prune consolidation prompt for regrouping remaining items. */
  consolidateMode?: boolean;
}

export interface ReshapeReasonResult {
  proposals: ReshapeProposal[];
  tokenUsage: AnalyzeTokenUsage;
}

/**
 * Use LLM to analyze the PRD and propose reshape actions.
 */
export async function reasonForReshape(
  items: PRDItem[],
  options: ReshapeReasonOptions = {},
): Promise<ReshapeReasonResult> {
  const tokenUsage = emptyAnalyzeTokenUsage();

  const prdSummary = summarizePRD(items);

  // Load project context for domain understanding
  let projectContext = "";
  if (options.dir) {
    projectContext = await readProjectContext(options.dir);
  }

  const systemPrompt = options.consolidateMode
    ? POST_PRUNE_CONSOLIDATION_PROMPT
    : options.pruneMode
      ? SMART_PRUNE_PROMPT
      : RESHAPE_SYSTEM_PROMPT;

  const prompt = [
    systemPrompt,
    "",
    "## Current PRD",
    prdSummary,
    "",
    projectContext ? `## Project Context\n${projectContext}\n` : "",
    RESHAPE_FEW_SHOT,
  ].filter(Boolean).join("\n");

  const result = await spawnClaude(prompt, options.model);
  accumulateTokenUsage(tokenUsage, result.tokenUsage);

  const proposals = parseReshapeResponse(result.text);

  return { proposals, tokenUsage };
}

/**
 * Normalize common LLM typos/variations in the action discriminator field.
 * Returns the canonical action type or the original string if unrecognized.
 */
const ACTION_ALIASES: Record<string, string> = {
  merge: "merge", update: "update", reparent: "reparent", obsolete: "obsolete", split: "split",
  // Common LLM variations
  merge_items: "merge", merge_into: "merge",
  move: "reparent", relocate: "reparent",
  delete: "obsolete", remove: "obsolete", deprecate: "obsolete",
  edit: "update", modify: "update", rename: "update",
};

function normalizeAction(item: unknown): unknown {
  if (item && typeof item === "object" && "action" in item) {
    const action = (item as Record<string, unknown>).action;
    if (typeof action === "string") {
      const normalized = ACTION_ALIASES[action.toLowerCase().trim()];
      if (normalized && normalized !== action) {
        return { ...item as Record<string, unknown>, action: normalized };
      }
    }
  }
  return item;
}

/**
 * Parse an LLM response into validated ReshapeProposals.
 */
export function parseReshapeResponse(raw: string): ReshapeProposal[] {
  const text = extractJson(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const repaired = repairTruncatedJson(text);
    if (repaired) {
      parsed = JSON.parse(repaired);
    } else {
      throw new Error(`Invalid JSON in reshape LLM response: ${text.slice(0, 200)}`);
    }
  }

  // Handle empty array
  if (Array.isArray(parsed) && parsed.length === 0) {
    return [];
  }

  // Normalize action types before validation
  if (Array.isArray(parsed)) {
    parsed = parsed.map(normalizeAction);
  } else if (parsed && typeof parsed === "object") {
    parsed = normalizeAction(parsed);
  }

  // Try strict validation first
  const strict = ReshapeResponseSchema.safeParse(parsed);
  if (strict.success) {
    return strict.data.map(wrapAction);
  }

  // Single-object fallback: LLM returned one action instead of an array
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const single = ReshapeActionSchema.safeParse(parsed);
    if (single.success) {
      return [wrapAction(single.data)];
    }
  }

  // Lenient fallback: validate items individually, skip invalid ones
  if (Array.isArray(parsed) && parsed.length > 0) {
    const valid: ReshapeAction[] = [];
    for (const item of parsed) {
      const result = ReshapeActionSchema.safeParse(item);
      if (result.success) {
        valid.push(result.data);
      }
    }
    if (valid.length > 0) {
      return valid.map(wrapAction);
    }
  }

  throw new Error(
    `Reshape LLM response failed validation: ${strict.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
      .join("; ")}`,
  );
}

function wrapAction(action: ReshapeAction): ReshapeProposal {
  return {
    id: randomUUID(),
    action: action as ReshapeProposal["action"],
  };
}

// ── Display helpers ──

/**
 * Format a reshape proposal for human-readable display.
 */
export function formatReshapeProposal(proposal: ReshapeProposal, items: PRDItem[]): string {
  const { action } = proposal;
  const lines: string[] = [];

  const resolve = (id: string): string => {
    for (const { item } of walkTree(items)) {
      if (item.id === id) return `"${item.title}" (${id.slice(0, 8)})`;
    }
    return id.slice(0, 8);
  };

  switch (action.action) {
    case "merge": {
      const survivor = resolve(action.survivorId);
      const merged = action.mergedIds.map(resolve).join(", ");
      lines.push(`  MERGE: ${merged} → into ${survivor}`);
      if (action.title) lines.push(`    New title: ${action.title}`);
      break;
    }
    case "update": {
      const item = resolve(action.itemId);
      lines.push(`  UPDATE: ${item}`);
      if (action.updates.title) lines.push(`    Title → ${action.updates.title}`);
      if (action.updates.description) lines.push(`    Description → ${action.updates.description.slice(0, 80)}...`);
      if (action.updates.acceptanceCriteria) lines.push(`    Criteria → ${action.updates.acceptanceCriteria.length} items`);
      if (action.updates.priority) lines.push(`    Priority → ${action.updates.priority}`);
      break;
    }
    case "reparent": {
      const item = resolve(action.itemId);
      const parent = action.newParentId ? resolve(action.newParentId) : "root";
      lines.push(`  REPARENT: ${item} → under ${parent}`);
      break;
    }
    case "obsolete": {
      const item = resolve(action.itemId);
      lines.push(`  OBSOLETE: ${item}`);
      break;
    }
    case "split": {
      const source = resolve(action.sourceId);
      lines.push(`  SPLIT: ${source} → ${action.children.length} children`);
      for (const child of action.children) {
        lines.push(`    + [${child.level}] ${child.title}`);
      }
      break;
    }
  }

  lines.push(`    Reason: ${action.reason}`);
  return lines.join("\n");
}
