/**
 * The agent brief for one unit of work, built from the change and the product
 * nodes it affects. Pure: everything here is derived from the loaded tree and
 * the values the caller passes in, and nothing is written.
 *
 * The v1 brief led with a release title and the item's parent chain. This one
 * leads with the *product*: what the change says it will do to the map, and
 * what the capabilities it touches currently promise. An agent that knows the
 * capability's criteria and the constraints binding it can tell whether its
 * change is finished; one that knows only the task title cannot.
 *
 * ## Sections
 *
 * Rendered in the order of {@link BRIEF_SECTIONS}: task, siblings, change,
 * capabilities, constraints, depends-on neighbours, realized-by paths, the last
 * three changes to those nodes, then commands, workflow and log.
 *
 * ## Budget
 *
 * One measured budget ({@link BRIEF_TOKEN_BUDGET}) over the whole brief, not a
 * cap per section. Sections are admitted in {@link RETENTION_ORDER} until the
 * budget is spent, so capabilities and constraints survive a crowded brief
 * while the tail (realized-by paths, recent changes, workflow, log) goes first.
 * `task` and `change` are never dropped — a brief without the work is not a
 * shorter brief, it is a useless one — so a single enormous change can still
 * come in over budget, which `overBudget` reports rather than hides.
 *
 * A list section that does not fit is **trimmed, not dropped**. Thirty
 * capabilities whose text outruns the whole budget must not cost the brief its
 * capabilities section, which is the one thing the budget is supposed to
 * protect; it lists as many as fit and says how many it left out. Only an
 * atomic section (workflow, commands) is all-or-nothing, and only a section
 * whose header alone will not fit is dropped entirely — a lone heading over
 * nothing is worse than no heading.
 *
 * Every trim says what it dropped, inline and in the closing note. A brief that
 * silently omits a constraint is worse than a long one: the agent cannot tell
 * an absent constraint from one that does not exist.
 *
 * ## One brief for every vendor
 *
 * Nothing here takes a vendor, a model or a provider. {@link renderChangeBrief}
 * and {@link changeBriefSections} are two views of one render — the sections
 * joined are the flat text, byte for byte — so a CLI run and an API run send
 * the same brief whichever entry point their loop uses.
 *
 * ## Terminology
 *
 * A capability's `criteria` are "capability criteria"; a work item's
 * `acceptanceCriteria` are "done when". The two are different things — the
 * first is a standing promise the product makes, the second is the exit
 * condition of one piece of work — and the brief never calls either
 * "acceptance criteria", which read as the same thing and did.
 *
 * @module rex/core/change-brief
 */

import { estimateTokens } from "@n-dx/llm-client";
import {
  indexTree,
  nodeSpec,
  specHash,
  type RuleNode,
  type TreeIndex,
  type V2Tree,
} from "../schema/v2-rules.js";
import type { Amendment, ChangeNode, CapabilityNode, ConstraintNode, Criterion } from "../schema/v2.js";
import type { Requirement } from "../schema/v1.js";
import { computeEdges, deriveChangeKind, productIndex, type Realization } from "./product-edges.js";
import { computeProductStatus, type ProductStatus } from "./product-status.js";
import type { WorkUnit } from "./change-selection.js";

// ── Budget and caps ──────────────────────────────────────────────

/**
 * Tokens one brief may spend. Measured, not guessed: `estimateTokens` is the
 * same chars-per-token approximation the prompt budget preflight uses, so a
 * brief sized here and a prompt sized there agree.
 */
export const BRIEF_TOKEN_BUDGET = 4_000;

/** Capability criteria listed per capability, own and inherited together. */
const MAX_CRITERIA = 15;
/** Requirements listed per product node. */
const MAX_REQUIREMENTS = 8;
/** Acceptance criteria listed per requirement. */
const MAX_REQUIREMENT_CRITERIA = 4;
/** Sibling tasks listed. */
const MAX_SIBLINGS = 20;
/** Realized-by paths listed per capability. */
const MAX_FILES = 12;
/** Changes listed in the recent-changes section. The task's "last three". */
const MAX_RECENT_CHANGES = 3;
/** Log entries listed. */
const MAX_LOG = 10;
/** Characters of `workflow.md` embedded before it is trimmed. */
const MAX_WORKFLOW_CHARS = 4_000;
/**
 * Characters of a change's intent, and of one product node's statement,
 * inlined before they are trimmed.
 *
 * These bound a single entry, which is what keeps the budget's entry-wise trim
 * able to fit anything at all: without a bound, one capability with a
 * thousand-word statement is a single indivisible entry larger than the whole
 * brief, and the budget can only drop the section that the budget exists to
 * protect. Generous enough that a well-written node is never touched.
 */
