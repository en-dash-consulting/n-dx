/**
 * PRD refinements proposed by the Ask exchange.
 *
 * Capture adds an item; a refinement changes one that exists. That difference
 * is the whole reason this module is careful: adding a wrong item leaves a
 * wrong item to delete, while rewriting acceptance criteria destroys what was
 * there, and an LLM doing that unreviewed is how a PRD quietly loses its
 * history.
 *
 * Three things follow from it, and each is enforced here rather than left to
 * the caller.
 *
 * **A proposal is a diff, not an instruction.** Every proposal carries the
 * `before` it was written against as well as the `after` it wants. That is what
 * makes a before/after review possible at all, and it is what makes staleness
 * detectable: an item edited between the answer and the click no longer matches
 * the `before`, and {@link stalenessOf} says so instead of letting the write
 * land on content the model never saw.
 *
 * **Nothing is applied by being proposed.** Parsing produces data. Writing is a
 * separate call, against explicitly named ids.
 *
 * **The model's JSON is not trusted.** {@link parseRefinementProposals} accepts
 * only well-formed proposals of known kinds and drops the rest, because the
 * alternative is a malformed `after` reaching the store.
 *
 * @module web/server/ask-refinements
 * @see packages/web/src/server/routes-rex-refinements.ts — applies them
 */

import type { PRDItem } from "./rex-gateway.js";

/** The mutations the exchange may propose. */
export type RefinementKind =
  | "description"
  | "acceptanceCriteria"
  | "priority"
  | "parent"
  | "merge";

/** Priorities rex accepts. */
const PRIORITIES = new Set(["critical", "high", "medium", "low"]);

/**
 * One proposed change to one item.
 *
 * `before` and `after` are the rendered values of the affected field, so the
 * reviewer sees exactly what would change and the applier can check that the
 * item still looks the way the model saw it. For `merge`, `after` names the
 * sibling being merged away and `before` is that sibling's title.
 */
export interface RefinementProposal {
  /** Stable within one answer, so the client can accept proposals by name. */
  id: string;
  kind: RefinementKind;
  /** The item this changes. */
  itemId: string;
  /** Item title at proposal time, for a review UI that should not have to look it up. */
  itemTitle: string;
  /** Why this change — the model's justification, shown with the diff. */
  rationale: string;
  /** The field's value as the model saw it. */
  before: string[];
  /** The field's value as the model proposes it. */
  after: string[];
}

/** What a proposal would do, once checked against the live item. */
export type RefinementStaleness =
  | { stale: false }
  | { stale: true; reason: string };

/** The fenced block the model is asked to emit proposals in. */
export const REFINEMENT_BLOCK_TAG = "ndx-refinements";

/**
 * Instructions appended to the prompt when the caller wants proposals.
 *
 * Opt-in per request rather than always-on: most questions are questions, and
 * inviting a PRD rewrite in answer to "what does the billing zone do" produces
 * proposals nobody asked for — which the user then has to read and reject.
 */
export function refinementInstructions(items: PRDItem[]): string {
  const inventory = items
    .map((i) => `- id=${i.id} level=${i.level} priority=${i.priority ?? "unset"} title=${i.title}`)
    .join("\n");

  return [
    "--- PRD items you may propose changes to ---",
    inventory || "(none)",
    "",
    "If — and only if — the question asks you to improve, fix, or restructure the",
    "PRD, you may propose concrete changes to the items above. Answer in prose",
    `first, then append one fenced block tagged \`${REFINEMENT_BLOCK_TAG}\` holding`,
    "a JSON array. Each element must be:",
    '  {"kind":"description"|"acceptanceCriteria"|"priority"|"parent"|"merge",',
    '   "itemId":"<id from the list above>",',
    '   "rationale":"<why this change>",',
    '   "before":[<the current value, as you were given it>],',
    '   "after":[<the proposed value>]}',
    "",
    "`before` must be what the item says now — it is checked against the item on",
    "disk and the proposal is refused if it does not match. For priority and",
    "parent, use a single-element array. For parent, `after` is the new parent's",
    "id. For merge, `itemId` is the item to keep and `after` is the id of the",
    "duplicate sibling to merge into it.",
    "",
    "Propose nothing rather than something you are unsure of. Omit the block",
    "entirely when the question is not asking for PRD changes.",
  ].join("\n");
}

/** Read a fenced block's body out of the model's answer. */
function extractBlock(answer: string, tag: string): string | null {
  const fence = new RegExp("```" + tag + "\\s*\\n([\\s\\S]*?)```", "i");
  const match = fence.exec(answer);
  return match ? match[1]!.trim() : null;
}

