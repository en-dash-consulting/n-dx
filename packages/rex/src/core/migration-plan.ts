/**
 * Migration plan, classification: where each v1 item lands in v2.
 *
 * Pure and deterministic: reads a v1 item tree, writes nothing. Every v1 item
 * gets exactly one entry with a target. The rules are generic, from titles and
 * shape alone, so the plan is a proposal for review, not a decision:
 *
 * - An epic whose title carries a PR or issue token (`PR 4`, `#499`) is one
 *   change; its features become tasks and its tasks subtasks.
 * - An epic whose title carries only a release (`ndx 0.9.0`) is an umbrella:
 *   it dissolves into a `plannedRelease` field, and each child becomes its own
 *   change. A release-named epic never becomes an area.
 * - Any other epic becomes an area.
 * - Under an area, a constraint-shaped feature becomes a constraint; a
 *   capability-shaped one with completed work becomes a capability, and each
 *   of its tasks a change that touches or amends it. A fix- or work-shaped
 *   feature becomes a change (applied when completed) with its tasks kept.
 * - A change is placed on a capability or constraint by the placement rules
 *   (`rankPlacementCandidates`) only on a clear leader; otherwise it is held
 *   with `needsPlacement`, as is any item the rules cannot shape.
 *
 * The plan also proposes the area list (flagging titles that are not
 * job-shaped, and areas that hold no product node) and the constraints.
 *
 * @module core/migration-plan
 */

import type { ItemLevel, ItemStatus, PRDItem } from "../schema/v1.js";
import type { NodeType } from "../schema/v2.js";
import { placementRelation, rankPlacementCandidates, type PlacementNode, type PlacementRelation } from "./placement.js";

// ── Plan shape ───────────────────────────────────────────────────

/** The v2 node an item becomes, or `release`: the item dissolves into its changes' `plannedRelease`. */
export type PlanTargetType = NodeType | "release";

export interface PlanEntry {
  /** v1 item id; the plan is keyed by it. */
  id: string;
  level: ItemLevel;
  title: string;
  status: ItemStatus;
  target: PlanTargetType;
  /** Plan parent: the v1 id of the item this one sits under in v2. Absent at a layer root. */
  parent?: string;
  /** Changes: the release the epic named. */
  plannedRelease?: string;
  /** Changes: completed in v1, so its effect is already in the product layer. */
  applied?: boolean;
  /** Changes: how the change relates to its product node. */
  relation?: PlacementRelation;
  /** Changes: the capability or constraint (v1 id) it touches or amends. */
  placement?: string;
  /** Held for a person to place. */
  needsPlacement?: boolean;
  /** Which rules fired, for review. */
  reasons: string[];
}

export interface ProposedArea {
  /** v1 epic id. */
  id: string;
  title: string;
  /** The title names a job a user does, not a package or a theme. */
  jobShaped: boolean;
  /** Capabilities and constraints the plan puts under it. */
  productNodes: number;
  /** What a reviewer should look at; empty when nothing stands out. */
  notes: string[];
}

export interface ProposedConstraint {
  /** v1 id of the epic or feature it comes from. */
  source: string;
  title: string;
  /** `all` for one drawn from an epic; otherwise the area (v1 id) it sits under. */
  appliesTo: "all" | string;
}

export interface MigrationPlan {
  /** One per v1 item, depth first in tree order. */
  entries: PlanEntry[];
  areas: ProposedArea[];
  constraints: ProposedConstraint[];
  /** Entries per target. */
  counts: Record<PlanTargetType, number>;
}

// ── Title signals ────────────────────────────────────────────────

/** A release version: `0.9.0`, `v1.2`. */
const RELEASE_TOKEN = /(?:^|[^\w.])v?(\d+\.\d+(?:\.\d+)?)(?![\w.])/i;
/** A unit of delivered work: `PR 4`, `PR #12`, `#499`. */
const WORK_TOKEN = /\bPR\s*#?\d+\b|(?:^|\s)#\d+\b/i;

const FIX_WORDS = new Set(["fix", "fixes", "hotfix", "bug", "bugfix", "regression", "repair", "patch"]);
const DEFECT_WORDS = /\b(?:defects?|broken|crash(?:es)?|fails?|failing|leaks?|regressions?|bugs?|findings?)\b/i;

/** Nouns that name a piece of work rather than a part of the product. */
const WORK_NOUNS = /\b(?:hardening|follow-?ups?|cleanup|migration|refactor(?:ing)?|docs|changesets?)\b/i;

/** Leading words of a title that describe work to do rather than something the product does. */
const WORK_VERBS = new Set([
  "add", "introduce", "support", "allow", "enable", "implement", "expose", "offer", "provide", "let",
  "extend", "change", "replace", "switch", "require", "build", "create", "make", "migrate", "move",
  "remove", "drop", "delete", "rename", "refactor", "extract", "split", "merge", "consolidate", "wire",
  "update", "upgrade", "bump", "port", "rewrite", "harden", "audit", "investigate", "document", "write",
  "stamp", "record", "plan", "define", "draft", "generate", "apply", "ship", "cut", "land", "release",
  "deprecate", "retire", "restore", "rework", "simplify", "clean", "cleanup", "keep", "stop", "show",
  "hide", "teach", "track", "capture", "verify", "test", "measure", "prepare", "approve",
]);

