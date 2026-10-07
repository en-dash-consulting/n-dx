/**
 * Handle a direct edit to a product node's spec (rex schema v2).
 *
 * Editing a capability or constraint without a change is how a steward says
 * "the requirement is now different". The caller passes the tree holding the
 * edited node and the spec it held before the edit:
 *
 * - **editorial** (wording only, nothing to build): `metAt` is re-stamped to the
 *   new spec, so the node stays met, and a History line records the edit.
 *   Refused when the node was already revised before this edit.
 * - **any other spec edit**: `metAt` is kept, so the node reads revised
 *   (`revisedAt` is stamped unless already set), and one change is drafted in
 *   the Inbox (`source: "map-edit"`, `needsPlacement: true`) from the diff.
 *   Its amendment carries the edited statement as `proposed`, so applying the
 *   change stamps `metAt` at the edited spec. The criteria diff, which the map
 *   already holds, is described in the change's `intent`.
 *
 * A spec that still hashes to `metAt` is `unchanged`; a node never met is
 * `proposed` and has no build to revise. Both return the tree as given.
 *
 * Pure and deterministic like {@link applyAmendments}: works on a copy and
 * leaves writing to the caller. Wired to nothing yet.
 *
 * @module rex/core/map-edit
 */

import { randomUUID } from "node:crypto";
import type { Amendment, Criterion } from "../schema/v2.js";
import { specHash, type RuleNode, type V2Tree } from "../schema/v2-rules.js";
import { appendHistory, freeSlug, resolve, stampMet } from "./apply-amendments.js";

/** The spec `metAt` hashes: statement and criteria (a constraint has a statement only). */
export interface Spec {
  statement?: string;
  criteria?: Criterion[];
}

export interface MapEditOptions {
  /** The edit changes wording only: re-stamp instead of drafting a change. */
  editorial?: boolean;
  /** History line text for an editorial edit, or the drafted amendment's summary. Default: derived from the diff. */
  summary?: string;
  /** Date written on History lines and `revisedAt`. */
  now: Date;
  /** Id for the drafted change. Default `randomUUID`. */
  newId?: () => string;
}

export type MapEditOutcome = "editorial" | "revised" | "unchanged" | "proposed";

export interface MapEditResult {
  /** The tree after handling the edit; the input tree is not modified. */
  tree: V2Tree;
  outcome: MapEditOutcome;
  /** The drafted change, for a `revised` outcome. */
  change?: RuleNode;
}

export class MapEditError extends Error {
  constructor(node: string, message: string) {
    super(`Cannot handle the edit to ${node}: ${message}`);
    this.name = "MapEditError";
  }
}

export const MAP_EDIT_SOURCE = "map-edit";

/** Handle the direct edit of `nodeRef` (id, display id or alias), whose spec was `before`. */
export function handleMapEdit(tree: V2Tree, nodeRef: string, before: Spec, options: MapEditOptions): MapEditResult {
  const found = resolve(tree.product, nodeRef);
  if (!found || (found.type !== "capability" && found.type !== "constraint")) {
    throw new MapEditError(nodeRef, "not a live capability or constraint");
  }
  if (!found.metAt) return { tree, outcome: "proposed" };
  if (specHash(specOf(found)) === found.metAt) return { tree, outcome: "unchanged" };

  const next = structuredClone(tree);
  const node = resolve(next.product, found.id)!;
  const label = node.displayId ?? node.id;
  const after = specOf(node);
  const diff = describeDiff(specOf({ ...before, type: node.type }), after);
  const summary = options.summary?.trim() || diff.summary;

  if (options.editorial) {
    // Re-stamping over an unbuilt revision would mark that revision met.
    if (specHash(specOf({ ...before, type: node.type })) !== node.metAt) {
      throw new MapEditError(label, "it is already revised, so an editorial re-stamp would mark the unbuilt revision met");
    }
    stampMet(node);
    node.body = appendHistory(node.body, `- ${options.now.toISOString().slice(0, 10)} editorial: ${summary}`);
    return { tree: next, outcome: "editorial" };
  }

  const id = (options.newId ?? randomUUID)();
  if (resolve([...next.product, ...next.changes], id, { includeDeleted: true })) {
    throw new MapEditError(label, `the new id ${id} is already taken`);
  }
  node.revisedAt ??= options.now.toISOString();
  const title = `Build the revised ${node.title}`;
  const amendment: Amendment = { target: label, delta: "modified", summary, proposed: after.statement ?? "" };
  const change = {
    id,
    type: "change",
    title,
    slug: freeSlug(title, id, next.changes),
    source: MAP_EDIT_SOURCE,
    intent: [`${node.title} (${label}) was edited on the map. Build it.`, "", ...diff.lines].join("\n"),
    amends: [amendment],
    status: "pending",
    needsPlacement: true,
  } as RuleNode;
  next.changes = [...next.changes, change];
  return { tree: next, outcome: "revised", change };
}

/** The part of a node `metAt` hashes; a constraint's criteria never count. */
function specOf(node: Spec & { type: string }): Spec {
  return node.type === "capability" ? { statement: node.statement, criteria: node.criteria } : { statement: node.statement };
}

/** A one-line summary and a Markdown list of what changed between two specs, compared as `specHash` does. */
function describeDiff(before: Spec, after: Spec): { summary: string; lines: string[] } {
  const lines: string[] = [];
  const parts: string[] = [];
  const was = (before.statement ?? "").trim();
  const now = (after.statement ?? "").trim();
  if (was !== now) {
    lines.push(`- Statement: “${was}” → “${now}”`);
    parts.push("statement edited");
  }
  const old = new Map((before.criteria ?? []).map((c) => [c.id, c.text.trim()]));
  const cur = new Map((after.criteria ?? []).map((c) => [c.id, c.text.trim()]));
  const added = [...cur.keys()].filter((id) => !old.has(id));
  const replaced = [...cur.keys()].filter((id) => old.has(id) && old.get(id) !== cur.get(id));
  const removed = [...old.keys()].filter((id) => !cur.has(id));
  for (const id of added) lines.push(`- Added ${id}: ${cur.get(id)}`);
  for (const id of replaced) lines.push(`- Replaced ${id}: “${old.get(id)}” → “${cur.get(id)}”`);
  for (const id of removed) lines.push(`- Removed ${id}: ${old.get(id)}`);
  const criteria = [
    ...(added.length ? [`${added.join(", ")} added`] : []),
    ...(replaced.length ? [`${replaced.join(", ")} replaced`] : []),
    ...(removed.length ? [`${removed.join(", ")} removed`] : []),
  ];
  if (criteria.length) parts.push(`criteria ${criteria.join(", ")}`);
  if (!parts.length) {
    // Same ids and text, so only the criteria order moved.
    lines.push("- Criteria reordered");
    parts.push("criteria reordered");
  }
  return { summary: parts.join("; "), lines };
}
