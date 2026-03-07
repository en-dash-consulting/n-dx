/**
 * Post-processing consolidation guard.
 *
 * After the LLM returns proposals, this module detects over-granular output
 * (task count exceeds a configurable ceiling) and triggers a secondary
 * re-consolidation prompt as a safety net. If the LLM cannot reduce below
 * the ceiling, a labeled warning is emitted.
 *
 * @module rex/analyze/consolidation-guard
 */

import type { LoEConfig, AnalyzeTokenUsage } from "../schema/index.js";
import { LOE_DEFAULTS } from "../schema/index.js";
import type { Proposal } from "./propose.js";
import {
  spawnClaude,
  DEFAULT_MODEL,
  parseProposalResponse,
  emptyAnalyzeTokenUsage,
  accumulateTokenUsage,
  FEW_SHOT_EXAMPLE,
  OUTPUT_INSTRUCTION,
  PRD_SCHEMA,
  TASK_QUALITY_RULES,
} from "./reason.js";

// ── Types ──

export interface ConsolidationGuardResult {
  /** Proposals after consolidation (may be unchanged if within ceiling). */
  proposals: Proposal[];
  /** Whether the guard triggered a consolidation pass. */
  triggered: boolean;
  /** Whether the consolidation successfully reduced below the ceiling. */
  reduced: boolean;
  /** Original task count before consolidation. */
  originalTaskCount: number;
  /** Task count after consolidation (same as original if not triggered). */
  finalTaskCount: number;
  /** The ceiling that was applied. */
  ceiling: number;
  /** Warning message if consolidation could not reduce below ceiling. */
  warning?: string;
  /** Token usage from the consolidation LLM call (zero if not triggered). */
  tokenUsage: AnalyzeTokenUsage;
}

// ── Task counting ──

/** Count total tasks across all proposals. */
export function countProposalTasks(proposals: Proposal[]): number {
  let count = 0;
  for (const p of proposals) {
    for (const f of p.features) {
      count += f.tasks.length;
    }
  }
  return count;
}

// ── Prompt builder ──

/**
 * Build the re-consolidation prompt for over-granular proposals.
 * Pure function — no I/O.
 */
export function buildConsolidationGuardPrompt(
  proposals: Proposal[],
  ceiling: number,
  currentTaskCount: number,
): string {
  const proposalJson = JSON.stringify(proposals, null, 2);

  return `You are a product requirements analyst. The following PRD proposals contain ${currentTaskCount} tasks, which exceeds the project's consolidation ceiling of ${ceiling} tasks. Consolidate them into fewer, larger work packages.

Current proposals:
${proposalJson}

Target: Reduce to at most ${ceiling} tasks total while preserving all scope.

Rules:
- Merge closely related tasks within each feature into broader tasks with combined acceptance criteria.
- If a feature has many small tasks, consolidate them into 1–3 well-scoped tasks.
- If multiple features overlap significantly, merge them into one feature.
- Preserve the epic structure — do NOT change epic titles unless features are merged across epics.
- Each resulting task MUST have a verb-first title AND both a description and acceptanceCriteria.
- Preserve ALL original intent — consolidation must not drop functionality or acceptance criteria.
- Keep the highest priority among merged tasks.
- Preserve LoE fields: when merging tasks with "loe", sum the LoE values and update "loeRationale" to reflect the combined scope. Keep the lower confidence level.
- Do NOT add new functionality — only consolidate what exists.
- Do NOT produce tasks with only a title — every task needs both description and criteria.

${TASK_QUALITY_RULES}

${PRD_SCHEMA}

${FEW_SHOT_EXAMPLE}

${OUTPUT_INSTRUCTION}`;
}

// ── Guard logic ──

/**
 * Apply the post-processing consolidation guard to a set of proposals.
 *
 * If the total task count exceeds the configured ceiling, triggers a
 * secondary LLM consolidation pass. If the LLM cannot reduce below the
 * ceiling, the best-effort result is returned with a warning.
 */
export async function applyConsolidationGuard(
  proposals: Proposal[],
  loeConfig?: LoEConfig,
  model?: string,
): Promise<ConsolidationGuardResult> {
  const ceiling = loeConfig?.proposalCeiling ?? LOE_DEFAULTS.proposalCeiling;
  const originalTaskCount = countProposalTasks(proposals);
  const tokenUsage = emptyAnalyzeTokenUsage();

  // Within ceiling — no action needed
  if (originalTaskCount <= ceiling) {
    return {
      proposals,
      triggered: false,
      reduced: false,
      originalTaskCount,
      finalTaskCount: originalTaskCount,
      ceiling,
      tokenUsage,
    };
  }

  // Over ceiling — trigger consolidation
  const prompt = buildConsolidationGuardPrompt(
    proposals,
    ceiling,
    originalTaskCount,
  );

  const result = await spawnClaude(prompt, model ?? DEFAULT_MODEL);
  accumulateTokenUsage(tokenUsage, result.tokenUsage);

  const consolidated = parseProposalResponse(result.text);
  const finalTaskCount = countProposalTasks(consolidated);

  if (consolidated.length === 0) {
    // Consolidation failed entirely — return originals with warning
    return {
      proposals,
      triggered: true,
      reduced: false,
      originalTaskCount,
      finalTaskCount: originalTaskCount,
      ceiling,
      warning: `Consolidation guard: LLM returned no proposals. Keeping original ${originalTaskCount} tasks (ceiling: ${ceiling}).`,
      tokenUsage,
    };
  }

  if (finalTaskCount > ceiling) {
    // Consolidation reduced but not enough — return best-effort with warning
    return {
      proposals: consolidated,
      triggered: true,
      reduced: false,
      originalTaskCount,
      finalTaskCount,
      ceiling,
      warning: `Consolidation guard: reduced from ${originalTaskCount} to ${finalTaskCount} tasks but could not reach ceiling of ${ceiling}.`,
      tokenUsage,
    };
  }

  // Successfully reduced below ceiling
  return {
    proposals: consolidated,
    triggered: true,
    reduced: true,
    originalTaskCount,
    finalTaskCount,
    ceiling,
    tokenUsage,
  };
}