/** Words that mark a standing rule over the product rather than a behaviour of it. */
const CONSTRAINT_WORDS = /\b(?:security|safety|parity|compliance|accessibility|a11y|privacy|policy|policies|boundar(?:y|ies)|isolation|compatibility|invariants?|governance|guardrails?)\b/i;

function leadWord(title: string): string | undefined {
  return /^\s*([a-z]+)/i.exec(title)?.[1]?.toLowerCase();
}

/** The release a title names, if any. */
export function releaseToken(title: string): string | undefined {
  return RELEASE_TOKEN.exec(title)?.[1];
}

/** The title names a PR or an issue. */
export function hasWorkToken(title: string): boolean {
  return WORK_TOKEN.test(title);
}

/** An epic that is delivery, not a part of the product: a release, PR or issue is named. */
export function isDeliveryEpic(title: string): boolean {
  return releaseToken(title) !== undefined || hasWorkToken(title);
}

function isFixShaped(item: PRDItem): boolean {
  const lead = leadWord(item.title);
  if (lead !== undefined && FIX_WORDS.has(lead)) return true;
  if ((item.tags ?? []).some((t) => FIX_WORDS.has(t.toLowerCase()))) return true;
  return DEFECT_WORDS.test(item.title);
}

function isWorkShaped(item: PRDItem): boolean {
  const lead = leadWord(item.title);
  return (lead !== undefined && WORK_VERBS.has(lead)) || WORK_NOUNS.test(item.title) || isDeliveryEpic(item.title);
}

function isConstraintShaped(title: string): boolean {
  return CONSTRAINT_WORDS.test(title);
}

/** An area title is job-shaped when it opens with what a user does: a verb or a gerund ("Plan work", "Running agents"). */
export function isJobShaped(title: string): boolean {
  const lead = leadWord(title);
  return lead !== undefined && (WORK_VERBS.has(lead) || (lead.length > 4 && lead.endsWith("ing")));
}

function hasCompletedWork(item: PRDItem): boolean {
  if (item.status === "completed") return true;
  return (item.children ?? []).some(hasCompletedWork);
}

// ── Classification ───────────────────────────────────────────────

interface Pending {
  entry: PlanEntry;
  /** Product nodes in this area rank first; the whole plan is the fallback. */
  area?: string;
  item: PRDItem;
}

class PlanBuilder {
  readonly entries: PlanEntry[] = [];
  readonly constraints: ProposedConstraint[] = [];
  readonly productNodes: Array<PlacementNode & { area?: string }> = [];
  readonly unplaced: Pending[] = [];

  add(item: PRDItem, target: PlanTargetType, fields: Partial<PlanEntry> & { reasons: string[] }): PlanEntry {
    const entry: PlanEntry = { id: item.id, level: item.level, title: item.title, status: item.status, target, ...fields };
    this.entries.push(entry);
    return entry;
  }

  /** A change that waits for placement once every product node is known. */
  change(item: PRDItem, fields: Partial<PlanEntry> & { reasons: string[] }, area?: string): PlanEntry {
    const entry = this.add(item, "change", { applied: item.status === "completed", ...fields });
    if (entry.placement === undefined) this.unplaced.push({ entry, area, item });
    return entry;
  }

  /** Children of a change: v1 tasks and features become tasks; anything deeper becomes a subtask of the nearest task. */
  workUnder(items: readonly PRDItem[] | undefined, change: string, task?: string): void {
    for (const item of items ?? []) {
      if (task === undefined) {
        this.add(item, "task", { parent: change, reasons: [`kept as a task of change ${change}`] });
        this.workUnder(item.children, change, item.id);
      } else {
        const reasons = [`kept as a subtask of task ${task}`];
        if (item.level !== "subtask") reasons.push(`a v1 ${item.level} flattened to fit change > task > subtask`);
        this.add(item, "subtask", { parent: task, reasons });
        this.workUnder(item.children, change, task);
      }
    }
  }
}

function classifyEpic(epic: PRDItem, plan: PlanBuilder): void {
  const release = releaseToken(epic.title);
  if (hasWorkToken(epic.title)) {
    plan.change(epic, {
      ...(release ? { plannedRelease: release } : {}),
      reasons: ["epic names a PR or issue: one change"],
    });
    plan.workUnder(epic.children, epic.id);
    return;
  }
  if (release !== undefined) {
    plan.add(epic, "release", { plannedRelease: release, reasons: [`release-named epic: dissolves into plannedRelease ${release}`] });
    for (const child of epic.children ?? []) {
      plan.change(child, { plannedRelease: release, reasons: [`split out of release umbrella ${epic.id}`] });
      plan.workUnder(child.children, child.id);
    }
    return;
  }

  plan.add(epic, "area", { reasons: ["epic with no release or PR token: an area"] });
  if (isConstraintShaped(epic.title)) {
    plan.constraints.push({ source: epic.id, title: epic.title, appliesTo: "all" });
  }
  for (const child of epic.children ?? []) classifyUnderArea(child, epic.id, plan);
}