const MAX_INTENT_CHARS = 1_500;
const MAX_STATEMENT_CHARS = 800;
/** Characters of one criterion, which is a sentence and is cut on one line. */
const MAX_CRITERION_CHARS = 300;

// ── Sections ─────────────────────────────────────────────────────

/** Every section a brief can carry, in the order they are rendered. */
export const BRIEF_SECTIONS = [
  "task",
  "siblings",
  "change",
  "capabilities",
  "constraints",
  "dependsOn",
  "realizedBy",
  "recentChanges",
  "commands",
  "workflow",
  "log",
] as const;

export type BriefSectionName = (typeof BRIEF_SECTIONS)[number];

/**
 * The order sections are admitted against the budget. The work comes first
 * because it is what the agent is being asked to do; capabilities and
 * constraints next because they are what tells it when it is done; the rest in
 * the order they are rendered.
 */
export const RETENTION_ORDER: readonly BriefSectionName[] = [
  "task",
  "change",
  "capabilities",
  "constraints",
  "siblings",
  "dependsOn",
  "commands",
  "realizedBy",
  "recentChanges",
  "workflow",
  "log",
];

/** Sections the budget never drops. */
const REQUIRED_SECTIONS: ReadonlySet<BriefSectionName> = new Set<BriefSectionName>(["task", "change"]);

/**
 * A rendered block's name: a section, or the `trimmed` note that names what the
 * budget dropped. The note is not a section — nothing renders it from the tree —
 * but it is part of the brief, so it travels with the sections.
 */
export type BriefBlockName = BriefSectionName | "trimmed";

export interface BriefSection {
  name: BriefBlockName;
  text: string;
  /** Estimated tokens this block costs, including the blank line joining it to the next. */
  tokens: number;
}

export interface ChangeBrief {
  /** The whole brief, ready to send. */
  text: string;
  /** The sections that survived the budget, in render order. Joined, they are `text`. */
  sections: BriefSection[];
  /** Sections dropped to fit the budget, in render order. */
  omitted: BriefSectionName[];
  /** Estimated tokens of `text`. */
  tokens: number;
  /** The budget this brief was measured against. */
  budgetTokens: number;
  /** True when the required sections alone exceed the budget. */
  overBudget: boolean;
}

// ── Input ────────────────────────────────────────────────────────

export interface BriefLogEntry {
  timestamp: string;
  event: string;
  detail?: string;
}

export interface BriefCommands {
  validate?: string;
  test?: string;
}

export interface ChangeBriefOptions {
  /** Both layers, as the store loaded them. */
  tree: V2Tree;
  /** The change or task this run executes ({@link findNextWork} or {@link resolveWorkById}). */
  unit: WorkUnit;
  /**
   * Realized-by paths per capability id, from `computeRealizedBy`. Omitted
   * skips the section: that computation reads git, and the brief stays pure so
   * it can be rendered and tested without a repository.
   */
  realizedBy?: Record<string, Realization>;
  /** The project's validate and test commands, from the rex config. */
  commands?: BriefCommands;
  /** `workflow.md`, embedded verbatim up to a character cap. */
  workflow?: string;
  /** Recent activity, newest last. */
  recentLog?: readonly BriefLogEntry[];
  /** Override the token budget. Defaults to {@link BRIEF_TOKEN_BUDGET}. */
  budgetTokens?: number;
}

// ── Build ────────────────────────────────────────────────────────

/**
 * Build the brief for one unit of work.
 *
 * @throws never — a unit whose change resolves to nothing still produces the
 *   task section, because refusing to brief is worse than briefing thinly.
 */
