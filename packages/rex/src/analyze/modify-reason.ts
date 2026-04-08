/**
 * LLM-powered proposal modification pipeline.
 *
 * Takes an existing set of proposals and a natural-language modification
 * request, sends both to the LLM, and returns revised proposals that
 * incorporate the requested changes while preserving structure and metadata.
 *
 * Follows the same patterns as reason.ts (spawnClaude, extractJson,
 * parseProposalResponse, Zod validation) and reshape-reason.ts
 * (prompt construction, token accumulation).
 *
 * @module analyze/modify-reason
 */

import type { PRDItem, AnalyzeTokenUsage } from "../schema/index.js";
import type { Proposal } from "./propose.js";
import type { ReasonResult } from "./reason.js";
import {
  spawnClaude,
  parseProposalResponse,
  emptyAnalyzeTokenUsage,
  accumulateTokenUsage,
  readProjectContext,
  validateProposalQuality,
  PRD_SCHEMA,
  FEW_SHOT_EXAMPLE,
  TASK_QUALITY_RULES,
  ANTI_PATTERNS,
  OUTPUT_INSTRUCTION,
  MAX_RETRIES,
} from "./reason.js";
import { validateModificationRequest } from "./validate-modification.js";

// ── Types ──

export interface ModifyProposalOptions {
  /** Optional model override. */
  model?: string;
  /** Project directory for loading project context. */
  dir?: string;
  /** Existing PRD items for deduplication context. */
  existingItems?: PRDItem[];
  /** Maximum number of retry attempts on parse failure. */
  maxRetries?: number;
  /** Skip validation of the modification request (default: false). */
  skipValidation?: boolean;
}

export interface ModifyProposalResult extends ReasonResult {
  /** The original proposals before modification (for comparison). */
  originalProposals: Proposal[];
  /** Quality issues found in the modified proposals. */
  qualityIssues: ReturnType<typeof validateProposalQuality>;
  /** Validation error when the request was rejected before LLM call. */
  validationError?: string;
  /** Suggestion for improving a rejected request. */
  validationSuggestion?: string;
}

// ── Prompt building ──

/**
 * Build the LLM prompt for modifying existing proposals based on
 * natural-language feedback. Pure function — no I/O.
 *
 * Exported for testability.
 */
export function buildModifyPrompt(
  proposals: Proposal[],
  modificationRequest: string,
  options?: {
    existingSummary?: string;
    projectContext?: string;
  },
): string {
  const proposalJson = JSON.stringify(proposals, null, 2);

  const existingBlock = options?.existingSummary
    ? `\nExisting PRD (for deduplication — do NOT include these items):\n${options.existingSummary}\n`
    : "";

  const contextBlock = options?.projectContext
    ? `\nProject context (from documentation):\n${options.projectContext}\n`
    : "";

  return `You are a product requirements analyst. You have an existing set of PRD proposals and a user's modification request. Revise the proposals to incorporate the requested changes.

## Current Proposals
${proposalJson}

## Modification Request
${modificationRequest}

## Output Format
${PRD_SCHEMA}

${FEW_SHOT_EXAMPLE}

## Rules
- Apply the user's modification request to the proposals above.
- Preserve the overall epic/feature/task hierarchy unless the request explicitly asks to restructure.
- Keep all metadata (descriptions, acceptance criteria, priorities, tags) that the modification does not affect.
- If the request asks to remove items, omit them from the output.
- If the request asks to add items, include them in the appropriate position in the hierarchy.
- If the request asks to change specific items, modify only those items and leave the rest unchanged.
- If the request is ambiguous, interpret it in the way that makes the most practical sense for a software project.
- Do NOT invent changes beyond what the request asks for.

${TASK_QUALITY_RULES}

${ANTI_PATTERNS}
${existingBlock}${contextBlock}
${OUTPUT_INSTRUCTION}`;
}

// ── Summarization ──

