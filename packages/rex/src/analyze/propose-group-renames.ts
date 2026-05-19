/**
 * LLM-driven rename for a consolidation group.
 *
 * After hash-suffixed siblings are reparented under a new container, invoke
 * the LLM once per group to propose distinct, descriptive titles based on
 * each member's body content (description + acceptance criteria).
 *
 * Failure policy: LLM errors are thrown so callers can degrade gracefully
 * (children keep their hash-suffixed titles, reshape continues).
 *
 * @module analyze/propose-group-renames
 */

import { z } from "zod";
import { spawnClaude, resolveConfiguredModel, extractJson } from "./reason.js";

// ── Input types ────────────────────────────────────────────────────────────────
// Defined locally so this module stays in the domain layer (analyze/) and does
// not import from cli/commands/. Structurally equivalent to GroupRenameMember
// and GroupRenameInput in add-reshape.ts.

export interface GroupRenameMember {
  id: string;
  title: string;
  description?: string;
  acceptanceCriteria?: string[];
}

export interface GroupRenameInput {
  /** Shared base title after stripping hash suffixes. */
  baseTitle: string;
  /** Two or more members in this consolidation cluster. */
  members: GroupRenameMember[];
}

// ── Output types ───────────────────────────────────────────────────────────────

export interface GroupRenameEntry {
  /** Item ID. */
  id: string;
  /** New title proposed for this item. */
  newTitle: string;
}

export interface GroupRenameProposal {
  /** One entry per member that was renamed (may be empty when all are skipped). */
  renames: GroupRenameEntry[];
  /** LLM reasoning (empty string when skipped via fast path). */
  reasoning: string;
}

// ── Zod schema ─────────────────────────────────────────────────────────────────

const RenameEntrySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
});

const GroupRenameResponseSchema = z.object({
  renames: z.array(RenameEntrySchema).min(1),
  reasoning: z.string(),
});

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Return true when a member's title is already meaningfully distinct from
 * the group's base title (i.e. the non-hash portion differs from the base).
 *
 * Since GroupRenameInput invariants guarantee all members share the same
 * normalized base, this check only fires for items that were independently
 * renamed before the consolidation pass.
 */
export function shouldSkipMember(member: GroupRenameMember, baseTitle: string): boolean {
  const lowerTitle = member.title.toLowerCase().trim();
  const lowerBase = baseTitle.toLowerCase().trim();
  // If the title does NOT start with the base, the non-hash portion is already
  // meaningfully different — skip LLM rename for this member.
  return !lowerTitle.startsWith(lowerBase);
}

function formatMemberSection(member: GroupRenameMember, index: number): string {
  const lines: string[] = [`Item ${index + 1}:`];
  lines.push(`  ID: ${member.id}`);
  lines.push(`  Current title: ${member.title}`);
  lines.push(`  Description: ${member.description?.trim() || "(none)"}`);
  if (member.acceptanceCriteria?.length) {
    lines.push(`  Acceptance Criteria:`);
    for (const ac of member.acceptanceCriteria) {
      lines.push(`    - ${ac}`);
    }
  } else {
    lines.push(`  Acceptance Criteria: (none)`);
  }
  return lines.join("\n");
}

/**
 * Build the LLM prompt for a consolidation group rename.
 *
 * @public — exported for testing.
 */