export function buildChangeBrief(options: ChangeBriefOptions): ChangeBrief {
  const budgetTokens = options.budgetTokens ?? BRIEF_TOKEN_BUDGET;
  const context = gather(options);

  const drafts = new Map<BriefSectionName, SectionDraft>();
  for (const name of BRIEF_SECTIONS) {
    const draft = renderSection(name, context);
    if (draft && (draft.head.trim() || draft.entries.length > 0)) drafts.set(name, draft);
  }

  // The closing note is part of the brief, so the budget pays for it up front
  // rather than letting it push a measured brief back over the line. Reserving
  // its worst case (every section named) keeps admission a single pass; it
  // costs a few dozen tokens of four thousand.
  const reserve = estimateTokens(trimNote(BRIEF_SECTIONS, budgetTokens).length + SECTION_GAP.length);
  const fitted = new Map<BriefSectionName, BriefSection>();
  let spent = 0;
  for (const name of RETENTION_ORDER) {
    const draft = drafts.get(name);
    if (!draft) continue;
    const required = REQUIRED_SECTIONS.has(name);
    const section = fitSection(draft, required ? Infinity : budgetTokens - reserve - spent);
    if (!section) continue;
    fitted.set(name, section);
    spent += section.tokens;
  }

  const omitted = BRIEF_SECTIONS.filter((name) => drafts.has(name) && !fitted.has(name));
  const sections = BRIEF_SECTIONS.filter((name) => fitted.has(name)).map((name) => fitted.get(name) as BriefSection);
  if (omitted.length > 0) {
    // Name what was dropped: an agent must be able to read a short brief as
    // trimmed rather than as the whole picture.
    const text = trimNote(omitted, budgetTokens);
    sections.push({ name: "trimmed", text, tokens: estimateTokens(text.length + SECTION_GAP.length) });
  }

  const text = sections.map((s) => s.text).join(SECTION_GAP);
  const tokens = estimateTokens(text.length);
  return { text, sections, omitted: [...omitted], tokens, budgetTokens, overBudget: tokens > budgetTokens };
}

/**
 * A section before the budget sees it: a header, and the entries under it that
 * may be trimmed one at a time. An atomic section has no entries and is taken
 * whole or not at all.
 */
/**
 * One entry of a list section, in both the forms the budget may use.
 *
 * `compact` is the entry reduced to its identity — a capability's title,
 * status and health, without statement, criteria or requirements. It exists so
 * a brief too tight for even one full capability still names the capabilities
 * the change affects: knowing *which* ones are in play and that their detail
 * was withheld is recoverable, and an agent that never learns they exist will
 * confidently finish work that breaks them. Entries that are already one line
 * use the same string for both.
 */
interface SectionEntry {
  full: string;
  compact: string;
}

interface SectionDraft {
  name: BriefSectionName;
  head: string;
  entries: SectionEntry[];
  /** Plural noun for the "N more … not shown" line. */
  noun: string;
  /**
   * Entries a static cap removed before the budget saw them. Counted into the
   * same trim line, so the brief reports one honest total rather than hiding
   * the capped ones behind the budgeted ones.
   */
  preDropped?: number;
}

/** What separates two entries within a section. */
const ENTRY_GAP = "\n";

/**
 * As much of a section as `allowance` affords: the header plus the entries that
 * fit, and a line naming the rest.
 *
 * Tries the full entries first. If not one of them fits, retries with the
 * compact forms rather than giving up, so a crowded brief loses detail before
 * it loses a section. `undefined` only when even the header, or the header plus
 * one compact entry, will not fit — a heading over nothing tells the agent less
 * than its absence does, because it reads as "there are none".
 */
function fitSection(draft: SectionDraft, allowance: number): BriefSection | undefined {
  return fitForm(draft, allowance, "full") ?? fitForm(draft, allowance, "compact");
}

function fitForm(draft: SectionDraft, allowance: number, form: keyof SectionEntry): BriefSection | undefined {
  const cost = (text: string): number => estimateTokens(text.length + SECTION_GAP.length);
  if (cost(draft.head) > allowance) return undefined;

  let taken = draft.entries.length;
  let assembled = assemble(draft, taken, form);
  // Drop from the tail until the whole section fits, the trim line included —
  // the line is short, but a section sized without it lands just over.
  while (taken > 0 && cost(assembled) > allowance) {
    taken -= 1;
    assembled = assemble(draft, taken, form);
  }
  if (draft.entries.length > 0 && taken === 0) return undefined;
  if (cost(assembled) > allowance) return undefined;
  return { name: draft.name, text: assembled, tokens: cost(assembled) };
}

