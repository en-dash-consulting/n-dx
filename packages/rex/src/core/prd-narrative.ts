/**
 * Narrative PRD rendering — the PRD as a business owner would write it.
 *
 * ## What this is for
 *
 * The folder tree and the JSON bundle both speak the tracker's language: ids,
 * slugs, `status: pending`, `blockedBy: [uuid]`. None of that belongs in a
 * document handed to someone who is deciding whether to fund the work. This
 * module renders the same items as prose — sections with goals, capabilities
 * described in plain language, and "how we'll know it's done" lists.
 *
 * ## One-way by design
 *
 * Nothing here is reversible and nothing should try to make it so. Ids are
 * dropped rather than encoded, statuses are paraphrased rather than mapped
 * one-to-one (`cancelled` and `deleted` share a phrase), and filtered items
 * leave no trace. The round-trip surface is the JSON bundle in
 * {@link module:rex/core/prd-bundle} — a narrative document is a *report*.
 *
 * ## Why the enum-to-prose maps avoid their own keys
 *
 * Every phrase below is chosen so the enum literal itself never appears in the
 * output: `in_progress` renders as "Under way now", not "In progress";
 * `high` renders as "Should-have", not "High priority". That is not fussiness
 * — it is what makes the guarantee testable. A single regex sweep for the enum
 * literals proves no internal vocabulary leaked, and it only works if the
 * prose is disjoint from the vocabulary it replaces.
 *
 * @module rex/core/prd-narrative
 */

import type { PRDDocument, PRDItem, ItemStatus, Priority } from "../schema/index.js";
import { walkTree, findItem } from "./tree.js";

const UUID_SOURCE = String.raw`\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b`;

/** Matches every uuid in a passage, so ids can be scrubbed from free text. */
const UUID_PATTERN = new RegExp(UUID_SOURCE, "gi");

/** The same pattern without `g`, so a presence check cannot carry `lastIndex` between calls. */
const HAS_UUID = new RegExp(UUID_SOURCE, "i");

/** Deepest heading Markdown defines. Beyond this, depth stops increasing. */
const MAX_HEADING_DEPTH = 6;

/**
 * Statuses hidden unless asked for.
 *
 * `deleted` is absent from the toggle deliberately — it is a tombstone, and no
 * flag should surface one in a stakeholder document. See
 * {@link NarrativeOptions.includeCompleted}.
 */
const ALWAYS_HIDDEN: ReadonlySet<ItemStatus> = new Set<ItemStatus>(["deleted"]);

/** Hidden by default, revealed by `includeCompleted`. */
const HIDDEN_UNLESS_RETROSPECTIVE: ReadonlySet<ItemStatus> = new Set<ItemStatus>(["completed"]);

/**
 * How each status reads to a reader who has never seen the tracker.
 *
 * `pending` maps to nothing on purpose: "not started yet" is the default a
 * reader already assumes for a plan, so saying it on every item is noise.
 */
const STATUS_PROSE: Record<ItemStatus, string | null> = {
  pending: null,
  in_progress: "Under way now.",
  completed: "Delivered.",
  failing: "Needs another attempt — an earlier run did not land it.",
  deferred: "Parked for a later cycle.",
  blocked: "Not started yet — it is waiting on earlier work.",
  cancelled: "Dropped from scope.",
  deleted: "Dropped from scope.",
};

/**
 * How each priority reads as a commitment rather than a label.
 *
 * `medium` maps to nothing: it is the default every item lands on, so
 * announcing it says less than silence does.
 */
const PRIORITY_PROSE: Record<Priority, string | null> = {
  critical: "Must-have.",
  high: "Should-have.",
  medium: null,
  low: "Nice-to-have.",
};

export interface NarrativeOptions {
  /**
   * Render only this item's subtree, with the item itself as the document
   * heading. Must be an item id — resolve ids, titles and slugs before calling.
   *
   * @throws {Error} If no item in the document carries the id.
   */
  rootId?: string;
  /**
   * Include finished work, for a retrospective-style document. Deleted items
   * stay hidden regardless.
   */
  includeCompleted?: boolean;
}

export interface NarrativeResult {
  /** The rendered document. */
  markdown: string;
  /** How many PRD items the document actually describes. */
  items: number;
}

// ── Text helpers ─────────────────────────────────────────────────────────────

