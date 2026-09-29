/**
 * Id-based diff between two PRD trees.
 *
 * Two trees of the same PRD drift: a branch adds tasks, the main line
 * completes others, a reshape moves a feature under a different epic. This
 * module answers "what is different between these two trees?" once, for every
 * caller that asks — `rex tree-diff`, the dashboard's Workspaces board, and
 * the pull-request summary.
 *
 * The diff is **by item id over the flattened trees**, not by file or by
 * position. That is what makes a move distinguishable from a delete plus an
 * add: the id is stable across a reparent, so the same item found under a
 * different ancestor chain is reported as `moved` rather than as two
 * unrelated events in `removed` and `added`.
 *
 * ## The categories are questions, not a partition
 *
 * They overlap by design, and callers depend on the overlap:
 *
 * - `added`     — id in the target tree, absent from the baseline
 * - `removed`   — id in the baseline, absent from the target
 * - `changed`   — id in both, and a {@link TREE_DIFF_COMPARED_FIELDS} value differs
 * - `completed` — completed in the target and not completed in the baseline,
 *                 *including* items the baseline does not have at all —
 *                 "what this tree finished that the other one has not"
 * - `moved`     — id in both, under a different ancestor chain
 *
 * A task added and finished between the two trees is both `added` and
 * `completed`. A task that was moved and renamed is both `moved` and
 * `changed`. A caller that needs a partition has to choose a precedence
 * itself; nothing here picks one for it.
 *
 * ## Ancestors
 *
 * Every entry carries the chain of containers it sits under, outermost
 * first, because an id alone does not tell a reader where the item lives —
 * and for `removed` items the target tree cannot be consulted for it. A
 * `moved` entry carries both chains: `fromAncestors` is where it was,
 * `ancestors` is where it is now.
 *
 * Pure and deterministic: no I/O, and every category is sorted by id so two
 * runs over the same trees produce byte-identical output.
 *
 * @module core/tree-diff
 */

import { walkTree } from "./tree.js";
import type { PRDItem, ItemLevel } from "../schema/index.js";

/**
 * Fields whose difference makes an item `changed`.
 *
 * Deliberately narrow: these are the fields a human reading a diff is asking
 * about. Including every field would make `changed` fire on `lastModifiedBy`
 * and on rollup timestamps that move whenever anything nearby is touched,
 * which is how a diff becomes noise nobody reads.
 */
export const TREE_DIFF_COMPARED_FIELDS = [
  "status",
  "title",
  "priority",
  "description",
  "lastModified",
] as const;

/** Enough of an item to identify it in a report. */
export interface DiffItemRef {
  id: string;
  title: string;
  level: ItemLevel;
}

/** An item plus the containers it sits under, outermost first. */
export interface DiffEntry extends DiffItemRef {
  ancestors: DiffItemRef[];
}

/** One field that differs, with both sides' values. */
export interface DiffFieldChange {
  field: string;
  /** The baseline value, or null when the field was absent. */
  from: string | null;
  /** The target value, or null when the field is absent. */
  to: string | null;
}

export interface DiffChangedEntry extends DiffEntry {
  /** Every compared field that differs, in {@link TREE_DIFF_COMPARED_FIELDS} order. */
  fields: DiffFieldChange[];
}

export interface DiffMovedEntry extends DiffEntry {
  /** Where the item was in the baseline tree, outermost first. */
  fromAncestors: DiffItemRef[];
}

export interface TreeDiffCounts {
  added: number;
  removed: number;
  changed: number;
  completed: number;
  moved: number;
}

export interface TreeDiff {
  added: DiffEntry[];
  removed: DiffEntry[];
  changed: DiffChangedEntry[];
  completed: DiffEntry[];
  moved: DiffMovedEntry[];
  counts: TreeDiffCounts;
  /** Items in each flattened tree. */
  totals: { from: number; to: number };
  /** True when every count is zero. */
  identical: boolean;
}

export interface TreeDiffOptions {
  /**
   * Override the fields compared for `changed`. Callers with their own
   * published contract (the dashboard's PRD delta) pass their set rather than
   * inheriting a default that could widen under them.
   */
  comparedFields?: readonly string[];
}

/** An item, its ancestor chain, and the id of its direct parent. */
interface IndexedItem {
  item: PRDItem;
  ancestors: PRDItem[];
}

