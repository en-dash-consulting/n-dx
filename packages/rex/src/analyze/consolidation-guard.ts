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
  parseProposalResponse,
  emptyAnalyzeTokenUsage,
  accumulateTokenUsage,
  FEW_SHOT_EXAMPLE,
  OUTPUT_INSTRUCTION,
  PRD_SCHEMA,
  TASK_QUALITY_RULES,
} from "./reason.js";
import type { PromptEnvelope } from "@n-dx/llm-client";
import { section, rexPromptEnvelope, rexPrompt } from "./prompt-envelope.js";

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
export function buildConsolidationGuardEnvelope(
  proposals: Proposal[],
  ceiling: number,
  currentTaskCount: number,
): PromptEnvelope {
  return rexPromptEnvelope([
    section(
      "role",
      `You are a product requirements analyst. The following PRD proposals contain ${currentTaskCount} tasks, which exceeds the project's consolidation ceiling of ${ceiling} tasks. Consolidate them into fewer, larger work packages.`,
    ),
    section("input", `Current proposals:\n${JSON.stringify(proposals)}`),
    section(
      "consolidation",
      `Target: Reduce to at most ${ceiling} tasks total while preserving all scope.`,
    ),
    section(
      "input-rules",
      [
        "Rules:",
        "- Merge closely related tasks within each feature into broader tasks with combined acceptance criteria.",
        "- If a feature has many small tasks, consolidate them into 1–3 well-scoped tasks.",
        "- If multiple features overlap significantly, merge them into one feature.",
        "- Preserve the epic structure — do NOT change epic titles unless features are merged across epics.",
        // Verb-first titles and the description + acceptanceCriteria
        // requirement are stated by TASK_QUALITY_RULES, which this prompt also
        // includes. They were restated here twice over.
        "- Preserve ALL original intent — consolidation must not drop functionality or acceptance criteria.",
        "- Keep the highest priority among merged tasks.",
        '- Preserve LoE fields: when merging tasks with "loe", sum the LoE values and update "loeRationale" to reflect the combined scope. Keep the lower confidence level.',
        "- Do NOT add new functionality — only consolidate what exists.",
      ].join("\n"),
    ),
    section("quality", TASK_QUALITY_RULES),
    section("schema", PRD_SCHEMA),
    section("example", FEW_SHOT_EXAMPLE),
    section("output", OUTPUT_INSTRUCTION),
  ]);
}

export function buildConsolidationGuardPrompt(
  proposals: Proposal[],
  ceiling: number,
  currentTaskCount: number,
): string {
  return rexPrompt(
    buildConsolidationGuardEnvelope(proposals, ceiling, currentTaskCount),
  );
}

// ── Guard logic ──

/**
 * Apply the post-processing consolidation guard to a set of proposals.
 *
 * If the total task count exceeds the configured ceiling, triggers a
 * secondary LLM consolidation pass. If the LLM cannot reduce below the
 * ceiling, the best-effort result is returned with a warning.
 *
 * Mechanical single-shot call: when no explicit model is given, routes to the
 * vendor's light-tier model (e.g. haiku) instead of the standard tier.
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

  const result = await spawnClaude(prompt, model, undefined, { taskClass: "prd.consolidate-check" });
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
