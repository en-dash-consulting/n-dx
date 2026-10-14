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
 * Pure: no I/O, no store, no tree.
 *
 * @module rex/recommend/changes-from-proposals
 */

import type { AddChangeNodeInput } from "../core/change-add.js";
import type { Priority } from "./types.js";

/** A proposed epic, feature or task, as the mapper needs it. */
export interface ProposedWork {
  title: string;
  description?: string;
  acceptanceCriteria?: string[];
  priority?: Priority;
  source?: string;
  tags?: string[];
  /** A scanner marks work the codebase already does as `completed`. */
  status?: string;
  /** Proposed under this one. A node with children proposes no work of its own. */
  children?: readonly ProposedWork[];
}

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
export function changeInputsFromProposals(work: readonly ProposedWork[]): AddChangeNodeInput[] {
  const inputs: AddChangeNodeInput[] = [];
  for (const node of work) {
    if (node.children?.length) {
      inputs.push(...changeInputsFromProposals(node.children));
      continue;
    }
    if (node.status && CLOSED_STATUSES.has(node.status)) continue;
    const title = node.title.trim();
    if (!title) continue;
    inputs.push({
      type: "change",
      title,
      ...(node.description ? { description: node.description } : {}),
      ...(node.acceptanceCriteria?.length ? { acceptanceCriteria: node.acceptanceCriteria } : {}),
      ...(node.priority ? { priority: node.priority } : {}),
      ...(node.source ? { source: node.source } : {}),
      ...(node.tags?.length ? { tags: [...node.tags] } : {}),
    });
  }
  return inputs;
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
export function changeInputsFromRecommendations(recs: readonly FlatRecommendation[]): AddChangeNodeInput[] {
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
