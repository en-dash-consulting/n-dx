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