/**
 * Summarize existing PRD items into a text block for prompt context.
 * Mirrors the pattern in reason.ts but imported as a standalone helper
 * to avoid circular dependencies.
 */
function summarizeExisting(items: PRDItem[]): string {
  if (!items || items.length === 0) return "(empty PRD)";

  const lines: string[] = [];
  function walk(list: PRDItem[], depth: number): void {
    for (const item of list) {
      const indent = "  ".repeat(depth);
      lines.push(`${indent}- [${item.level}] ${item.title} (${item.status})`);
      if (item.children) walk(item.children, depth + 1);
    }
  }
  walk(items, 0);

  return lines.length > 0 ? lines.join("\n") : "(empty PRD)";
}

// ── Core pipeline ──

/**
 * Modify existing proposals based on a natural-language modification request.
 *
 * Pipeline:
 * 1. Serialize current proposals as JSON context
 * 2. Combine with the user's modification request
 * 3. Send to LLM with structured output instructions
 * 4. Parse and validate the revised proposal response
 * 5. Run quality validation on the result
 *
 * On parse failure, retries up to `maxRetries` times (default: MAX_RETRIES).
 * If all retries fail, throws the last error.
 *
 * @param proposals - The original proposals to modify
 * @param modificationRequest - Natural language description of desired changes
 * @param options - Optional configuration (model, dir, existing items)
 * @returns Modified proposals with token usage and quality issues
 */
export async function modifyProposals(
  proposals: Proposal[],
  modificationRequest: string,
  options: ModifyProposalOptions = {},
): Promise<ModifyProposalResult> {
  if (proposals.length === 0) {
    return {
      proposals: [],
      originalProposals: [],
      tokenUsage: emptyAnalyzeTokenUsage(),
      qualityIssues: [],
    };
  }

  if (!modificationRequest.trim()) {
    // No modification requested — return the originals unchanged
    return {
      proposals,
      originalProposals: proposals,
      tokenUsage: emptyAnalyzeTokenUsage(),
      qualityIssues: validateProposalQuality(proposals),
    };
  }

  // Validate the modification request before calling the LLM
  if (!options.skipValidation) {
    const validation = validateModificationRequest(modificationRequest, proposals);
    if (!validation.valid) {
      return {
        proposals,
        originalProposals: proposals,
        tokenUsage: emptyAnalyzeTokenUsage(),
        qualityIssues: validateProposalQuality(proposals),
        validationError: validation.error,
        validationSuggestion: validation.suggestion,
      };
    }
  }

  const maxRetries = options.maxRetries ?? MAX_RETRIES;
  const tokenUsage = emptyAnalyzeTokenUsage();

  // Build context
  const existingSummary = options.existingItems
    ? summarizeExisting(options.existingItems)
    : undefined;

  const projectContext = options.dir
    ? await readProjectContext(options.dir)
    : undefined;

  const prompt = buildModifyPrompt(proposals, modificationRequest, {
    existingSummary,
    projectContext: projectContext || undefined,
  });

  // LLM call with retries on parse failure
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await spawnClaude(prompt, options.model);
      accumulateTokenUsage(tokenUsage, result.tokenUsage);

      const modified = parseProposalResponse(result.text);
      const qualityIssues = validateProposalQuality(modified);

      return {
        proposals: modified,
        originalProposals: proposals,
        tokenUsage,
        qualityIssues,
      };
    } catch (err) {
      lastError = err as Error;
      // Only retry on parse/validation errors, not on network/auth errors
      if (!isParseError(lastError)) {
        throw lastError;
      }
      // Token usage is accumulated even on failures (LLM was called)
    }
  }

  // All retries exhausted
  throw lastError!;
}

/**
 * Check whether an error is a parse/validation error (retryable)
 * vs a network/auth error (not retryable).
 */
function isParseError(err: Error): boolean {
  return (
    err.message.includes("Invalid JSON") ||
    err.message.includes("failed schema validation") ||
    err.message.includes("SyntaxError")
  );
}
