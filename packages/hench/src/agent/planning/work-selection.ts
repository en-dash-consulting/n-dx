/**
 * Work selection on a v2 tree (product/ + changes/).
 *
 * `resolveStore` returns the change-layer store there, whose document is the
 * change layer projected as v1 items. The v1 selector run over that projection
 * would pick Inbox changes and ignore a change's own gates, so a v2 tree is
 * selected with rex's v2 selector — the one `get_next_task` uses — and the
 * answer is handed back as a {@link TreeEntry} over the projection, which is
 * what the brief and the claim already take. A v1 tree never reaches this
 * module: {@link loadV2Tree} answers `undefined` and callers keep the v1 path.
 *
 * @module hench/agent/planning/work-selection
 */

import {
  findActionableWork,
  findItem,
  findNextWorkTask,
  isChangeLayerStore,
  resolveWorkById,
} from "../../prd/rex-gateway.js";
import type { PRDItem, PRDStore, SelectionExplanation, TreeEntry, V2Tree } from "../../prd/rex-gateway.js";

/** Why the epic flags (`--epic`, `--epic-by-epic`) do not apply on a v2 tree. */
export const V2_HAS_NO_EPICS =
  "this PRD is a v2 tree (product/ and changes/), which has no epic level; its work is changes and their tasks";

/** The v2 tree behind `store`; `undefined` on a v1 tree. */
export async function loadV2Tree(store: PRDStore): Promise<V2Tree | undefined> {
  return isChangeLayerStore(store) ? store.loadTree() : undefined;
}

type ChangeLayerNode = V2Tree["changes"][number];

/**
 * The tree with every change-layer node in `ids` read as pending: what a dry
 * run's `--reset-deferred` would have selected from. The input is not changed.
 */
export function readTreeAsReset(tree: V2Tree, ids: ReadonlySet<string>): V2Tree {
  const reset = (nodes: ChangeLayerNode[]): ChangeLayerNode[] =>
    nodes.map((node) => ({
      ...node,
      ...(ids.has(node.id) ? { status: "pending" as const } : {}),
      ...(node.children ? { children: reset(node.children) } : {}),
    }));
  return { product: tree.product, changes: reset(tree.changes) };
}

export interface V2SelectOptions {
  /** Units to pass over: stuck, over their attempt limit, or claimed elsewhere. */
  excludeIds?: ReadonlySet<string>;
  /** Only units carrying one of these tags (`--tags`, self-heal). */
  tags?: readonly string[];
  /** Only units assigned to this identity, directly or through their change (`--mine`). */
  assignee?: string;
}

/**
 * A selected unit. `explanation` is rex's, so `explanation.priority.itemPriority`
 * is the priority selection ranked it by: its own, else its change's.
 */
export interface V2Entry extends TreeEntry {
  explanation: SelectionExplanation;
}

/** The unit autonomous selection runs next, or `null` when none is actionable. */
export function nextV2Entry(tree: V2Tree, options: V2SelectOptions = {}): V2Entry | null {
  const excludeIds = new Set(options.excludeIds ?? []);
  if (options.assignee) {
    // findNextWorkTask takes no assignee, so pass over every unit rex's own
    // `--mine` rule (findActionableWork's) leaves out.
    const mine = new Set(findActionableWork(tree, { assignee: options.assignee }).map((u) => u.node.id));
    for (const unit of findActionableWork(tree)) if (!mine.has(unit.node.id)) excludeIds.add(unit.node.id);
  }
  const next = findNextWorkTask(tree, { excludeIds, ...(options.tags?.length ? { tags: options.tags } : {}) });
  return next ? { item: next.item, parents: next.parents, explanation: next.explanation } : null;
}

/** Every actionable unit, best first, as entries of `items` (the projected change layer). */
export function actionableV2Entries(
  tree: V2Tree,
  items: PRDItem[],
  options: Omit<V2SelectOptions, "tags"> = {},
): TreeEntry[] {
  const units = findActionableWork(tree, {
    ...(options.excludeIds?.size ? { excludeIds: options.excludeIds } : {}),
    ...(options.assignee ? { assignee: options.assignee } : {}),
  });
  return units.flatMap((u) => findItem(items, u.node.id) ?? []);
}

/**
 * The entry an explicit `--task` names: an id, a display id (`CH-1`) or an
 * alias. Selection gates do not apply — a change awaiting placement runs when
 * asked for by name. `null` when the ref names nothing that runs on its own.
 */
export function findV2Entry(tree: V2Tree, items: PRDItem[], ref: string): TreeEntry | null {
  const unit = resolveWorkById(tree, ref);
  return unit ? findItem(items, unit.node.id) : null;
}

/**
 * {@link findV2Entry}, refusing with the reason when the ref names nothing
 * that runs on its own.
 */
export function resolveV2Entry(tree: V2Tree, items: PRDItem[], ref: string): TreeEntry {
  const found = findV2Entry(tree, items, ref);
  if (found) return found;
  const entry = findItem(items, ref);
  if (entry?.item.type === "change") {
    throw new Error(
      `"${entry.item.title}" (${ref}) holds other changes, so it is not a unit of work. ` +
        "Run one of its nested changes or tasks.",
    );
  }
  if (entry?.item.type === "subtask") {
    throw new Error(`"${entry.item.title}" (${ref}) is a subtask; it runs with its task. Run the task instead.`);
  }
  throw new Error(`Task not found: ${ref}`);
}
