/**
 * PRD refinement proposals — the Ask panel acting *on* the PRD, not only
 * capturing new items into it.
 *
 * The user says what is wrong or missing in an existing item; the model answers
 * in prose and may append a set of concrete mutations. This module owns three
 * things and no I/O:
 *
 *   1. {@link renderPrdContext} — the PRD as prompt context, so the model can
 *      only propose changes to items that exist and can quote their current
 *      text back as the "before" side of a diff.
 *   2. {@link parseAnswerRefinements} — the model's fenced block, validated
 *      against the document it was generated from and turned into proposals
 *      that already carry their own before/after diffs.
 *   3. {@link applyRefinements} — the mutation, run by the caller *inside*
 *      `store.withTransaction` so the lock is held across read-modify-write.
 *
 * ## Why the "before" side is the server's, never the model's
 *
 * A diff is only a review surface if its "before" is what is actually on disk.
 * The model is asked for the *after* values only; every `before` in a proposal
 * is read out of the loaded document here. A model that misquotes the current
 * description therefore cannot produce a diff that hides what it is destroying.
 *
 * ## Staleness
 *
 * Each proposal carries a {@link itemFingerprint} of every item whose content it
 * depends on, taken when the answer was generated. {@link applyRefinements}
 * recomputes those fingerprints from the freshly-loaded document inside the
 * lock and refuses any proposal whose subject has moved on. Without it the
 * review is a review of a state that no longer exists: the user accepts a diff
 * against text that another writer has already replaced, and the accept
 * silently reverts that writer's work.
 *
 * The fingerprint covers content (`level`, `title`, `description`,
 * `acceptanceCriteria`, `priority`) and deliberately not placement: an item
 * reparented elsewhere is still the item the user reviewed, so an unrelated
 * move must not invalidate a description rewrite. Placement is checked where it
 * is the thing being changed — a `reparent` proposal states the parent it
 * expects to move the item *out of*, and is stale when that no longer holds.
 *
 * @module web/server/prd-refinement
 * @see routes-rex/refinements.ts — the endpoint that applies accepted proposals
 * @see routes-sourcevision-ask.ts — the endpoint that generates them
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import {
  LEVEL_HIERARCHY,
  findItem,
  insertChild,
  isPriority,
  mergeItems,
  previewMerge,
  removeFromTree,
  updateInTree,
  validateMerge,
  walkTree,
} from "./rex-gateway.js";
import type { ItemLevel, PRDDocument, PRDItem } from "./rex-gateway.js";

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

/**
 * Items rendered into the prompt.
 *
 * A PRD larger than this is summarised with an omission note rather than
 * truncated silently: a model that is not told the list is partial will happily
 * propose merging two items because it never saw the third.
 */
const MAX_PRD_ITEMS = 120;

/** Characters of one item's description carried into the prompt. */
const MAX_ITEM_PROSE_CHARS = 800;

/** Acceptance criteria listed per item. */
const MAX_ITEM_CRITERIA = 15;

/**
 * Proposals accepted from one answer.
 *
 * A review surface stops being one past a certain length — twenty diffs get
 * accepted in a batch without being read, which is the failure this whole
 * feature exists to prevent.
 */
export const MAX_REFINEMENT_PROPOSALS = 10;

/** Characters of a rationale kept. */
const MAX_RATIONALE_CHARS = 600;

/** Length of the content fingerprint, in hex characters. */
const FINGERPRINT_CHARS = 16;

/** Info string that marks the model's proposal block. */
export const REFINEMENT_FENCE_TAG = "ndx-refinements";

// ---------------------------------------------------------------------------
// Proposal types
// ---------------------------------------------------------------------------

/** Fields a proposal can change. `parent` is placement, the rest are content. */
export type RefinementField = "description" | "acceptanceCriteria" | "priority" | "parent";

