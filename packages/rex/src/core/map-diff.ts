/**
 * Product-layer delta between two v2 trees: which capabilities and
 * constraints were added, modified or retired.
 *
 * The product layer changes only through applied changes, so this is the
 * standing-requirements counterpart of {@link diffTrees}, which reads the
 * change layer. Same shape of answer: by id, sorted by id, each entry carrying
 * the areas and capabilities it sits under.
 *
 * - `added`    — live in the target, not live in the baseline
 * - `retired`  — live in the baseline, not live in the target (tombstoned by
 *                an applied removing change, or gone)
 * - `modified` — live in both, and the title, statement or capability
 *                criteria differ
 *
 * "Live" means not `deleted` and not under a `deleted` node. A baseline with
 * no product layer (a v1 tree) is an empty one, so everything is added.
 *
 * Pure: no I/O.
 *
 * @module core/map-diff
 */

import type { Criterion } from "../schema/v2.js";
import { nodeSpec, type RuleNode } from "../schema/v2-rules.js";
import type { DiffFieldChange } from "./tree-diff.js";

export type MapNodeType = "capability" | "constraint";

/** Enough of a capability or constraint to identify it in a report. */
export interface MapRef {
  id: string;
  displayId?: string;
  type: MapNodeType;
  title: string;
}

export interface MapEntry extends MapRef {
  /** Titles of the areas and capabilities it sits under, outermost first. */
  ancestors: string[];
}

/** Capability criteria that differ, by criterion id. */
export interface CriteriaDelta {
  added: Criterion[];
  removed: Criterion[];
  /** Same id, different text. */
  changed: Array<{ id: string; from: string; to: string }>;
}

export interface MapModifiedEntry extends MapEntry {
  /** Title and statement changes, in that order. */
  fields: DiffFieldChange[];
  /** Present when the capability criteria differ. */
  criteria?: CriteriaDelta;
}

export interface MapDiff {
  added: MapEntry[];
  modified: MapModifiedEntry[];
  retired: MapEntry[];
  counts: { added: number; modified: number; retired: number };
  /** True when every count is zero. */
  identical: boolean;
}

interface Live {
  node: RuleNode;
  ancestors: string[];
}

/** Live capabilities and constraints by id. A repeated id keeps its first occurrence. */
function liveNodes(product: readonly RuleNode[]): Map<string, Live> {
  const out = new Map<string, Live>();
  const visit = (nodes: readonly RuleNode[], ancestors: string[]): void => {
    for (const node of nodes) {
      if (node.status === "deleted") continue;
      if ((node.type === "capability" || node.type === "constraint") && !out.has(node.id)) {
        out.set(node.id, { node, ancestors });
      }
      visit(node.children ?? [], [...ancestors, node.title]);
    }
  };
  visit(product, []);
  return out;
}

function entry({ node, ancestors }: Live): MapEntry {
  return {
    id: node.id,
    ...(node.displayId ? { displayId: node.displayId } : {}),
    type: node.type as MapNodeType,
    title: node.title,
    ancestors,
  };
}

function criteriaDelta(from: Criterion[], to: Criterion[]): CriteriaDelta | undefined {
  const before = new Map(from.map((c) => [c.id, c]));
  const after = new Map(to.map((c) => [c.id, c]));
  const delta: CriteriaDelta = {
    added: to.filter((c) => !before.has(c.id)),
    removed: from.filter((c) => !after.has(c.id)),
    changed: to.flatMap((c) => {
      const prior = before.get(c.id);
      return prior && prior.text.trim() !== c.text.trim() ? [{ id: c.id, from: prior.text, to: c.text }] : [];
    }),
  };
  return delta.added.length || delta.removed.length || delta.changed.length ? delta : undefined;
}

function modification(before: Live, after: Live): MapModifiedEntry | undefined {
  const fields: DiffFieldChange[] = [];
  if (before.node.title !== after.node.title) {
    fields.push({ field: "title", from: before.node.title, to: after.node.title });
  }
  const was = nodeSpec(before.node);
  const is = nodeSpec(after.node);
  const statement = (s: string | undefined): string | null => (s?.trim() ? s.trim() : null);
  if (statement(was.statement) !== statement(is.statement)) {
    fields.push({ field: "statement", from: statement(was.statement), to: statement(is.statement) });
  }
  const criteria = criteriaDelta(was.criteria ?? [], is.criteria ?? []);
  if (fields.length === 0 && !criteria) return undefined;
  return { ...entry(after), fields, ...(criteria ? { criteria } : {}) };
}

const byId = <T extends { id: string }>(entries: T[]): T[] =>
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/**
 * Diff the `to` product layer against the `from` baseline.
 *
 * @param from Baseline product layer; `[]` when the baseline has none.
 * @param to   Target product layer.
 */
export function diffProductLayer(from: readonly RuleNode[], to: readonly RuleNode[]): MapDiff {
  const before = liveNodes(from);
  const after = liveNodes(to);

  const added: MapEntry[] = [];
  const modified: MapModifiedEntry[] = [];
  for (const [id, live] of after) {
    const baseline = before.get(id);
    if (!baseline) {
      added.push(entry(live));
      continue;
    }
    const changed = modification(baseline, live);
    if (changed) modified.push(changed);
  }
  const retired = [...before].filter(([id]) => !after.has(id)).map(([, live]) => entry(live));

  const counts = { added: added.length, modified: modified.length, retired: retired.length };
  return {
    added: byId(added),
    modified: byId(modified),
    retired: byId(retired),
    counts,
    identical: Object.values(counts).every((n) => n === 0),
  };
}