function assemble(draft: SectionDraft, taken: number, form: keyof SectionEntry): string {
  const preDropped = draft.preDropped ?? 0;
  const dropped = draft.entries.length - taken + preDropped;
  const total = draft.entries.length + preDropped;
  const shown = draft.entries.slice(0, taken);
  const parts = [draft.head, ...shown.map((e) => e[form])];
  // Say that detail was withheld, not only that entries were: a compact list
  // otherwise reads as the full record of nodes that happen to carry no spec.
  if (form === "compact" && shown.some((e) => e.compact !== e.full)) {
    parts.push(`- _Listed without their detail to fit the budget. Read the nodes for statements, criteria and requirements._`);
  }
  if (dropped > 0) parts.push(`- … ${dropped} more ${draft.noun} not shown (of ${total})`);
  return parts.join(ENTRY_GAP).trim();
}

function trimNote(omitted: readonly BriefSectionName[], budgetTokens: number): string {
  return (
    `_Trimmed to fit a ${budgetTokens}-token brief. Sections not shown: ${omitted.join(", ")}. ` +
    `Read the PRD directly if you need them._`
  );
}

/** The brief as one string. */
export function renderChangeBrief(options: ChangeBriefOptions): string {
  return buildChangeBrief(options).text;
}

/**
 * The brief as its sections. Joining their `text` with a blank line reproduces
 * {@link renderChangeBrief} exactly, so a loop that sends sections and one that
 * sends a flat string send the same bytes.
 */
export function changeBriefSections(options: ChangeBriefOptions): BriefSection[] {
  return buildChangeBrief(options).sections;
}

/** What separates two sections in the rendered brief. */
const SECTION_GAP = "\n\n";

// ── Gathered context ─────────────────────────────────────────────

/** One capability criterion, with the ancestor capability it was inherited from. */
interface InheritedCriterion {
  criterion: Criterion;
  /** Absent on the capability's own criteria. */
  from?: string;
}

interface AffectedCapability {
  node: CapabilityNode & RuleNode;
  /** Own criteria first, then each inherited one with the capability it came from. */
  criteria: InheritedCriterion[];
  status: ProductStatus | undefined;
  /** True while `reviewedHash` matches the node's current spec hash. */
  specReviewed: boolean;
  amended: boolean;
}

interface BriefContext extends ChangeBriefOptions {
  change: (ChangeNode & RuleNode) | undefined;
  kind: string | undefined;
  capabilities: AffectedCapability[];
  constraints: { node: ConstraintNode & RuleNode; amended: boolean; binds: string[] }[];
  dependsOn: { node: RuleNode; direction: "upstream" | "downstream"; status: ProductStatus | undefined }[];
  recentChanges: (ChangeNode & RuleNode)[];
  siblings: RuleNode[];
  titleOf(ref: string): string;
}

function gather(options: ChangeBriefOptions): BriefContext {
  const { tree, unit } = options;
  const index = productIndex(tree);
  const live = indexTree(tree);
  const parentOf = new Map<RuleNode, RuleNode | undefined>(live.entries.map((e) => [e.node, e.parent]));
  const edges = computeEdges(tree);
  const productStatus = computeProductStatus(tree);
  const change = unit.change as ChangeNode & RuleNode;
  const titleOf = (ref: string): string => index.resolve(ref)?.title ?? ref;

  const amendedIds = new Set((change.amends ?? []).map((a) => index.resolve(a.target)?.id).filter(isPresent));
  const targets = [...(change.amends ?? []).map((a) => a.target), ...(change.touches ?? [])]
    .map((ref) => index.resolve(ref))
    .filter(isPresent);

  const capabilities: AffectedCapability[] = dedupe(targets.filter((n) => n.type === "capability")).map((node) => ({
    node: node as CapabilityNode & RuleNode,
    criteria: criteriaWithInherited(node, parentOf),
    status: productStatus[node.id],
    specReviewed: node.reviewedHash === specHash(nodeSpec(node)),
    amended: amendedIds.has(node.id),
  }));

  // A constraint the change targets directly, plus every constraint binding an
  // affected capability: both are rules this work has to satisfy.
  const boundIds = capabilities.flatMap((c) => edges.boundBy[c.node.id] ?? []);
  const constraintNodes = dedupe([
    ...targets.filter((n) => n.type === "constraint"),
    ...boundIds.map((id) => index.resolve(id)).filter(isPresent),
  ]);
  const constraints = constraintNodes.map((node) => ({
    node: node as ConstraintNode & RuleNode,
    amended: amendedIds.has(node.id),
    binds: capabilities.filter((c) => (edges.boundBy[c.node.id] ?? []).includes(node.id)).map((c) => c.node.title),
  }));

  return {
    ...options,
    change,
    kind: deriveChangeKind(change, index),
    capabilities,
    constraints,
    dependsOn: oneHopNeighbours(capabilities, live, index, productStatus),
    recentChanges: recentChangesFor(capabilities, constraints, edges, index, change.id),
    siblings: siblingUnits(unit),
    titleOf,
  };
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function dedupe(nodes: readonly RuleNode[]): RuleNode[] {
  const seen = new Set<string>();
  return nodes.filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));
}