/**
 * Flatten a tree into an id → item map.
 *
 * A repeated id keeps its **first** occurrence. Duplicate ids are a malformed
 * tree that `rex validate` reports, and picking a side arbitrarily here would
 * make the diff's output depend on walk order — so the rule is stated rather
 * than left to chance.
 */
function indexById(items: PRDItem[]): Map<string, IndexedItem> {
  const byId = new Map<string, IndexedItem>();
  for (const { item, parents } of walkTree(items)) {
    if (!byId.has(item.id)) byId.set(item.id, { item, ancestors: parents });
  }
  return byId;
}

function ref(item: PRDItem): DiffItemRef {
  return { id: item.id, title: item.title, level: item.level };
}

function entry(indexed: IndexedItem): DiffEntry {
  return { ...ref(indexed.item), ancestors: indexed.ancestors.map(ref) };
}

/**
 * A field's value as a comparable string, or null when absent.
 *
 * An absent field and an explicitly `undefined` one are the same thing to a
 * reader, and the folder-tree parser produces both depending on whether the
 * frontmatter key was written — so collapsing them is what stops a
 * round-trip through the serializer from registering as a change.
 */
function fieldValue(item: PRDItem, field: string): string | null {
  const raw = item[field];
  if (raw === undefined || raw === null) return null;
  return typeof raw === "string" ? raw : JSON.stringify(raw);
}

function fieldChanges(
  from: PRDItem,
  to: PRDItem,
  comparedFields: readonly string[],
): DiffFieldChange[] {
  const changes: DiffFieldChange[] = [];
  for (const field of comparedFields) {
    const before = fieldValue(from, field);
    const after = fieldValue(to, field);
    if (before !== after) changes.push({ field, from: before, to: after });
  }
  return changes;
}

/**
 * Whether two ancestor chains describe the same place in the tree.
 *
 * Compares the whole chain rather than only the direct parent. When a feature
 * is reparented, every task beneath it keeps its direct parent but is no
 * longer where the baseline said it was — reporting only the feature would
 * leave a reader looking for those tasks under the old epic.
 */
function sameAncestry(a: PRDItem[], b: PRDItem[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((parent, i) => parent.id === b[i].id);
}

function byId<T extends { id: string }>(entries: T[]): T[] {
  return entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Diff the `to` tree against the `from` baseline.
 *
 * @param from Baseline tree — the "before" side (the anchor, or the older commit).
 * @param to   Target tree — the "after" side (this worktree, or the newer commit).
 */
export function diffTrees(
  from: PRDItem[],
  to: PRDItem[],
  opts: TreeDiffOptions = {},
): TreeDiff {
  const comparedFields = opts.comparedFields ?? TREE_DIFF_COMPARED_FIELDS;

  const before = indexById(from);
  const after = indexById(to);

  const added: DiffEntry[] = [];
  const changed: DiffChangedEntry[] = [];
  const completed: DiffEntry[] = [];
  const moved: DiffMovedEntry[] = [];

  for (const [id, indexed] of after) {
    const baseline = before.get(id);

    if (!baseline) {
      added.push(entry(indexed));
    } else {
      const fields = fieldChanges(baseline.item, indexed.item, comparedFields);
      if (fields.length > 0) changed.push({ ...entry(indexed), fields });
      if (!sameAncestry(baseline.ancestors, indexed.ancestors)) {
        moved.push({ ...entry(indexed), fromAncestors: baseline.ancestors.map(ref) });
      }
    }

    // Absent from the baseline counts as "not completed there" — an item
    // added and finished on this side is something the other side lacks.
    if (indexed.item.status === "completed" && baseline?.item.status !== "completed") {
      completed.push(entry(indexed));
    }
  }

  const removed: DiffEntry[] = [];
  for (const [id, indexed] of before) {
    if (!after.has(id)) removed.push(entry(indexed));
  }

  const counts: TreeDiffCounts = {
    added: added.length,
    removed: removed.length,
    changed: changed.length,
    completed: completed.length,
    moved: moved.length,
  };

  return {
    added: byId(added),
    removed: byId(removed),
    changed: byId(changed),
    completed: byId(completed),
    moved: byId(moved),
    counts,
    totals: { from: before.size, to: after.size },
    identical: Object.values(counts).every((n) => n === 0),
  };
}
