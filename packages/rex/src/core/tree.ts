import type { PRDItem } from "../schema/index.js";

export interface TreeEntry {
  item: PRDItem;
  parents: PRDItem[];
}

export function* walkTree(
  items: PRDItem[],
  parentChain: PRDItem[] = [],
): Generator<TreeEntry> {
  for (const item of items) {
    yield { item, parents: parentChain };
    if (item.children && item.children.length > 0) {
      yield* walkTree(item.children, [...parentChain, item]);
    }
  }
}

export function findItem(
  items: PRDItem[],
  id: string,
): TreeEntry | null {
  for (const entry of walkTree(items)) {
    if (entry.item.id === id) {
      return entry;
    }
  }
  return null;
}

export function insertChild(
  items: PRDItem[],
  parentId: string,
  child: PRDItem,
): boolean {
  for (const entry of walkTree(items)) {
    if (entry.item.id === parentId) {
      if (!entry.item.children) {
        entry.item.children = [];
      }
      entry.item.children.push(child);
      return true;
    }
  }
  return false;
}

export function updateInTree(
  items: PRDItem[],
  id: string,
  updates: Partial<PRDItem>,
): boolean {
  for (const entry of walkTree(items)) {
    if (entry.item.id === id) {
      Object.assign(entry.item, updates);
      return true;
    }
  }
  return false;
}

export function removeFromTree(items: PRDItem[], id: string): PRDItem | null {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) {
      return items.splice(i, 1)[0];
    }
    if (items[i].children) {
      const removed = removeFromTree(items[i].children!, id);
      if (removed) return removed;
    }
  }
  return null;
}

export interface TreeStats {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  deferred: number;
  blocked: number;
}

export function computeStats(items: PRDItem[]): TreeStats {
  const stats: TreeStats = {
    total: 0,
    completed: 0,
    inProgress: 0,
    pending: 0,
    deferred: 0,
    blocked: 0,
  };
  for (const { item } of walkTree(items)) {
    stats.total++;
    switch (item.status) {
      case "completed":
        stats.completed++;
        break;
      case "in_progress":
        stats.inProgress++;
        break;
      case "pending":
        stats.pending++;
        break;
      case "deferred":
        stats.deferred++;
        break;
      case "blocked":
        stats.blocked++;
        break;
    }
  }
  return stats;
}

export function getParentChain(items: PRDItem[], id: string): PRDItem[] {
  const entry = findItem(items, id);
  return entry ? entry.parents : [];
}

export function collectAllIds(items: PRDItem[]): Set<string> {
  const ids = new Set<string>();
  for (const { item } of walkTree(items)) {
    ids.add(item.id);
  }
  return ids;
}