/**
 * One field's before/after, rendered as lines.
 *
 * Both sides are `string[]` regardless of the field's own type so the viewer
 * renders every diff the same way: a scalar is a one-line list, an empty list
 * means the field is absent, and a criteria list is one line per criterion.
 */
export interface RefinementDiff {
  field: RefinementField;
  before: string[];
  after: string[];
}

/** Content fingerprint of one item, taken when the answer was generated. */
export interface RefinementBaseline {
  itemId: string;
  fingerprint: string;
}

interface RefinementCommon {
  /** Stable within one answer; the viewer keys accept/reject on it. */
  id: string;
  itemId: string;
  itemTitle: string;
  itemLevel: string;
  /** The model's stated reason. Empty when it gave none. */
  rationale: string;
  /** Exactly the fields this proposal changes, in a fixed order. */
  diffs: RefinementDiff[];
  baseline: RefinementBaseline[];
}

/** Rewrite content on one existing item. */
export interface EditRefinement extends RefinementCommon {
  op: "edit";
  updates: {
    description?: string;
    acceptanceCriteria?: string[];
    priority?: string;
  };
}

/** Move one existing item under a different parent. */
export interface ReparentRefinement extends RefinementCommon {
  op: "reparent";
  /** Parent the item is expected to be under. `null` means the tree root. */
  fromParentId: string | null;
  toParentId: string;
}

/** Absorb this item into a duplicate sibling, which survives. */
export interface MergeRefinement extends RefinementCommon {
  op: "merge";
  intoId: string;
  intoTitle: string;
}

export type RefinementProposal = EditRefinement | ReparentRefinement | MergeRefinement;

export type RefinementOutcomeStatus = "applied" | "stale" | "invalid";

export interface RefinementOutcome {
  id: string;
  itemId: string;
  status: RefinementOutcomeStatus;
  /** Why it was refused. Present for everything except `applied`. */
  detail?: string;
}

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

/**
 * Content fingerprint of one item.
 *
 * Placement, status, tags, and timestamps are excluded — see the module
 * docblock. Written through a canonical JSON shape rather than a concatenation
 * so a description ending in the field separator cannot forge a match.
 */
