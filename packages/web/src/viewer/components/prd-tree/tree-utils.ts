/**
 * Shared tree traversal utilities for browser-side PRD code.
 *
 * These operate on the viewer's PRDItemData type (which mirrors the
 * canonical Rex types but is duplicated intentionally for browser bundling).
 * Previously, each viewer file that needed tree search had its own copy.
 *
 * @see ./types.ts — PRDItemData definition
 * @see packages/rex/src/tree.ts — canonical server-side equivalents
 */

import type { PRDItemData } from "./types.js";

/**
 * Walk the tree to find an item by ID.
 * Returns the item or null if not found.
 */
export function findItemById(items: PRDItemData[], id: string): PRDItemData | null {
  for (const item of items) {
    if (item.id === id) return item;
    if (item.children) {
      const found = findItemById(item.children, id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Count total descendants (children, grandchildren, etc.) of an item.
 * Returns 0 if the item has no children.
 */
export function countDescendants(item: PRDItemData): number {
  if (!item.children || item.children.length === 0) return 0;
  let count = 0;
  for (const child of item.children) {
    count += 1 + countDescendants(child);
  }
  return count;
}

/**
 * Collect the IDs of all ancestors of the target item (excluding the target itself).
 * Returns an empty array if the target is not found or is a root item.
 */
export function getAncestorIds(items: PRDItemData[], targetId: string): string[] {
  const path: string[] = [];

  function walk(nodes: PRDItemData[]): boolean {
    for (const node of nodes) {
      if (node.id === targetId) return true;
      if (node.children) {
        path.push(node.id);
        if (walk(node.children)) return true;
        path.pop();
      }
    }
    return false;
  }

  walk(items);
  return path;
}

/**
 * Collect the IDs of an item and all its descendants (children, grandchildren, etc.).
 * Returns a Set containing the item's own ID plus every descendant ID.
 */
export function collectSubtreeIds(item: PRDItemData): Set<string> {
  const ids = new Set<string>([item.id]);
  if (item.children) {
    for (const child of item.children) {
      for (const id of collectSubtreeIds(child)) {
        ids.add(id);
      }
    }
  }
  return ids;
}

/**
 * Immutably remove an item by ID from a tree, returning a new array.
 * If the item is found, it and all its descendants are excluded.
 * Returns the original `items` reference when nothing changed (structural sharing).
 * Parent objects are shallow-copied only along the path to the removed item.
 */
export function removeItemById(items: PRDItemData[], id: string): PRDItemData[] {
  let changed = false;
  const result: PRDItemData[] = [];

  for (const item of items) {
    // Skip the target item entirely (removes it and all descendants)
    if (item.id === id) {
      changed = true;
      continue;
    }

    // Recurse into children to look for the target deeper in the tree
    if (item.children && item.children.length > 0) {
      const newChildren = removeItemById(item.children, id);
      if (newChildren !== item.children) {
        // A descendant was removed — shallow-copy this node with updated children
        result.push({ ...item, children: newChildren });
        changed = true;
        continue;
      }
    }

    result.push(item);
  }

  // Return the original reference when nothing changed (enables === checks)
  return changed ? result : items;
}
