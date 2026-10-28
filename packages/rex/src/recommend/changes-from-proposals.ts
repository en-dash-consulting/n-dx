/**
 * Accepted proposals and recommendations as change-layer adds (rex schema v2).
 *
 * On a v1 tree `rex analyze --accept` and `rex recommend --accept` create an
 * epic, its features and their tasks. A v2 tree has no container above a
 * change, so none of that structure survives the crossing: the **deepest node
 * that names actual work** becomes one change each — a feature's tasks, or the
 * feature itself when it proposed none, or the epic when it proposed no
 * features. Nothing is lost, because a scanner's leaf titles are already
 * self-sufficient ("Fix coupling in rex-cli: …"); what is dropped is the
 * grouping, which on v2 is the product layer's job rather than a container's.
 *
 * This is the same rule `rex add "<description>"` follows: a change is one
 * intent, and its tasks are written when it is picked up. Each new change
 * lands in the Inbox needing placement, so the rules rank which capability or
 * constraint it amends or touches — the one door sourcevision's findings enter
 * through.
 *
 * A leaf's proposed subtasks (an oversized task's LoE decomposition) become
 * tasks under the change the leaf makes: a v2 change does carry tasks, so
 * that breakdown has somewhere to go, unlike the grouping above it.
 *
 * Pure: no I/O and no store. {@link addProposedChanges} adds the result to a
 * tree in memory, for the CLI's transaction and the dashboard's alike.
 *
 * @module rex/recommend/changes-from-proposals
 */

import { withSelfHealTag } from "../store/self-heal-tag.js";
import { addChangeNode, type AddChangeNodeInput, type AddChangeNodeOptions } from "../core/change-add.js";
import type { RuleNode, V2Tree } from "../schema/v2-rules.js";
import type { Priority } from "./types.js";

/** A proposed epic, feature or task, as the mapper needs it. */
export interface ProposedWork {
  title: string;
  description?: string;
  acceptanceCriteria?: string[];
  priority?: Priority;
  source?: string;
  tags?: string[];
  /**
   * The recommendation's own metadata. Only the finding hashes cross into a
   * change, as `finding:<hash>` tags — v2 has no `recommendationMeta` field,
   * and tags are what the loop already reads at both ends.
   */
  meta?: { findingHashes?: string[] };
  /** A scanner marks work the codebase already does as `completed`. */
  status?: string;
  /** Proposed under this one. A node with children proposes no work of its own. */
  children?: readonly ProposedWork[];
  /**
   * A leaf's proposed subtasks — the LoE decomposition of an oversized task.
   * Each open one becomes a task under the change this leaf makes.
   */
  subtasks?: readonly ProposedWork[];
}

/** A change to add, with the tasks to add under it once it exists. */
export type ProposedChangeInput = AddChangeNodeInput & {
  /** Tasks for this change; their `parentId` is filled with the new change's id. */
  tasks?: AddChangeNodeInput[];
};

/**
 * A proposal in one of these states describes the codebase as it already is,
 * not work to do. On v1 it is recorded as a completed item; on v2 that belongs
 * to the product layer, which a change cannot create — so no change is made
 * for it, and the proposal is reported as skipped rather than silently opened
 * as pending work nobody will do.
 */
const CLOSED_STATUSES: ReadonlySet<string> = new Set(["completed", "cancelled", "deleted"]);

/**
 * One change per leaf of `work`, in depth-first order.
 *
 * A node with children contributes nothing itself — its children carry the
 * work — so an epic with features, or a feature with tasks, is not created.
 * A closed leaf contributes nothing either; see {@link CLOSED_STATUSES}.
 */