export function itemFingerprint(item: PRDItem): string {
  const canonical = JSON.stringify({
    level: item.level,
    title: item.title,
    description: item.description ?? null,
    acceptanceCriteria: item.acceptanceCriteria ?? null,
    priority: item.priority ?? null,
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, FINGERPRINT_CHARS);
}

// ---------------------------------------------------------------------------
// Prompt context
// ---------------------------------------------------------------------------

function truncate(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

/** Parent id of `entry`, or null when it sits at the tree root. */
function parentIdOf(entry: { parents: PRDItem[] }): string | null {
  return entry.parents.length > 0 ? entry.parents[entry.parents.length - 1].id : null;
}

/**
 * Render the PRD as prompt context.
 *
 * Ids are rendered verbatim and the model is told to reuse them, because the
 * alternative — matching a proposal back to an item by title — silently edits
 * the wrong item whenever two siblings are near-duplicates, which is exactly
 * the situation a merge proposal arises in.
 */
export function renderPrdContext(doc: PRDDocument): string[] {
  const entries = [...walkTree(doc.items)];
  if (entries.length === 0) return [];

  const shown = entries.slice(0, MAX_PRD_ITEMS);
  const lines = [
    "## Current PRD",
    "",
    `Title: ${doc.title}`,
    `Items: ${entries.length}`,
    "",
  ];

  for (const entry of shown) {
    const item = entry.item;
    const facts = [item.level, item.status, item.priority ? `priority ${item.priority}` : null]
      .filter(Boolean)
      .join(", ");
    lines.push(`- \`${item.id}\` (${facts}) — ${truncate(item.title, MAX_ITEM_PROSE_CHARS)}`);
    const parentId = parentIdOf(entry);
    lines.push(`  - parent: ${parentId ? `\`${parentId}\`` : "(top level)"}`);
    if (item.description) {
      lines.push(`  - description: ${truncate(item.description, MAX_ITEM_PROSE_CHARS)}`);
    }
    const criteria = item.acceptanceCriteria ?? [];
    if (criteria.length > 0) {
      lines.push("  - acceptance criteria:");
      for (const criterion of criteria.slice(0, MAX_ITEM_CRITERIA)) {
        lines.push(`    - ${truncate(criterion, MAX_ITEM_PROSE_CHARS)}`);
      }
      if (criteria.length > MAX_ITEM_CRITERIA) {
        lines.push(`    - _(${criteria.length - MAX_ITEM_CRITERIA} further criteria omitted)_`);
      }
    }
  }

  if (entries.length > shown.length) {
    lines.push(
      "",
      `_(${entries.length - shown.length} further PRD items omitted from this context. `
      + "Do not propose merging or reparenting on the assumption that the list above is complete.)_",
    );
  }
  return lines;
}

/**
 * Extra prompt rules for refine mode.
 *
 * The block is asked for *after* the prose rather than instead of it: the user
 * reviews the reasoning and the diffs together, and an answer that is only
 * machine output gives them nothing to judge the diffs against.
 */
export const REFINE_RULES: string[] = [
  "- The user is asking you to improve the PRD itself, not only to describe the code.",
  "  The PRD is listed under 'Current PRD' with each item's id, level, parent, priority,",
  "  description, and acceptance criteria.",
  "- Answer in prose first: say what is wrong with the items you are about to change,",
  "  naming them by title, so the user can judge the changes against your reasoning.",
  "- Then, ONLY if you are proposing concrete changes, end the reply with one fenced block:",
  "",
  `  \`\`\`${REFINEMENT_FENCE_TAG}`,
  '  [{"op":"edit","itemId":"<id>","description":"...","acceptanceCriteria":["..."],',
  '    "priority":"high","rationale":"why this change"}]',
  "  ```",
  "",
  "- Allowed ops, and nothing else:",
  "  - `edit` — set any of `description`, `acceptanceCriteria`, `priority` on `itemId`.",
  "  - `reparent` — move `itemId` under `parentId`.",
  "  - `merge` — absorb `itemId` into `intoId`, a duplicate sibling at the same level.",
  "- Use the ids exactly as listed above. Never invent an id, and never propose creating",
  "  a new item here — capture is a separate action the user takes on the answer itself.",
  "- Include only the fields you are actually changing. A field you repeat unchanged is",
  "  dropped, and a proposal that changes nothing is dropped with it.",
  `- Propose at most ${MAX_REFINEMENT_PROPOSALS} changes, each one you can justify from the PRD text or the analysis.`,
];

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Raw shape accepted from the model.
 *
 * Unknown keys are stripped rather than refused: this is model output, not a
 * client we control, and refusing the whole batch because it added a
 * `confidence` field would throw away work the user asked for.
 */
const RawRefinementSchema = z.object({
  op: z.enum(["edit", "reparent", "merge"]),
  itemId: z.string().trim().min(1),
  rationale: z.string().trim().optional(),
  description: z.string().optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  priority: z.string().trim().optional(),
  parentId: z.string().trim().optional(),
  intoId: z.string().trim().optional(),
});

type RawRefinement = z.infer<typeof RawRefinementSchema>;

/** Matches the model's proposal block and captures its body. */
const FENCE_PATTERN = new RegExp(
  "```[^\\n]*\\b" + REFINEMENT_FENCE_TAG + "\\b[^\\n]*\\n([\\s\\S]*?)```",
  "g",
);

/**
 * Split the answer into the prose the user reads and the raw proposal block.
 *
 * The block is removed from the prose because it is rendered as diffs directly
 * below; leaving the JSON in the answer would show every change twice, once in
 * a form nobody reviews.
 */
export function splitRefinementBlock(answer: string): { prose: string; block: string | null } {
  FENCE_PATTERN.lastIndex = 0;
  const matches = [...answer.matchAll(FENCE_PATTERN)];
  if (matches.length === 0) return { prose: answer, block: null };
  // The last block wins: a model that restates its output takes the final word,
  // which is the one its prose is written against.
  const chosen = matches[matches.length - 1];
  const prose = matches.reduce((text, match) => text.replace(match[0], ""), answer).trim();
  return { prose, block: chosen[1] };
}

/** Render a scalar field as diff lines — an absent value is an empty list. */
function scalarLines(value: string | undefined | null): string[] {
  return value != null && value.trim().length > 0 ? [value] : [];
}

/**
 * Reasons a proposal cannot be applied to `doc`, or null when it can.
 *
 * Shared by parse time and apply time on purpose: a proposal that was legal
 * when the answer was written can become illegal before it is accepted (its
 * new parent deleted, its merge sibling moved away), and re-running the same
 * checks under the lock is what catches that.
 */
function validateAgainst(doc: PRDDocument, proposal: RefinementProposal): string | null {
  const entry = findItem(doc.items, proposal.itemId);
  if (!entry) return `Item "${proposal.itemId}" is no longer in the PRD.`;

  if (proposal.op === "reparent") {
    const target = findItem(doc.items, proposal.toParentId);
    if (!target) return `Parent "${proposal.toParentId}" is no longer in the PRD.`;
    if (proposal.toParentId === proposal.itemId) return "An item cannot be its own parent.";
    // A move into the item's own subtree would detach that subtree from the
    // tree entirely — the item is removed, then inserted under a node that is
    // no longer reachable.
    for (const descendant of walkTree(entry.item.children ?? [])) {
      if (descendant.item.id === proposal.toParentId) {
        return "An item cannot be moved under one of its own descendants.";
      }
    }
    const allowed = (LEVEL_HIERARCHY[entry.item.level as ItemLevel] ?? [])
      .filter((level): level is ItemLevel => level !== null);
    if (!allowed.includes(target.item.level as ItemLevel)) {
      return `A ${entry.item.level} cannot sit under a ${target.item.level}.`;
    }
    if (parentIdOf(entry) === proposal.toParentId) {
      return "The item is already under that parent.";
    }
    return null;
  }

  if (proposal.op === "merge") {
    const check = validateMerge(doc.items, [proposal.itemId, proposal.intoId], proposal.intoId);
    if (!check.valid) return check.error ?? "The two items cannot be merged.";
    return null;
  }

  const updates = proposal.updates;
  if (Object.keys(updates).length === 0) return "The proposal changes nothing.";
  if (updates.priority !== undefined && !isPriority(updates.priority)) {
    return `"${updates.priority}" is not a valid priority.`;
  }
  return null;
}

/** Build the diffs and baseline for an `edit`, or null when nothing changes. */
function buildEdit(
  doc: PRDDocument,
  raw: RawRefinement,
  id: string,
): { proposal: EditRefinement } | { note: string } {
  const entry = findItem(doc.items, raw.itemId);
  if (!entry) return { note: `Skipped a change to unknown item "${raw.itemId}".` };
  const item = entry.item;

  const updates: EditRefinement["updates"] = {};
  const diffs: RefinementDiff[] = [];

  if (raw.description !== undefined) {
    const after = raw.description.trim();
    if (after.length > 0 && after !== (item.description ?? "").trim()) {
      updates.description = after;
      diffs.push({
        field: "description",
        before: scalarLines(item.description),
        after: [after],
      });
    }
  }

  if (raw.acceptanceCriteria !== undefined) {
    const after = raw.acceptanceCriteria
      .map((criterion) => criterion.trim())
      .filter((criterion) => criterion.length > 0);
    const before = item.acceptanceCriteria ?? [];
    if (after.length > 0 && JSON.stringify(after) !== JSON.stringify(before)) {
      updates.acceptanceCriteria = after;
      diffs.push({ field: "acceptanceCriteria", before: [...before], after });
    }
  }

  if (raw.priority !== undefined) {
    const after = raw.priority.trim();
    if (!isPriority(after)) {
      return { note: `Skipped "${item.title}": "${after}" is not a valid priority.` };
    }
    if (after !== item.priority) {
      updates.priority = after;
      diffs.push({ field: "priority", before: scalarLines(item.priority), after: [after] });
    }
  }

  if (diffs.length === 0) {
    return { note: `Skipped "${item.title}": the proposed values match what is already there.` };
  }

  return {
    proposal: {
      op: "edit",
      id,
      itemId: item.id,
      itemTitle: item.title,
      itemLevel: item.level,
      rationale: truncate(raw.rationale ?? "", MAX_RATIONALE_CHARS),
      updates,
      diffs,
      baseline: [{ itemId: item.id, fingerprint: itemFingerprint(item) }],
    },
  };
}

function buildReparent(
  doc: PRDDocument,
  raw: RawRefinement,
  id: string,
): { proposal: ReparentRefinement } | { note: string } {
  const entry = findItem(doc.items, raw.itemId);
  if (!entry) return { note: `Skipped a move of unknown item "${raw.itemId}".` };
  if (!raw.parentId) return { note: `Skipped a move of "${entry.item.title}": no parentId given.` };

  const fromParentId = parentIdOf(entry);
  const target = findItem(doc.items, raw.parentId);
  const proposal: ReparentRefinement = {
    op: "reparent",
    id,
    itemId: entry.item.id,
    itemTitle: entry.item.title,
    itemLevel: entry.item.level,
    rationale: truncate(raw.rationale ?? "", MAX_RATIONALE_CHARS),
    fromParentId,
    toParentId: raw.parentId,
    diffs: [{
      field: "parent",
      before: fromParentId
        ? [entry.parents[entry.parents.length - 1].title]
        : ["(top level)"],
      after: [target ? target.item.title : raw.parentId],
    }],
    baseline: [{ itemId: entry.item.id, fingerprint: itemFingerprint(entry.item) }],
  };

  const problem = validateAgainst(doc, proposal);
  if (problem) return { note: `Skipped a move of "${entry.item.title}": ${problem}` };
  return { proposal };
}

/**
 * Build a merge proposal.
 *
 * The diff is on the item that *survives*, because that is where the change
 * lands: the absorbed item's fields are combined into the target's. Its
 * before/after come from `previewMerge` rather than from a second
 * implementation of the same combination rules.
 */
function buildMerge(
  doc: PRDDocument,
  raw: RawRefinement,
  id: string,
): { proposal: MergeRefinement } | { note: string } {
  const entry = findItem(doc.items, raw.itemId);
  if (!entry) return { note: `Skipped a merge of unknown item "${raw.itemId}".` };
  if (!raw.intoId) return { note: `Skipped a merge of "${entry.item.title}": no intoId given.` };
  const target = findItem(doc.items, raw.intoId);
  if (!target) return { note: `Skipped a merge of "${entry.item.title}": unknown target "${raw.intoId}".` };

  const check = validateMerge(doc.items, [raw.itemId, raw.intoId], raw.intoId);
  if (!check.valid) {
    return { note: `Skipped a merge of "${entry.item.title}": ${check.error ?? "not mergeable"}` };
  }

  const preview = previewMerge(doc.items, [raw.itemId, raw.intoId], raw.intoId);
  const diffs: RefinementDiff[] = [];
  const beforeDescription = scalarLines(target.item.description);
  const afterDescription = scalarLines(preview.target.description);
  if (JSON.stringify(beforeDescription) !== JSON.stringify(afterDescription)) {
    diffs.push({ field: "description", before: beforeDescription, after: afterDescription });
  }
  const beforeCriteria = target.item.acceptanceCriteria ?? [];
  if (JSON.stringify(beforeCriteria) !== JSON.stringify(preview.target.acceptanceCriteria)) {
    diffs.push({
      field: "acceptanceCriteria",
      before: [...beforeCriteria],
      after: [...preview.target.acceptanceCriteria],
    });
  }

  return {
    proposal: {
      op: "merge",
      id,
      itemId: entry.item.id,
      itemTitle: entry.item.title,
      itemLevel: entry.item.level,
      rationale: truncate(raw.rationale ?? "", MAX_RATIONALE_CHARS),
      intoId: target.item.id,
      intoTitle: target.item.title,
      diffs,
      // Both items matter: the merge combines their content, so a change to
      // either one means the combination the user reviewed is not the
      // combination that would be written.
      baseline: [
        { itemId: entry.item.id, fingerprint: itemFingerprint(entry.item) },
        { itemId: target.item.id, fingerprint: itemFingerprint(target.item) },
      ],
    },
  };
}

export interface ParsedRefinements {
  /** The answer with the proposal block removed. */
  prose: string;
  proposals: RefinementProposal[];
  /**
   * Human-readable reasons for entries that were dropped.
   *
   * Reported rather than swallowed: a model that proposed five changes and had
   * two silently discarded leaves the user believing it only found three.
   */
  notes: string[];
}

/**
 * Read an answer into prose plus reviewable proposals.
 *
 * `doc` must be the document the answer was generated against — every `before`
 * value and every fingerprint is read out of it.
 */
export function parseAnswerRefinements(answer: string, doc: PRDDocument): ParsedRefinements {
  const { prose, block } = splitRefinementBlock(answer);
  if (block === null) return { prose, proposals: [], notes: [] };

  let raw: unknown;
  try {
    raw = JSON.parse(block);
  } catch {
    return {
      prose,
      proposals: [],
      notes: ["The model's proposal block was not valid JSON, so no changes were offered."],
    };
  }

  const entries = Array.isArray(raw) ? raw : [raw];
  const proposals: RefinementProposal[] = [];
  const notes: string[] = [];

  for (const entry of entries) {
    if (proposals.length >= MAX_REFINEMENT_PROPOSALS) {
      notes.push(
        `Only the first ${MAX_REFINEMENT_PROPOSALS} proposals are shown; the rest were dropped.`,
      );
      break;
    }
    const validated = RawRefinementSchema.safeParse(entry);
    if (!validated.success) {
      notes.push("Skipped a proposal the server could not read.");
      continue;
    }
    const id = `r${proposals.length + 1}`;
    const built = validated.data.op === "edit"
      ? buildEdit(doc, validated.data, id)
      : validated.data.op === "reparent"
        ? buildReparent(doc, validated.data, id)
        : buildMerge(doc, validated.data, id);

    if ("note" in built) notes.push(built.note);
    else proposals.push(built.proposal);
  }

  return { prose, proposals, notes };
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

/** True when every fingerprint in `baseline` still matches the document. */
function baselineHolds(doc: PRDDocument, baseline: RefinementBaseline[]): string | null {
  for (const expected of baseline) {
    const entry = findItem(doc.items, expected.itemId);
    if (!entry) return `Item "${expected.itemId}" is no longer in the PRD.`;
    if (itemFingerprint(entry.item) !== expected.fingerprint) {
      return `"${entry.item.title}" has changed since this proposal was generated.`;
    }
  }
  return null;
}

/**
 * Has a reparent's subject already been moved out from under the parent the
 * proposal expects? Returns the reason, or null.
 *
 * Not covered by the fingerprint: a move changes no content, so an item another
 * writer relocated fingerprints identically to the one the user reviewed.
 */
function reparentPlacementStale(doc: PRDDocument, proposal: RefinementProposal): string | null {
  if (proposal.op !== "reparent") return null;
  const entry = findItem(doc.items, proposal.itemId);
  if (!entry) return null; // Absence is the baseline check's to report.
  if (parentIdOf(entry) === proposal.fromParentId) return null;
  return `"${proposal.itemTitle}" has already been moved by someone else.`;
}

/**
 * Apply accepted proposals to `doc` in order, reporting each one's outcome.
 *
 * Pure with respect to the filesystem — it mutates the document it is given and
 * writes nothing. The caller runs it inside `store.withTransaction`, which is
 * what makes the fingerprint check meaningful: the document was loaded under
 * the same lock that will write it back, so nothing can change in between.
 *
 * A refused proposal does not abort the batch. Each one was accepted
 * individually by the user, so one going stale is not a reason to discard the
 * others — the response reports which landed and which did not.
 */
export function applyRefinements(
  doc: PRDDocument,
  proposals: RefinementProposal[],
): RefinementOutcome[] {
  const outcomes: RefinementOutcome[] = [];

  for (const proposal of proposals) {
    const stale = baselineHolds(doc, proposal.baseline)
      // Placement staleness is checked here, before validity, because the two
      // are indistinguishable to `validateAgainst`: an item another writer has
      // already moved to the proposed parent reads as "already under that
      // parent", which is a true statement and the wrong report. The user needs
      // to know their move did not happen *because someone else did it*, not
      // that their proposal was malformed.
      ?? reparentPlacementStale(doc, proposal);
    if (stale) {
      outcomes.push({ id: proposal.id, itemId: proposal.itemId, status: "stale", detail: stale });
      continue;
    }

    // Re-checked against the freshly-loaded document, not trusted from parse
    // time: a parent or merge sibling may have moved since.
    const problem = validateAgainst(doc, proposal);
    if (problem) {
      outcomes.push({ id: proposal.id, itemId: proposal.itemId, status: "invalid", detail: problem });
      continue;
    }

    if (proposal.op === "edit") {
      updateInTree(doc.items, proposal.itemId, { ...proposal.updates } as Partial<PRDItem>);
      outcomes.push({ id: proposal.id, itemId: proposal.itemId, status: "applied" });
      continue;
    }

    if (proposal.op === "reparent") {
      const removed = removeFromTree(doc.items, proposal.itemId);
      if (!removed) {
        outcomes.push({
          id: proposal.id,
          itemId: proposal.itemId,
          status: "invalid",
          detail: `Item "${proposal.itemId}" could not be detached.`,
        });
        continue;
      }
      if (!insertChild(doc.items, proposal.toParentId, removed)) {
        // Put it back rather than leaving the tree short one item. The
        // hierarchy check in validateAgainst should make this unreachable;
        // losing an item if it is not would be far worse than a failed move.
        if (proposal.fromParentId) insertChild(doc.items, proposal.fromParentId, removed);
        else doc.items.push(removed);
        outcomes.push({
          id: proposal.id,
          itemId: proposal.itemId,
          status: "invalid",
          detail: `"${proposal.itemTitle}" could not be placed under its new parent.`,
        });
        continue;
      }
      outcomes.push({ id: proposal.id, itemId: proposal.itemId, status: "applied" });
      continue;
    }

    mergeItems(doc.items, [proposal.itemId, proposal.intoId], proposal.intoId);
    outcomes.push({ id: proposal.id, itemId: proposal.itemId, status: "applied" });
  }

  return outcomes;
}

/** One-line description of a proposal, for the execution log. */
export function describeRefinement(proposal: RefinementProposal): string {
  switch (proposal.op) {
    case "edit":
      return `edited ${proposal.diffs.map((d) => d.field).join(", ")} on "${proposal.itemTitle}"`;
    case "reparent":
      return `moved "${proposal.itemTitle}" under "${proposal.toParentId}"`;
    default:
      return `merged "${proposal.itemTitle}" into "${proposal.intoTitle}"`;
  }
}