/**
 * A capability's own criteria, then those it inherits, nearest parent first.
 * A child capability's spec is its own plus everything above it, so an agent
 * reading only the child's `criteria` would miss most of what it promises.
 */
function criteriaWithInherited(
  node: RuleNode,
  parentOf: ReadonlyMap<RuleNode, RuleNode | undefined>,
): InheritedCriterion[] {
  const own = node.type === "capability" ? ((node as CapabilityNode).criteria ?? []) : [];
  const out: InheritedCriterion[] = own.map((criterion) => ({ criterion }));
  for (let parent = parentOf.get(node); parent?.type === "capability"; parent = parentOf.get(parent)) {
    for (const criterion of (parent as CapabilityNode).criteria ?? []) out.push({ criterion, from: parent.title });
  }
  return out;
}

/**
 * The capabilities one `dependsOn` hop away: those an affected capability
 * depends on (upstream, what this work relies on) and those depending on it
 * (downstream, what this work can break). Affected capabilities themselves are
 * excluded — they already have a section.
 */
function oneHopNeighbours(
  capabilities: readonly AffectedCapability[],
  live: TreeIndex,
  index: TreeIndex,
  productStatus: Record<string, ProductStatus>,
): BriefContext["dependsOn"] {
  const affected = new Set(capabilities.map((c) => c.node.id));
  const out: BriefContext["dependsOn"] = [];
  const add = (node: RuleNode, direction: "upstream" | "downstream"): void => {
    if (affected.has(node.id) || out.some((n) => n.node.id === node.id)) return;
    out.push({ node, direction, status: productStatus[node.id] });
  };

  for (const { node } of capabilities) {
    for (const ref of (node as CapabilityNode).dependsOn ?? []) {
      const target = index.resolve(ref);
      if (target) add(target, "upstream");
    }
  }
  for (const { node } of live.entries) {
    if (node.type !== "capability") continue;
    const depends = ((node as CapabilityNode).dependsOn ?? []).map((ref) => index.resolve(ref)?.id);
    if (depends.some((id) => id !== undefined && affected.has(id))) add(node, "downstream");
  }
  return out;
}

/**
 * The most recent changes to the affected nodes, this one excluded. Recency is
 * the latest stamp a change carries; a change with none sorts last, in tree
 * order, so the list is stable rather than arbitrary.
 */
function recentChangesFor(
  capabilities: readonly AffectedCapability[],
  constraints: BriefContext["constraints"],
  edges: ReturnType<typeof computeEdges>,
  index: TreeIndex,
  currentId: string,
): (ChangeNode & RuleNode)[] {
  const ids = [...capabilities.map((c) => c.node.id), ...constraints.map((c) => c.node.id)];
  const changes = dedupe(
    ids
      .flatMap((id) => edges.changedBy[id] ?? [])
      .filter((changeId) => changeId !== currentId)
      .map((changeId) => index.resolve(changeId))
      .filter(isPresent),
  ) as (ChangeNode & RuleNode)[];

  const order = new Map(changes.map((c, i) => [c.id, i]));
  return changes
    .sort((a, b) => {
      const sa = recencyOf(a);
      const sb = recencyOf(b);
      if (sa !== sb) return sa === undefined ? 1 : sb === undefined ? -1 : sb.localeCompare(sa);
      return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
    })
    .slice(0, MAX_RECENT_CHANGES);
}

function recencyOf(node: RuleNode): string | undefined {
  return node.completedAt ?? node.appliedAt ?? node.startedAt ?? node.lastModified;
}

/** The other live tasks of this change. A task-less change has none. */
function siblingUnits(unit: WorkUnit): RuleNode[] {
  if (unit.kind !== "task") return [];
  return (unit.change.children ?? []).filter((c) => c.type === "task" && c.status !== "deleted" && c.id !== unit.node.id);
}

// ── Rendering ────────────────────────────────────────────────────