export function changeInputsFromProposals(work: readonly ProposedWork[]): ProposedChangeInput[] {
  const inputs: ProposedChangeInput[] = [];
  for (const node of work) {
    if (node.children?.length) {
      inputs.push(...changeInputsFromProposals(node.children));
      continue;
    }
    if (node.status && CLOSED_STATUSES.has(node.status)) continue;
    const title = node.title.trim();
    if (!title) continue;
    // The finding hashes are what closes the self-heal loop: hench
    // acknowledges a deferred change by them, and `--acknowledge-completed`
    // reads them off a finished one. They ride as tags because a v2 change
    // has nowhere else to carry them.
    const tags = [
      ...(node.tags ?? []),
      ...(node.meta?.findingHashes ?? []).map((hash) => `finding:${hash}`),
    ];
    // Stamped here rather than in the store: `addChangeNode` is shared by
    // every v2 writer, and only an accepted recommendation during a self-heal
    // run is self-heal work.
    const input = withSelfHealTag({ type: "change" as const, ...workFields(node, title, tags) });
    const tasks = taskInputsFrom(node.subtasks ?? []);
    inputs.push({ ...(input as AddChangeNodeInput), ...(tasks.length ? { tasks } : {}) });
  }
  return inputs;
}

/** The fields a proposed node carries onto the change or task made from it. */
function workFields(node: ProposedWork, title: string, tags: readonly string[]) {
  return {
    title,
    ...(node.description ? { description: node.description } : {}),
    ...(node.acceptanceCriteria?.length ? { acceptanceCriteria: node.acceptanceCriteria } : {}),
    ...(node.priority ? { priority: node.priority } : {}),
    ...(node.source ? { source: node.source } : {}),
    ...(tags.length ? { tags: [...tags] } : {}),
  };
}

/** A task input per open, titled subtask; `parentId` is left for {@link addProposedChanges}. */
function taskInputsFrom(subtasks: readonly ProposedWork[]): AddChangeNodeInput[] {
  const tasks: AddChangeNodeInput[] = [];
  for (const sub of subtasks) {
    if (sub.status && CLOSED_STATUSES.has(sub.status)) continue;
    const title = sub.title.trim();
    if (!title) continue;
    tasks.push(withSelfHealTag({ type: "task" as const, ...workFields(sub, title, sub.tags ?? []) }) as AddChangeNodeInput);
  }
  return tasks;
}

/**
 * Add `inputs` to `tree` in memory: each change, then its tasks under it.
 *
 * Returns the new tree and every node added, a change before its tasks. Throws
 * {@link AddChangeNodeError} as {@link addChangeNode} does; the caller's
 * transaction then writes nothing.
 */
export function addProposedChanges(
  start: V2Tree,
  inputs: readonly ProposedChangeInput[],
  options: AddChangeNodeOptions,
): { tree: V2Tree; nodes: RuleNode[] } {
  let tree = start;
  const nodes: RuleNode[] = [];
  for (const { tasks, ...input } of inputs) {
    const out = addChangeNode(tree, input, options);
    tree = out.tree;
    nodes.push(out.node);
    for (const task of tasks ?? []) {
      const added = addChangeNode(tree, { ...task, parentId: out.node.id }, options);
      tree = added.tree;
      nodes.push(added.node);
    }
  }
  return { tree, nodes };
}

/** A flat recommendation, linked to its parent by id — the shape `rex recommend` builds. */
export interface FlatRecommendation extends Omit<ProposedWork, "children"> {
  id?: string;
  parentId?: string;
}

/**
 * {@link changeInputsFromProposals} over a flat, parent-linked list: the shape
 * `rex recommend` produces (one epic, a feature per zone+category, a task per
 * finding chunk). A recommendation with no id can have no children.
 */
export function changeInputsFromRecommendations(recs: readonly FlatRecommendation[]): ProposedChangeInput[] {
  const childrenOf = new Map<string, FlatRecommendation[]>();
  const roots: FlatRecommendation[] = [];
  for (const rec of recs) {
    if (rec.parentId === undefined) {
      roots.push(rec);
      continue;
    }
    const siblings = childrenOf.get(rec.parentId);
    if (siblings) siblings.push(rec);
    else childrenOf.set(rec.parentId, [rec]);
  }
  // A parentId naming no recommendation in this batch would orphan the node,
  // so anything unreached from a root is treated as a root of its own.
  const reached = new Set<FlatRecommendation>();
  const nest = (rec: FlatRecommendation): ProposedWork => {
    reached.add(rec);
    const children = rec.id ? childrenOf.get(rec.id) : undefined;
    return { ...rec, ...(children?.length ? { children: children.map(nest) } : {}) };
  };
  const nested = roots.map(nest);
  for (const rec of recs) {
    if (!reached.has(rec)) nested.push(nest(rec));
  }
  return changeInputsFromProposals(nested);
}
