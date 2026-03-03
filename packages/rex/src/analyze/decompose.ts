/**
 * LoE-threshold-driven proposal decomposition.
 *
 * After the initial proposal step, this module identifies items whose LoE
 * exceeds the configured threshold and runs a secondary LLM call per item
 * to produce child proposals. Recursion is capped at a configurable depth
 * limit to prevent runaway decomposition.
 *
 * @module rex/analyze/decompose
 */

import type { LoEConfig, AnalyzeTokenUsage } from "../schema/index.js";
import { LOE_DEFAULTS } from "../schema/index.js";
import type { Proposal, ProposalTask, ProposalFeature } from "./propose.js";
import type { ReasonResult, ClaudeResult } from "./reason.js";
import {
  spawnClaude,
  DEFAULT_MODEL,
  extractJson,
  repairTruncatedJson,
  emptyAnalyzeTokenUsage,
  accumulateTokenUsage,
  PRD_SCHEMA,
  TASK_QUALITY_RULES,
  OUTPUT_INSTRUCTION,
} from "./reason.js";
import { z } from "zod";

// ── Types ──

/** A task that exceeded the threshold and its decomposed children. */
export interface DecomposedTask {
  /** The original task that was decomposed. */
  original: ProposalTask;
  /** Child tasks produced by the decomposition LLM call. */
  children: ProposalTask[];
  /** Recursion depth at which this decomposition occurred (0-indexed). */
  depth: number;
}

/** Result of the decomposition pass over a full proposal set. */
export interface DecompositionResult {
  /** Proposals with oversized tasks replaced by their children. */
  proposals: Proposal[];
  /** Tasks that were decomposed (for logging/display). */
  decomposed: DecomposedTask[];
  /** Aggregated token usage from all decomposition LLM calls. */
  tokenUsage: AnalyzeTokenUsage;
}

// ── Zod schema for decomposition response ──

const DecompositionChildSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  priority: z.enum(["critical", "high", "medium", "low"]).optional(),
  tags: z.array(z.string()).optional(),
  loe: z.number().positive().optional(),
  loeRationale: z.string().optional(),
  loeConfidence: z.enum(["low", "medium", "high"]).optional(),
});

const DecompositionResponseSchema = z.array(DecompositionChildSchema);

// ── Prompt builder ──

/**
 * Build an LLM prompt to decompose a single oversized task into smaller
 * children whose individual LoE falls at or below the threshold.
 *
 * Pure function — no I/O.
 */
export function buildDecompositionPrompt(
  task: ProposalTask,
  thresholdWeeks: number,
): string {
  const taskJson = JSON.stringify(task, null, 2);

  return `You are a product requirements analyst. The following task has a level-of-effort (LoE) estimate that exceeds the project's threshold of ${thresholdWeeks} engineer-week${thresholdWeeks === 1 ? "" : "s"}. Break it down into smaller, independently deliverable child tasks.

Task to decompose:
${taskJson}

Rules:
- Each child task MUST have an LoE at or below ${thresholdWeeks} engineer-week${thresholdWeeks === 1 ? "" : "s"}.
- Each child task MUST include "loe" (number, in engineer-weeks), "loeRationale" (string explaining the estimate), and "loeConfidence" ("low"|"medium"|"high").
- The sum of child LoE values should approximate the parent's LoE (${task.loe ?? "unknown"} weeks).
- Each child MUST have a verb-first title, a description, and acceptanceCriteria.
- Distribute the parent's acceptance criteria among children — do not lose any.
- Keep priorities consistent with the parent (${task.priority ?? "medium"}).
- Preserve tags from the parent where relevant.
- Do NOT add entirely new functionality — only decompose what exists.
- Produce 2-5 child tasks.

${TASK_QUALITY_RULES}

Respond with ONLY a valid JSON array of task objects. No explanation, no markdown fences — just the JSON.`;
}

// ── Response parsing ──

/**
 * Parse the LLM's decomposition response into child ProposalTasks.
 * Validates against schema, adds default source/sourceFile from the parent.
 */
export function parseDecompositionResponse(
  raw: string,
  parent: ProposalTask,
): ProposalTask[] {
  const text = extractJson(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const repaired = repairTruncatedJson(text);
    if (repaired) {
      parsed = JSON.parse(repaired);
    } else {
      throw new Error(
        `Invalid JSON in decomposition response: ${text.slice(0, 200)}`,
      );
    }
  }

  const result = DecompositionResponseSchema.safeParse(parsed);
  if (!result.success) {
    // Lenient fallback: parse valid items individually
    if (Array.isArray(parsed) && parsed.length > 0) {
      const valid: z.infer<typeof DecompositionChildSchema>[] = [];
      for (const item of parsed) {
        const single = DecompositionChildSchema.safeParse(item);
        if (single.success) valid.push(single.data);
      }
      if (valid.length > 0) {
        return valid.map((child) => ({
          ...child,
          source: parent.source,
          sourceFile: parent.sourceFile,
        }));
      }
    }
    throw new Error(
      `Decomposition response failed schema validation: ${result.error.issues.map((i) => i.message).join("; ")}`,
    );
  }

  return result.data.map((child) => ({
    ...child,
    source: parent.source,
    sourceFile: parent.sourceFile,
  }));
}