function renderSection(name: BriefSectionName, ctx: BriefContext): SectionDraft | undefined {
  switch (name) {
    case "task":
      return atomic(name, renderTask(ctx));
    case "siblings":
      return renderSiblings(ctx);
    case "change":
      return atomic(name, renderChange(ctx));
    case "capabilities":
      return renderCapabilities(ctx);
    case "constraints":
      return renderConstraints(ctx);
    case "dependsOn":
      return renderDependsOn(ctx);
    case "realizedBy":
      return renderRealizedBy(ctx);
    case "recentChanges":
      return renderRecentChanges(ctx);
    case "commands":
      return atomic(name, renderCommands(ctx));
    case "workflow":
      return atomic(name, renderWorkflow(ctx));
    case "log":
      return renderLog(ctx);
  }
}

/** A section with nothing to trim: taken whole or not at all. */
function atomic(name: BriefSectionName, text: string): SectionDraft | undefined {
  return text.trim() ? { name, head: text.trim(), entries: [], noun: "" } : undefined;
}

/**
 * A section of entries the budget may trim one at a time. A plain string entry
 * is already as short as it gets, so it serves as its own compact form.
 */
function listed(
  name: BriefSectionName,
  head: string,
  entries: readonly (string | SectionEntry)[],
  noun: string,
  preDropped = 0,
): SectionDraft | undefined {
  if (entries.length === 0) return undefined;
  const normalized = entries.map((e) => (typeof e === "string" ? { full: e, compact: e } : e));
  return { name, head, entries: normalized, noun, preDropped };
}

/**
 * Take the first `max`, reporting how many were dropped and the line that says
 * so. The leading order is kept rather than sampled: every list fed here is in
 * a meaningful order (own criteria before inherited, tree order elsewhere), so
 * a stable prefix beats a spread.
 */
function capped<T>(items: readonly T[], max: number, noun: string, indentBy = ""): { items: T[]; omitted: number; note?: string } {
  if (items.length <= max) return { items: [...items], omitted: 0 };
  return {
    items: items.slice(0, max),
    omitted: items.length - max,
    note: `${indentBy}- … ${items.length - max} more ${noun} not shown (of ${items.length})`,
  };
}

function label(node: RuleNode): string {
  return node.displayId ? `${node.title} (${node.displayId})` : node.title;
}

function renderTask({ unit }: BriefContext): string {
  const { node, kind } = unit;
  const out = [`## Current ${kind}`, `**${node.title}**${node.displayId ? ` · ${node.displayId}` : ""}`, `ID: ${node.id}`, `Status: ${node.status ?? "pending"}`];
  if (node.priority) out.push(`Priority: ${node.priority}`);
  if (node.blockedBy?.length) out.push(`Blocked by: ${node.blockedBy.join(", ")}`);
  const description = typeof node.description === "string" ? node.description : undefined;
  if (description) out.push(`\n${description}`);
  const doneWhen = stringList(node.acceptanceCriteria);
  if (doneWhen.length > 0) {
    out.push("\nDone when:");
    for (const c of doneWhen) out.push(`- ${c}`);
  }
  if (node.tags?.length) out.push(`\nTags: ${node.tags.join(", ")}`);
  if (node.failureReason) {
    out.push("\n### A previous attempt failed — do not repeat it", node.failureReason);
    out.push(
      "Diagnose why that happened before changing anything, and take a different approach. " +
        "If the approach was right and only its execution was wrong, say so and explain what you are doing differently.",
    );
  }
  return out.join("\n");
}

/** `acceptanceCriteria` as strings. A change may carry the field too; read it defensively. */
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function renderSiblings({ siblings }: BriefContext): SectionDraft | undefined {
  const { items, omitted } = capped(siblings, MAX_SIBLINGS, "sibling tasks");
  const entries = items.map((s) => `- [${s.status === "completed" ? "x" : " "}] ${s.title} (${s.status ?? "pending"})`);
  return listed("siblings", "## Sibling tasks in this change", entries, "sibling tasks", omitted);
}