/**
 * Replace uuids in free text with the title they refer to, or remove them.
 *
 * An id that resolves becomes a quoted title, which is what the author meant
 * when they pasted it. An id that resolves to nothing is deleted outright
 * rather than left in place: a dangling uuid is meaningless to the reader and
 * would breach the no-ids guarantee for the sake of preserving a typo. The
 * tidy-up afterwards clears the punctuation the deletion strands — most often
 * a now-empty `(...)`.
 *
 * A title already named in the same passage is *not* substituted back in. The
 * dominant way an author writes an id is right after the thing it identifies —
 * `the "Markdown-Only Enforcement" feature (a1b2c3d4-…)` — and expanding the
 * id there produces a stutter. Dropping the parenthetical instead leaves
 * exactly the sentence the author would have written for a reader who does not
 * have a tracker open.
 *
 * Note the scope of the guarantee: this removes ids *the renderer would
 * otherwise emit*. It does not police the author's own words — a description
 * that spells out a status code in prose keeps it, because rewriting someone's
 * argument to satisfy a vocabulary rule would do more damage than the leak.
 */
function scrubIds(text: string, titles: ReadonlyMap<string, string>): string {
  // Nothing to remove means nothing to tidy. Running the clean-up anyway is
  // not free: its rules assume a gap where an id used to be, and on untouched
  // prose they misfire — closing the deliberate space in `tree at
  // .rex/prd_tree/`, or in an ellipsis the author wrote.
  if (!HAS_UUID.test(text)) return text.trim();

  const replaced = text.replace(UUID_PATTERN, (id) => {
    const title = titles.get(id.toLowerCase());
    if (!title) return "";
    return text.includes(title) ? "" : `“${title}”`;
  });

  return (
    replaced
      // Brackets emptied by a removed id, plus the space that led into them.
      .replace(/[^\S\n]*\(\s*\)/g, "")
      .replace(/[^\S\n]*\[\s*\]/g, "")
      // Runs of spaces left mid-sentence — newlines are preserved, since
      // paragraph breaks carry meaning in the rendered document.
      .replace(/[^\S\n]{2,}/g, " ")
      // A space stranded before punctuation, but only where the punctuation
      // ends a clause. A dot that leads into more text is part of a path or a
      // filename, and the space in front of it is the author's.
      .replace(/[^\S\n]+([.,;:!?])(?=\s|$)/g, "$1")
      .trim()
  );
}

/**
 * Split prose into its opening sentence and everything after it.
 *
 * This is how an epic gets a goal and a rationale without inventing either:
 * business writing already puts the goal first and the reasoning after, so the
 * first sentence is the goal and the remainder is why it matters. A
 * single-sentence description yields a goal and no rationale, which is
 * honest — better than padding the section with generated filler.
 */
function splitLead(text: string): { lead: string; rest: string } {
  const match = /^([\s\S]*?[.!?])(?:\s+)([\s\S]*\S)$/.exec(text.trim());
  if (!match) return { lead: text.trim(), rest: "" };
  return { lead: match[1].trim(), rest: match[2].trim() };
}

/**
 * Turn an acceptance criterion into a sentence a reader can read aloud.
 *
 * Criteria are written as fragments ("cards are stored against the account"),
 * so they get a capital and a full stop. The capital is only applied when the
 * criterion opens with a lowercase letter — one opening with a backticked
 * command or an identifier is left exactly as written, because capitalising
 * `POST /cards` would falsify it.
 */
function asSentence(criterion: string): string {
  const stripped = criterion.trim().replace(/^(?:[-*+]|\d+[.)])\s+/, "");
  if (stripped === "") return "";

  const capitalised = /^[a-z]/.test(stripped)
    ? stripped[0].toUpperCase() + stripped.slice(1)
    : stripped;

  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}

