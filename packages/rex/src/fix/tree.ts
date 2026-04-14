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

export function collectFixItemIds(items: FixItem[]): Set<string> {
  const ids = new Set<string>();
  for (const { item } of walkFixTree(items)) {
    ids.add(item.id);
  }
  return ids;
}