function renderChange({ change, kind, unit, titleOf }: BriefContext): string {
  if (!change) return "";
  // A task-less change is itself the unit, and the task section already named
  // it; repeating the title here says nothing twice.
  const out = [unit.kind === "change" ? "## This change on the product map" : `## Change: ${label(change)}`];
  const facts = [
    kind ? `kind ${kind}` : undefined,
    change.plannedRelease ? `planned for ${change.plannedRelease}` : undefined,
    change.shippedIn ? `shipped in ${change.shippedIn}` : undefined,
    // Only when the derived kind does not already say it.
    change.spike && kind !== "spike" ? "spike" : undefined,
    change.fix && kind !== "fix" ? "fix" : undefined,
    change.needsPlacement ? "awaiting placement" : undefined,
  ].filter(isPresent);
  if (facts.length > 0) out.push(facts.join(" · "));
  if (change.intent) out.push(`\nIntent:\n${trimToLine(change.intent, MAX_INTENT_CHARS, "the change's intent")}`);

  const amends = change.amends ?? [];
  if (amends.length > 0) {
    out.push("\nAmendments to the product map:");
    for (const a of amends) out.push(renderAmendment(a, titleOf));
  }
  const touches = (change.touches ?? []).map(titleOf);
  if (touches.length > 0) out.push(`\nTouches without amending: ${touches.join(", ")}`);
  if (amends.length === 0 && touches.length === 0) {
    out.push("\nThis change names no product node yet. Place it before completing it.");
  }
  return out.join("\n");
}

function renderAmendment(a: Amendment, titleOf: (ref: string) => string): string {
  const target = a.delta === "added" ? `${a.title ?? a.target}${a.under ? ` under ${titleOf(a.under)}` : ""} (new ${a.type ?? "capability"})` : titleOf(a.target);
  const out = [`- **${a.delta}** ${target} — ${a.summary}`];
  if (a.proposed) out.push(indent(`Proposed:\n${a.proposed}`, "  "));
  for (const [verb, list] of [["add", a.criteria?.add], ["replace", a.criteria?.replace]] as const) {
    for (const c of list ?? []) out.push(`  - ${verb} capability criterion ${c.id}: ${c.text}`);
  }
  for (const id of a.criteria?.remove ?? []) out.push(`  - remove capability criterion ${id}`);
  return out.join("\n");
}

function indent(text: string, prefix: string): string {
  return text.split("\n").map((line) => (line ? prefix + line : line)).join("\n");
}

function renderCapabilities({ capabilities }: BriefContext): SectionDraft | undefined {
  const entries = capabilities.map((cap) => {
    const facts = [
      cap.amended ? "amended" : "touched",
      cap.status ? `${cap.status.status} · health ${cap.status.health}` : undefined,
      `spec reviewed: ${cap.specReviewed ? "yes" : "no"}`,
    ].filter(isPresent);
    const heading = `\n### ${label(cap.node)}`;
    const out = [heading, facts.join(" · ")];
    if (cap.node.statement) out.push(trimToLine(cap.node.statement, MAX_STATEMENT_CHARS, "the statement"));
    if (cap.criteria.length > 0) {
      const { items, note } = capped(cap.criteria, MAX_CRITERIA, "capability criteria");
      out.push("\nCapability criteria:");
      for (const { criterion, from } of items) {
        out.push(`- ${criterion.id}: ${elide(criterion.text, MAX_CRITERION_CHARS)}${from ? ` _(inherited from ${from})_` : ""}`);
      }
      if (note) out.push(note);
    }
    out.push(...renderRequirements(cap.node.requirements));
    return { full: out.join("\n"), compact: `${heading}\n${facts.join(" · ")}` };
  });
  return listed("capabilities", "## Capabilities this change affects", entries, "capabilities");
}

function renderRequirements(requirements: Requirement[] | undefined): string[] {
  if (!requirements?.length) return [];
  const { items, note } = capped(requirements, MAX_REQUIREMENTS, "requirement(s)");
  const out = ["\nRequirements:"];
  for (const r of items) {
    out.push(`- **${r.title}** [${r.category}/${r.validationType}]`);
    const criteria = capped(r.acceptanceCriteria ?? [], MAX_REQUIREMENT_CRITERIA, "criteria", "  ");
    for (const ac of criteria.items) out.push(`  - ${ac}`);
    if (criteria.note) out.push(criteria.note);
  }
  if (note) out.push(note);
  return out;
}

