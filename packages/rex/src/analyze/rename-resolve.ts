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
import { withEscalation } from "./escalate.js";

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
 * Mechanical single-shot call: when no explicit model is given, resolves the
 * vendor's light-tier model (e.g. haiku) instead of the standard tier.
 *
 * @param itemA - First colliding sibling.
 * @param itemB - Second colliding sibling.
 * @param model - Optional model override (falls back to the light-tier model).
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

  // Light-tier call with an escalation ladder: a schema failure retries on the
  // standard tier carrying the validation error, so cheap-first routing is
  // safe — a light model that cannot satisfy the contract hands off rather
  // than failing the rename.
  const escalation = await withEscalation({
    prompt,
    taskClass: "prd.rename",
    model,
    validate: (text) => {
      const jsonText = extractJson(text);
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        throw new Error(
          `Response did not contain valid JSON. Received: ${text.slice(0, 200)}`,
        );
      }
      const result = RenameResponseSchema.safeParse(parsed);
      if (!result.success) {
        throw new Error(`Response failed schema validation: ${result.error.message}`);
      }

      // Semantic check, inside the contract rather than after it: two titles
      // that normalize to the same string satisfy the schema but do not solve
      // the collision this call exists to solve. Checking here means the
      // standard tier gets a chance at it; checking afterwards, as this used
      // to, failed the rename outright.
      const { titleA, titleB } = result.data;
      const normalA = titleA.toLowerCase().trim().replace(/\s+/g, " ");
      const normalB = titleB.toLowerCase().trim().replace(/\s+/g, " ");
      if (normalA === normalB) {
        throw new Error(
          `Both proposed titles normalize to "${normalA}" — they must differ ` +
          "from each other to resolve the collision.",
        );
      }
      return result.data;
    },
  });

  const { titleA, titleB, reasoning } = escalation.value;
  return { titleA, titleB, reasoning };
}