function classifyUnderArea(item: PRDItem, area: string, plan: PlanBuilder): void {
  if (item.level !== "feature") {
    plan.change(item, { reasons: [`a v1 ${item.level} directly under an area: its own change`] }, area);
    plan.workUnder(item.children, item.id);
    return;
  }

  const fix = isFixShaped(item);
  const work = isWorkShaped(item);
  if (fix || work) {
    plan.change(item, { reasons: [fix ? "fix-shaped feature: a change" : "work-shaped feature: a change"] }, area);
    plan.workUnder(item.children, item.id);
    return;
  }

  if (isConstraintShaped(item.title)) {
    plan.add(item, "constraint", { parent: area, reasons: ["constraint-shaped feature: a constraint"] });
    plan.constraints.push({ source: item.id, title: item.title, appliesTo: area });
    plan.productNodes.push({ id: item.id, type: "constraint", title: item.title, tags: item.tags, area });
    for (const child of item.children ?? []) historyOf(child, item.id, area, plan);
    return;
  }

  if (!hasCompletedWork(item)) {
    plan.add(item, "change", {
      relation: "amends",
      applied: false,
      needsPlacement: true,
      reasons: ["noun-shaped feature with no completed work: not built yet, so a change that may add a capability"],
    });
    plan.workUnder(item.children, item.id);
    return;
  }

  plan.add(item, "capability", { parent: area, reasons: ["capability-shaped feature with completed work: a capability"] });
  plan.productNodes.push({ id: item.id, title: item.title, tags: item.tags, area });
  for (const child of item.children ?? []) historyOf(child, item.id, area, plan);
}

/** A task under a product node: its own change on that node, its subtasks kept as tasks. */
function historyOf(item: PRDItem, node: string, area: string, plan: PlanBuilder): void {
  const fix = isFixShaped(item);
  plan.change(
    item,
    {
      placement: node,
      relation: placementRelation({ title: item.title, fix, tags: item.tags }),
      reasons: [`work under product node ${node}: a change on it`],
    },
    area,
  );
  plan.workUnder(item.children, item.id);
}

/**
 * Below this, the rules matched one shared word: too weak to place a change
 * without a person. On this repository's tree, one-word placement put much of
 * the history on whichever capability shared a common term.
 */
const MIN_PLACEMENT_SCORE = 2;

/** Place held changes on a clear rules leader; otherwise hold them for a person. */
function place(plan: PlanBuilder): void {
  for (const { entry, area, item } of plan.unplaced) {
    const fix = isFixShaped(item);
    const change = { title: item.title, intent: item.description, fix, tags: item.tags };
    entry.relation ??= placementRelation(change);
    const local = plan.productNodes.filter((n) => n.area === area);
    const pools = area !== undefined && local.length > 0 ? [local, plan.productNodes] : [plan.productNodes];
    let placed = false;
    for (const pool of pools) {
      const [top, next] = rankPlacementCandidates(change, pool, 2);
      if (top && top.score >= MIN_PLACEMENT_SCORE && (next === undefined || next.score < top.score)) {
        entry.placement = top.target;
        entry.reasons.push(`placed by rules on ${top.target} (${top.reasons.join("; ")})`);
        placed = true;
        break;
      }
    }
    if (!placed) {
      entry.needsPlacement = true;
      entry.reasons.push("no clear rules leader: held for placement");
    }
  }
}

function proposeAreas(plan: PlanBuilder): ProposedArea[] {
  return plan.entries
    .filter((e) => e.target === "area")
    .map((e) => {
      const productNodes = plan.productNodes.filter((n) => n.area === e.id).length;
      const jobShaped = isJobShaped(e.title);
      const notes: string[] = [];
      if (!jobShaped) notes.push("not named for a job: rename to what a user does here (\"Plan work\", \"Running agents\")");
      if (productNodes === 0) notes.push("holds no capability or constraint: likely a change, or fold into another area");
      if (isConstraintShaped(e.title)) notes.push("reads as a standing rule: also proposed as a constraint");
      return { id: e.id, title: e.title, jobShaped, productNodes, notes };
    });
}

/** Classify a v1 item tree into a migration plan. */
export function classifyV1Tree(items: readonly PRDItem[]): MigrationPlan {
  const plan = new PlanBuilder();
  for (const item of items) {
    if (item.level === "epic") {
      classifyEpic(item, plan);
    } else {
      plan.change(item, { reasons: [`a v1 ${item.level} at the root: its own change`] });
      plan.workUnder(item.children, item.id);
    }
  }
  place(plan);

  const counts = { area: 0, capability: 0, constraint: 0, change: 0, task: 0, subtask: 0, release: 0 } as Record<PlanTargetType, number>;
  for (const e of plan.entries) counts[e.target] += 1;
  return { entries: plan.entries, areas: proposeAreas(plan), constraints: plan.constraints, counts };
}