function renderConstraints({ constraints }: BriefContext): SectionDraft | undefined {
  const entries = constraints.map(({ node, amended, binds }) => {
    const heading = `\n### ${label(node)}${amended ? " _(amended by this change)_" : ""}`;
    const out = [heading];
    if (node.statement) out.push(trimToLine(node.statement, MAX_STATEMENT_CHARS, "the statement"));
    if (node.appliesTo === "all") out.push("_Binds every capability._");
    else if (binds.length > 0) out.push(`_Binds: ${binds.join(", ")}._`);
    out.push(...renderRequirements(node.requirements));
    return { full: out.join("\n"), compact: heading.trimStart() };
  });
  return listed("constraints", "## Constraints that apply", entries, "constraints");
}

function renderDependsOn({ dependsOn }: BriefContext): SectionDraft | undefined {
  const entries = dependsOn.map(({ node, direction, status }) => {
    const where = direction === "upstream" ? "this work depends on it" : "it depends on this work";
    return `- ${label(node)} — ${where}${status ? ` · ${status.status} · health ${status.health}` : ""}`;
  });
  return listed("dependsOn", "## Neighbouring capabilities (one hop)", entries, "neighbouring capabilities");
}

function renderRealizedBy({ capabilities, realizedBy }: BriefContext): SectionDraft | undefined {
  if (!realizedBy) return undefined;
  const rows = capabilities
    .map((c) => ({ node: c.node, realization: realizedBy[c.node.id] }))
    .filter((row): row is { node: CapabilityNode & RuleNode; realization: Realization } =>
      row.realization !== undefined && row.realization.files.length > 0,
    );
  const entries = rows.map(({ node, realization }) => {
    const heading = `\n### ${node.title}`;
    const out = [heading];
    const { items, note } = capped(realization.files, MAX_FILES, "files");
    for (const file of items) out.push(`- ${file}`);
    if (note) out.push(note);
    if (realization.zones.length > 0) out.push(`Zones: ${realization.zones.join(", ")}`);
    const zones = realization.zones.length > 0 ? ` — zones ${realization.zones.join(", ")}` : "";
    return { full: out.join("\n"), compact: `- ${node.title}: ${realization.files.length} file(s)${zones}` };
  });
  return listed("realizedBy", "## Where these capabilities live in code", entries, "capabilities");
}

function renderRecentChanges({ recentChanges }: BriefContext): SectionDraft | undefined {
  const entries = recentChanges.map((change) => {
    const facts = [change.status ?? "pending", change.shippedIn ? `shipped in ${change.shippedIn}` : undefined, recencyOf(change)].filter(isPresent);
    return `- ${label(change)} — ${facts.join(" · ")}`;
  });
  const head = `## Last ${recentChanges.length === 1 ? "change" : `${recentChanges.length} changes`} to these nodes`;
  return listed("recentChanges", head, entries, "changes");
}

function renderCommands({ commands }: BriefContext): string {
  if (!commands?.validate && !commands?.test) return "";
  const out = ["## Commands"];
  if (commands.validate) out.push(`Validate: \`${commands.validate}\``);
  if (commands.test) out.push(`Test: \`${commands.test}\``);
  return out.join("\n");
}

function renderWorkflow({ workflow }: BriefContext): string {
  if (!workflow?.trim()) return "";
  return `## Workflow\n${trimToLine(workflow, MAX_WORKFLOW_CHARS, "workflow.md")}`;
}

/**
 * Elide a single line, marking the cut. A criterion is one sentence; the marker
 * is what keeps a truncated one from reading as a complete one.
 */
function elide(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trimEnd()}… _(${text.length - maxChars} more characters)_`;
}

/**
 * Trim at a line boundary. This file states rules, so a mid-line cut would
 * leave a truncated rule reading as a complete one.
 */
function trimToLine(text: string, maxChars: number, documentLabel: string): string {
  if (text.length <= maxChars) return text;
  const head = text.slice(0, maxChars);
  const lastBreak = head.lastIndexOf("\n");
  const body = lastBreak > maxChars / 2 ? head.slice(0, lastBreak) : head;
  return `${body}\n\n_… ${text.length - body.length} more character(s) of ${documentLabel} not shown. Read the file directly if you need the rest._`;
}

function renderLog({ recentLog }: BriefContext): SectionDraft | undefined {
  if (!recentLog?.length) return undefined;
  // The newest entries are the useful ones, so the static cap takes the tail.
  const shown = recentLog.slice(-MAX_LOG);
  const entries = shown.map((e) => (e.detail ? `- [${e.timestamp}] ${e.event}: ${e.detail}` : `- [${e.timestamp}] ${e.event}`));
  return listed("log", "## Recent activity", entries, "log entries", recentLog.length - shown.length);
}
