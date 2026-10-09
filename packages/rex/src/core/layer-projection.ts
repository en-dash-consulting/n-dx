/**
 * The layers of a v2 tree read as v1 items, so the level-based restructuring
 * code (`core/reshape.ts`, `core/reorganize.ts`, `core/prune.ts`) and the
 * reshape prompt can run on them unchanged.
 *
 * - **Change layer, round trip.** {@link changeLayerItems} projects every
 *   change-layer node, tombstones included, and {@link changeLayerFromItems}
 *   maps the edited items back. A node keeps every field it had (its `type`
 *   and frozen `slug` among them); a change's `intent` reads as `description`.
 *   Levels follow nesting: a root change is an epic, a nested change a
 *   feature, then task and subtask. An item a restructure created takes its
 *   type from its level and a fresh slug.
 * - **Product layer, read only.** {@link productLayerItems} projects the live
 *   product nodes for analysis: a statement reads as `description` and the
 *   capability criteria as `acceptanceCriteria`. Nothing maps product items
 *   back: the product layer changes only through a change's amendments.
 *
 * Pure: no I/O.
 *
 * @module rex/core/layer-projection
 */

import type { ItemLevel, ItemStatus, PRDItem } from "../schema/v1.js";
import type { ChangeNodeType } from "../schema/v2.js";
import type { RuleNode } from "../schema/v2-rules.js";
import { freeSlug } from "./apply-amendments.js";

/** The change-layer type an item of `level` is written as. */
const TYPE_OF_LEVEL: Readonly<Record<ItemLevel, ChangeNodeType>> = {
  epic: "change",
  feature: "change",
  task: "task",
  subtask: "subtask",
};

/** Product depth to level, so the level hierarchy holds: area, capability, sub-capability, deeper. */
const PRODUCT_LEVELS: readonly ItemLevel[] = ["epic", "feature", "task", "subtask"];

/** The change layer as v1 items, tombstones included; a change's `intent` is its `description`. */
export function changeLayerItems(changes: readonly RuleNode[]): PRDItem[] {
  return changes.map((node) => changeItem(node, undefined));
}

function changeItem(node: RuleNode, parent: RuleNode | undefined): PRDItem {
  const { children, intent, ...fields } = node as RuleNode & { intent?: string };
  const level: ItemLevel = node.type === "change" ? (parent ? "feature" : "epic") : node.type === "task" ? "task" : "subtask";
  const item = { ...fields, level, status: (node.status ?? "pending") as ItemStatus } as PRDItem;
  if (node.type === "change" && intent !== undefined) item.description = intent;
  if (children?.length) item.children = children.map((child) => changeItem(child, node));
  return item;
}

export interface ChangeLayerWriteBack {
  /** The change layer the items describe. */
  changes: RuleNode[];
  /** Ids of nodes the items no longer hold: deleted on write. */
  removed: Set<string>;
}

/** Map edited {@link changeLayerItems} back onto change-layer nodes; `previous` is the layer they were projected from. */
export function changeLayerFromItems(items: readonly PRDItem[], previous: readonly RuleNode[]): ChangeLayerWriteBack {
  const known = new Map<string, RuleNode>();
  const walk = (nodes: readonly RuleNode[]): void =>
    nodes.forEach((n) => {
      known.set(n.id, n);
      walk(n.children ?? []);
    });
  walk(previous);

  const kept = new Set<string>();
  const toNodes = (list: readonly PRDItem[]): RuleNode[] => {
    const nodes = list.map((item) => {
      kept.add(item.id);
      return changeNode(item, known.get(item.id), toNodes);
    });
    // A created item gets a slug no sibling holds; existing slugs are frozen.
    for (const node of nodes) {
      if (!node.slug) node.slug = freeSlug(node.title, node.id, nodes.filter((n) => n.slug));
    }
    return nodes;
  };
  const changes = toNodes(items);
  return { changes, removed: new Set([...known.keys()].filter((id) => !kept.has(id))) };
}

function changeNode(item: PRDItem, before: RuleNode | undefined, toNodes: (list: readonly PRDItem[]) => RuleNode[]): RuleNode {
  const { level, children, description, ...fields } = item;
  const type = before?.type ?? TYPE_OF_LEVEL[level];
  const node = { ...fields, type } as Record<string, unknown>;
  // The projection reads an absent status as pending; leave it absent, as it was.
  if (node.status === "pending" && before?.status === undefined) delete node.status;
  if (description !== undefined) node[type === "change" ? "intent" : "description"] = description;
  const nested = children?.length ? toNodes(children) : [];
  if (nested.length) node.children = nested;
  return node as unknown as RuleNode;
}

/** The live product layer as v1 items, for analysis only: statement as `description`, capability criteria as `acceptanceCriteria`. */
export function productLayerItems(product: readonly RuleNode[]): PRDItem[] {
  const project = (nodes: readonly RuleNode[], depth: number): PRDItem[] =>
    nodes
      .filter((node) => node.status !== "deleted")
      .map((node) => {
        const { children, statement, criteria, ...fields } = node as RuleNode & { statement?: string; criteria?: { text: string }[] };
        const item = {
          ...fields,
          level: PRODUCT_LEVELS[Math.min(depth, PRODUCT_LEVELS.length - 1)],
          status: (node.status ?? "pending") as ItemStatus,
        } as PRDItem;
        if (statement !== undefined) item.description = statement;
        if (criteria?.length) item.acceptanceCriteria = criteria.map((c) => c.text);
        const nested = project(children ?? [], depth + 1);
        if (nested.length) item.children = nested;
        return item;
      });
  return project(product, 0);
}