/** Join titles the way a person would: "A", "A and B", "A, B and C". */
function listPhrase(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// ── Rendering ────────────────────────────────────────────────────────────────

/** Every item id in the document, mapped to its title, for dependency prose and id scrubbing. */
function titleIndex(items: PRDItem[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const { item } of walkTree(items)) index.set(item.id.toLowerCase(), item.title);
  return index;
}

/** A rendered item plus the children that survived filtering. */
interface Node {
  item: PRDItem;
  children: Node[];
  /**
   * False when the item was kept only because a descendant survived.
   *
   * A finished epic holding unfinished features still has to appear, or its
   * children lose the section that gives them context. It appears as a
   * container: heading and goal only, with no state, priority or criteria —
   * so retaining the structure never smuggles back the item the filter
   * excluded.
   */
  own: boolean;
}

function select(items: PRDItem[], includeCompleted: boolean): Node[] {
  const nodes: Node[] = [];

  for (const item of items) {
    if (ALWAYS_HIDDEN.has(item.status)) continue;

    const own = includeCompleted || !HIDDEN_UNLESS_RETROSPECTIVE.has(item.status);
    const children = select(item.children ?? [], includeCompleted);
    if (!own && children.length === 0) continue;

    nodes.push({ item, children, own });
  }

  return nodes;
}

function countNodes(nodes: Node[]): number {
  return nodes.reduce((total, node) => total + 1 + countNodes(node.children), 0);
}

/** The one-line qualifier that opens an item's state: priority, progress, sequencing. */
function qualifiers(item: PRDItem, titles: ReadonlyMap<string, string>): string {
  const parts: string[] = [];

  const priority = item.priority ? PRIORITY_PROSE[item.priority] : null;
  if (priority) parts.push(priority);

  const blockers = (item.blockedBy ?? [])
    .map((id) => titles.get(id.toLowerCase()))
    .filter((title): title is string => title !== undefined)
    .map((title) => `“${scrubIds(title, titles)}”`);

  const sequencing =
    blockers.length > 0 ? `This follows on from ${listPhrase(blockers)}.` : null;

  // With sequencing prose present, "it is waiting on earlier work" would say
  // the same thing twice and less precisely.
  const status = STATUS_PROSE[item.status];
  if (status && !(sequencing && item.status === "blocked")) parts.push(status);

  if (sequencing) parts.push(sequencing);

  return parts.join(" ");
}

function renderBody(node: Node, titles: ReadonlyMap<string, string>): string[] {
  const blocks: string[] = [];
  const description = node.item.description?.trim();

  if (description) {
    const prose = scrubIds(description, titles);
    if (node.item.level === "epic") {
      // Epics carry the argument for the work, so they get the goal/rationale
      // shape a stakeholder document opens a section with.
      const { lead, rest } = splitLead(prose);
      if (lead) blocks.push(`**Goal.** ${lead}`);
      if (rest) blocks.push(`**Why it matters.** ${rest}`);
    } else {
      blocks.push(prose);
    }
  }

  if (!node.own) return blocks;

  const qualifier = qualifiers(node.item, titles);
  if (qualifier) blocks.push(qualifier);

  const criteria = (node.item.acceptanceCriteria ?? [])
    .map((criterion) => asSentence(scrubIds(criterion, titles)))
    .filter((sentence) => sentence !== "");

  if (criteria.length > 0) {
    blocks.push("**How we'll know it's done**");
    blocks.push(criteria.map((sentence) => `- ${sentence}`).join("\n"));
  }

  return blocks;
}

function renderNodes(
  nodes: Node[],
  depth: number,
  titles: ReadonlyMap<string, string>,
): string[] {
  const blocks: string[] = [];

  for (const node of nodes) {
    const hashes = "#".repeat(Math.min(depth, MAX_HEADING_DEPTH));
    blocks.push(`${hashes} ${scrubIds(node.item.title, titles)}`);
    blocks.push(...renderBody(node, titles));
    blocks.push(...renderNodes(node.children, depth + 1, titles));
  }

  return blocks;
}

/**
 * Render a PRD as a prose document for a non-technical reader.
 *
 * The output is deliberately one-way: see the module docblock. Use
 * `rex export` (the JSON bundle) when the document has to come back.
 */
export function renderNarrative(
  doc: PRDDocument,
  options: NarrativeOptions = {},
): NarrativeResult {
  const includeCompleted = options.includeCompleted === true;
  // Built from the whole document, never the scoped subtree: a task inside the
  // scope can depend on one outside it, and the reader is owed the title.
  const titles = titleIndex(doc.items);

  // Scoping promotes the chosen item to the document heading, so its own prose
  // becomes the lead and its children become the top-level sections. Both
  // modes therefore start their sections at depth 2.
  let heading = doc.title;
  let lead: Node | null = null;
  let nodes: Node[];

  if (options.rootId !== undefined) {
    const entry = findItem(doc.items, options.rootId);
    if (!entry) throw new Error(`No PRD item with id "${options.rootId}".`);
    heading = entry.item.title;
    lead = select([entry.item], includeCompleted)[0] ?? null;
    nodes = lead ? lead.children : [];
  } else {
    nodes = select(doc.items, includeCompleted);
  }

  const blocks: string[] = [`# ${scrubIds(heading, titles)}`];

  if (lead) blocks.push(...renderBody(lead, titles));

  if (nodes.length === 0 && !lead) {
    blocks.push(
      includeCompleted
        ? "No work is recorded for this project yet."
        : "No open work is recorded for this project — everything on the plan is finished.",
    );
  }

  blocks.push(...renderNodes(nodes, 2, titles));

  const items = countNodes(nodes) + (lead ? 1 : 0);

  return { markdown: `${blocks.filter((block) => block !== "").join("\n\n")}\n`, items };
}