/**
 * Remove the proposals block from the prose.
 *
 * The block is machine input rendered as proposal cards; leaving it in the
 * answer would show the user the same changes twice, once as JSON.
 */
export function stripRefinementBlock(answer: string): string {
  const fence = new RegExp("```" + REFINEMENT_BLOCK_TAG + "\\s*\\n[\\s\\S]*?```", "gi");
  return answer.replace(fence, "").trimEnd();
}

/** Coerce a proposal field to the string array the diff renders. */
function toLines(value: unknown): string[] | null {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) return value as string[];
  return null;
}

/**
 * Parse the proposals out of an answer.
 *
 * Malformed entries are dropped rather than failing the whole answer: the prose
 * is still worth reading, and a partial set of well-formed proposals is still
 * reviewable. Anything referring to an item that does not exist is dropped too
 * — a proposal against a hallucinated id can only ever fail later, and failing
 * it here keeps it off the review list.
 */
export function parseRefinementProposals(
  answer: string,
  items: PRDItem[],
): RefinementProposal[] {
  const block = extractBlock(answer, REFINEMENT_BLOCK_TAG);
  if (!block) return [];

  let raw: unknown;
  try {
    raw = JSON.parse(block);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const byId = new Map(items.map((i) => [i.id, i]));
  const proposals: RefinementProposal[] = [];

  for (const [index, entry] of raw.entries()) {
    if (typeof entry !== "object" || entry === null) continue;
    const { kind, itemId, rationale, before, after } = entry as Record<string, unknown>;

    if (typeof kind !== "string" || !isRefinementKind(kind)) continue;
    if (typeof itemId !== "string") continue;
    const item = byId.get(itemId);
    if (!item) continue;

    const beforeLines = toLines(before);
    const afterLines = toLines(after);
    if (!beforeLines || !afterLines) continue;
    if (kind === "priority" && !PRIORITIES.has(afterLines[0] ?? "")) continue;
    if ((kind === "priority" || kind === "parent" || kind === "merge") && afterLines.length !== 1) continue;
    // A no-op proposal is noise in a review list.
    if (beforeLines.join("\n") === afterLines.join("\n")) continue;

    proposals.push({
      id: `refinement-${index + 1}`,
      kind,
      itemId,
      itemTitle: item.title,
      rationale: typeof rationale === "string" ? rationale : "",
      before: beforeLines,
      after: afterLines,
    });
  }

  return proposals;
}

function isRefinementKind(value: string): value is RefinementKind {
  return value === "description"
    || value === "acceptanceCriteria"
    || value === "priority"
    || value === "parent"
    || value === "merge";
}

/**
 * The item's current value for the field a proposal targets.
 *
 * Rendered the same way the model was asked to render `before`, so the two are
 * comparable. Exported because the applier needs it after the write to report
 * what actually changed.
 */
export function currentValue(item: PRDItem, kind: RefinementKind, parentId?: string): string[] {
  switch (kind) {
    case "description":
      return item.description ? [item.description] : [];
    case "acceptanceCriteria":
      return [...(item.acceptanceCriteria ?? [])];
    case "priority":
      return [item.priority ?? "medium"];
    case "parent":
      return [parentId ?? ""];
    case "merge":
      // Compared against the sibling being merged away, which the applier
      // resolves; the item under `itemId` is the survivor and does not move.
      return [];
  }
}

/**
 * Decide whether a proposal still matches the item it was written against.
 *
 * The comparison is on the field's rendered value, whitespace-normalised —
 * a reformatted description is not a different description, but a rewritten
 * one is. Merge proposals are checked by the applier instead, which has to
 * resolve the sibling before it can say anything useful.
 */
export function stalenessOf(
  proposal: RefinementProposal,
  item: PRDItem | null,
  parentId?: string,
): RefinementStaleness {
  if (!item) {
    return { stale: true, reason: `Item ${proposal.itemId} no longer exists.` };
  }
  if (proposal.kind === "merge") return { stale: false };

  const now = currentValue(item, proposal.kind, parentId);
  if (normalize(now) !== normalize(proposal.before)) {
    return {
      stale: true,
      reason:
        `"${item.title}" has changed since this was proposed, so the change was `
        + `written against content that is no longer there. Ask again to get a `
        + `proposal against the current text.`,
    };
  }
  return { stale: false };
}

function normalize(lines: string[]): string {
  return lines.map((line) => line.trim().replace(/\s+/g, " ")).filter(Boolean).join("\n");
}
