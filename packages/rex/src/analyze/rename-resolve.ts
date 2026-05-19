/**
 * LLM-driven rename resolution for conflicting sibling titles.
 *
 * When two sibling PRD items share a title but describe distinct work
 * (detected by low content similarity), invoke the LLM to propose
 * unique, descriptive titles for both items based on their full content.
 *
 * Failure policy: if the LLM fails to respond, the response cannot be
 * parsed, or the proposed titles still collide, an error is thrown —
 * there is no suffix-append fallback.
 *
 * @module analyze/rename-resolve
 */

import { z } from "zod";
import type { PRDItem } from "../schema/index.js";
import { spawnClaude, resolveConfiguredModel, extractJson } from "./reason.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SiblingRenameProposal {
  /** New title for the first item (Item A). */
  titleA: string;
  /** New title for the second item (Item B). */
  titleB: string;
  /** LLM reasoning explaining why these titles better distinguish the items. */
  reasoning: string;
}

// ── Zod schema for LLM response validation ─────────────────────────────────────

const RenameResponseSchema = z.object({
  titleA: z.string().min(1, "titleA must be non-empty"),
  titleB: z.string().min(1, "titleB must be non-empty"),
  reasoning: z.string(),
});

// ── Prompt construction ────────────────────────────────────────────────────────

function formatItemSection(label: string, item: PRDItem): string {
  const lines: string[] = [`${label}:`];
  lines.push(`  ID: ${item.id}`);
  lines.push(`  Title: ${item.title}`);
  lines.push(`  Level: ${item.level}`);
  lines.push(`  Description: ${item.description?.trim() || "(none)"}`);
  if (item.acceptanceCriteria?.length) {
    lines.push(`  Acceptance Criteria:`);
    for (const ac of item.acceptanceCriteria) {
      lines.push(`    - ${ac}`);
    }
  } else {
    lines.push(`  Acceptance Criteria: (none)`);
  }
  return lines.join("\n");
}

/**
 * Build the rename prompt for two siblings with a title collision.
 *
 * @public — exported for testing.
 */
export function buildRenamePrompt(itemA: PRDItem, itemB: PRDItem): string {
  return `Two PRD items are siblings in the same project plan. They share an identical title \
but describe different work. Propose a distinct, descriptive title for each item that \
accurately reflects what it covers and differentiates it from the other.

${formatItemSection("Item A", itemA)}

${formatItemSection("Item B", itemB)}

Rules:
- Both new titles must be different from each other.
- Neither new title should be identical to the shared original title "${itemA.title}".
- Titles should be concise (ideally 3-8 words) and capture the specific scope of each item.
- Base the titles on the descriptions and acceptance criteria provided above.

Respond with JSON only (no markdown wrapper, no prose):
{
  "titleA": "<new title for Item A>",
  "titleB": "<new title for Item B>",
  "reasoning": "<brief explanation of why these titles distinguish the two items>"
}`;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Invoke the LLM to propose distinct titles for two siblings that share a title.
 *
 * @param itemA - First colliding sibling.
 * @param itemB - Second colliding sibling.
 * @param model - Optional model override (falls back to configured default).
 * @returns A rename proposal with new titles and reasoning.
 * @throws {Error} If the LLM call fails, the response is unparseable, or the
 *   proposed titles still collide with each other.
 */
export async function proposeSiblingRenames(
  itemA: PRDItem,
  itemB: PRDItem,
  model?: string,
): Promise<SiblingRenameProposal> {
  const prompt = buildRenamePrompt(itemA, itemB);
  const resolvedModel = resolveConfiguredModel(model);

  const llmResult = await spawnClaude(prompt, resolvedModel);
  const jsonText = extractJson(llmResult.text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(
      `LLM rename response did not contain valid JSON.\n` +
      `Raw response (first 300 chars): ${llmResult.text.slice(0, 300)}`,
    );
  }

  const validation = RenameResponseSchema.safeParse(parsed);
  if (!validation.success) {
    throw new Error(
      `LLM rename response failed validation: ${validation.error.message}.\n` +
      `Parsed value: ${JSON.stringify(parsed)}`,
    );
  }

  const { titleA, titleB, reasoning } = validation.data;

  // Ensure the proposed titles are actually different from each other.
  const normalA = titleA.toLowerCase().trim().replace(/\s+/g, " ");
  const normalB = titleB.toLowerCase().trim().replace(/\s+/g, " ");
  if (normalA === normalB) {
    throw new Error(
      `LLM rename produced a collision: both titles normalized to "${normalA}". ` +
      `Cannot resolve title collision for items "${itemA.id}" and "${itemB.id}".`,
    );
  }

  return { titleA, titleB, reasoning };
}