export function buildGroupRenamePrompt(group: GroupRenameInput): string {
  const itemSections = group.members
    .map((m, i) => formatMemberSection(m, i))
    .join("\n\n");
  const idList = group.members.map((m) => `"${m.id}"`).join(", ");

  return (
    `${group.members.length} sibling PRD items were grouped under a parent because they all ` +
    `shared the base title "${group.baseTitle}" — the only differences were trailing ` +
    `machine-generated hash suffixes. Propose a distinct, descriptive title for each item ` +
    `that captures what makes it uniquely different from the others.\n\n` +
    `${itemSections}\n\n` +
    `Rules:\n` +
    `- Propose a new title for every item (one entry per ID: ${idList}).\n` +
    `- All proposed titles must be different from each other.\n` +
    `- No proposed title may equal the shared base title "${group.baseTitle}".\n` +
    `- Titles should be concise (3–8 words) and grounded in the descriptions above.\n` +
    `- If an item has no description, use the base title as-is — there is no content to differentiate it.\n` +
    `\n` +
    `Respond with JSON only (no markdown wrapper, no prose):\n` +
    `{\n` +
    `  "renames": [\n` +
    `    {"id": "<item-id>", "title": "<new title>"},\n` +
    `    ...\n` +
    `  ],\n` +
    `  "reasoning": "<brief explanation>"\n` +
    `}`
  );
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Invoke the LLM once for a consolidation group to propose descriptive titles
 * for all members.
 *
 * Members whose non-hash title portion already differs from the group base
 * (determined by {@link shouldSkipMember}) are excluded from the LLM call
 * and kept with their current titles.
 *
 * Uniqueness is enforced after the LLM response: when the LLM returns
 * duplicate or empty titles, the member's original (hash-suffixed) title is
 * used as a deterministic fallback, guaranteeing uniqueness because hash
 * suffixes were already distinct before consolidation.
 *
 * @throws {Error} When the LLM call fails or the response cannot be parsed.
 *   Callers must catch and degrade gracefully (children keep existing titles).
 */
export async function proposeGroupRenames(
  group: GroupRenameInput,
  model?: string,
): Promise<GroupRenameProposal> {
  // Exclude members whose non-hash portion already differs from the base title
  const membersToRename = group.members.filter(
    (m) => !shouldSkipMember(m, group.baseTitle),
  );

  // Nothing to do when zero or one member needs renaming
  if (membersToRename.length < 2) {
    return { renames: [], reasoning: "" };
  }

  const subgroup: GroupRenameInput = { ...group, members: membersToRename };
  const prompt = buildGroupRenamePrompt(subgroup);
  const resolvedModel = resolveConfiguredModel(model);

  const llmResult = await spawnClaude(prompt, resolvedModel);
  const jsonText = extractJson(llmResult.text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(
      `LLM group-rename response did not contain valid JSON.\n` +
        `Raw response (first 300 chars): ${llmResult.text.slice(0, 300)}`,
    );
  }

  const validation = GroupRenameResponseSchema.safeParse(parsed);
  if (!validation.success) {
    throw new Error(
      `LLM group-rename response failed validation: ${validation.error.message}.\n` +
        `Parsed value: ${JSON.stringify(parsed)}`,
    );
  }

  const { renames: rawRenames, reasoning } = validation.data;

  // Build a lookup: id → proposed title
  const proposedById = new Map<string, string>(
    rawRenames.map((r) => [r.id, r.title.trim()]),
  );

  // Apply uniqueness enforcement: track accepted titles and fall back to the
  // original hash-suffixed title on collision or empty/base-equal proposals.
  const finalRenames: GroupRenameEntry[] = [];
  const usedTitlesNorm = new Set<string>();

  for (const member of membersToRename) {
    let proposed = proposedById.get(member.id)?.trim() ?? "";

    // Reject empty or base-equal proposals
    const proposedNorm = proposed.toLowerCase().replace(/\s+/g, " ");
    const baseNorm = group.baseTitle.toLowerCase().replace(/\s+/g, " ");
    if (!proposed || proposedNorm === baseNorm) {
      proposed = member.title; // keep original hash-suffixed title
    }

    // Enforce uniqueness: fall back to original hash-suffixed title on collision
    const finalNorm = proposed.toLowerCase().replace(/\s+/g, " ");
    if (usedTitlesNorm.has(finalNorm)) {
      proposed = member.title;
    }

    usedTitlesNorm.add(proposed.toLowerCase().replace(/\s+/g, " "));
    finalRenames.push({ id: member.id, newTitle: proposed });
  }

  return { renames: finalRenames, reasoning };
}
