import type { FixItem } from "./types.js";

export interface FixTreeEntry {
  item: FixItem;
  parents: FixItem[];
}

export function* walkFixTree(
  items: FixItem[],
  parentChain: FixItem[] = [],
): Generator<FixTreeEntry> {
  for (const item of items) {
    yield { item, parents: parentChain };
    if (item.children && item.children.length > 0) {
      yield* walkFixTree(item.children, [...parentChain, item]);
    }
  }
}

/**
 * Every item in the tree, children before their parents.
 *
 * Post-order is load-bearing for the stuck-parent sweep: a feature must be
 * decided before the epic that contains it, so that completing the feature can
 * in turn make the epic completable in the same pass.
 */
export function collectFixTreePostOrder(items: FixItem[]): FixItem[] {
  const out: FixItem[] = [];
  for (const item of items) {
    if (item.children && item.children.length > 0) {
      out.push(...collectFixTreePostOrder(item.children));
    }
    out.push(item);
  }
  return out;
}

export function collectFixItemIds(items: FixItem[]): Set<string> {
  const ids = new Set<string>();
  for (const { item } of walkFixTree(items)) {
    ids.add(item.id);
  }
  return ids;
}