// ── Single-task decomposition ──

/**
 * Decompose a single task into smaller children via an LLM call.
 * Returns the child tasks along with token usage.
 */
export async function decomposeTask(
  task: ProposalTask,
  thresholdWeeks: number,
  model?: string,
): Promise<{ children: ProposalTask[]; tokenUsage: AnalyzeTokenUsage }> {
  const prompt = buildDecompositionPrompt(task, thresholdWeeks);
  const tokenUsage = emptyAnalyzeTokenUsage();

  const result: ClaudeResult = await spawnClaude(
    prompt,
    model ?? DEFAULT_MODEL,
  );
  accumulateTokenUsage(tokenUsage, result.tokenUsage);

  const children = parseDecompositionResponse(result.text, task);
  return { children, tokenUsage };
}

// ── Recursive decomposition of a task list ──

/**
 * Recursively decompose tasks that exceed the threshold, up to the depth limit.
 * Returns tasks with decomposition annotations (oversized tasks carry their
 * children in `task.decomposition`) and tracking info about what was decomposed.
 */
async function decomposeTasks(
  tasks: ProposalTask[],
  thresholdWeeks: number,
  maxDepth: number,
  currentDepth: number,
  model: string,
  tokenUsage: AnalyzeTokenUsage,
  decomposed: DecomposedTask[],
): Promise<ProposalTask[]> {
  const result: ProposalTask[] = [];

  for (const task of tasks) {
    const taskLoe = task.loe ?? 0;

    // Skip tasks at or below threshold, or without LoE
    if (taskLoe <= thresholdWeeks || taskLoe === 0) {
      result.push(task);
      continue;
    }

    // At depth limit — keep the task as-is
    if (currentDepth >= maxDepth) {
      result.push(task);
      continue;
    }

    // Decompose this task
    const { children, tokenUsage: callUsage } = await decomposeTask(
      task,
      thresholdWeeks,
      model,
    );
    tokenUsage.calls += callUsage.calls;
    tokenUsage.inputTokens += callUsage.inputTokens;
    tokenUsage.outputTokens += callUsage.outputTokens;
    if (callUsage.cacheCreationInputTokens) {
      tokenUsage.cacheCreationInputTokens =
        (tokenUsage.cacheCreationInputTokens ?? 0) +
        callUsage.cacheCreationInputTokens;
    }
    if (callUsage.cacheReadInputTokens) {
      tokenUsage.cacheReadInputTokens =
        (tokenUsage.cacheReadInputTokens ?? 0) +
        callUsage.cacheReadInputTokens;
    }

    decomposed.push({
      original: task,
      children,
      depth: currentDepth,
    });

    // Recursively check children that still exceed the threshold
    const resolvedChildren = await decomposeTasks(
      children,
      thresholdWeeks,
      maxDepth,
      currentDepth + 1,
      model,
      tokenUsage,
      decomposed,
    );

    // Annotate the task with its decomposition instead of replacing it
    result.push({
      ...task,
      decomposition: {
        children: resolvedChildren,
        thresholdWeeks,
      },
    });
  }

  return result;
}

// ── Full proposal set decomposition ──

/**
 * Apply the LoE decomposition pass to a set of proposals.
 *
 * For each proposal, iterates over features and their tasks. Tasks whose
 * `loe` exceeds `config.taskThresholdWeeks` are decomposed via LLM calls.
 * Children that still exceed the threshold are recursively decomposed up
 * to `config.maxDecompositionDepth` levels.
 *
 * Tasks without an `loe` field are left unchanged (they need LoE estimation
 * first, which is the responsibility of the proposal generation prompt).
 */
export async function applyDecompositionPass(
  proposals: Proposal[],
  loeConfig?: LoEConfig,
  model?: string,
): Promise<DecompositionResult> {
  const thresholdWeeks =
    loeConfig?.taskThresholdWeeks ?? LOE_DEFAULTS.taskThresholdWeeks;
  const maxDepth =
    loeConfig?.maxDecompositionDepth ?? LOE_DEFAULTS.maxDecompositionDepth;
  const resolvedModel = model ?? DEFAULT_MODEL;

  const tokenUsage = emptyAnalyzeTokenUsage();
  const decomposed: DecomposedTask[] = [];

  // Check if any tasks actually need decomposition before doing work
  const hasOversizedTasks = proposals.some((p) =>
    p.features.some((f) =>
      f.tasks.some((t) => (t.loe ?? 0) > thresholdWeeks),
    ),
  );

  if (!hasOversizedTasks) {
    return { proposals, decomposed: [], tokenUsage };
  }

  // Process each proposal's features/tasks
  const resultProposals: Proposal[] = [];

  for (const proposal of proposals) {
    const resultFeatures: ProposalFeature[] = [];

    for (const feature of proposal.features) {
      const resolvedTasks = await decomposeTasks(
        feature.tasks,
        thresholdWeeks,
        maxDepth,
        0,
        resolvedModel,
        tokenUsage,
        decomposed,
      );

      resultFeatures.push({
        ...feature,
        tasks: resolvedTasks,
      });
    }

    resultProposals.push({
      ...proposal,
      features: resultFeatures,
    });
  }

  return {
    proposals: resultProposals,
    decomposed,
    tokenUsage,
  };
}
