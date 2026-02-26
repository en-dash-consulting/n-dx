/**
 * Structural sharing for PRD tree updates.
 *
 * When new PRD data arrives (from a fetch or WebSocket), this module diffs
 * the old and new trees and returns a structurally-shared copy where
 * unchanged items keep their original object references. This enables
 * Preact's memoized components to skip re-rendering unchanged subtrees.
 *
 * Algorithm: Walk old and new trees in parallel by item ID. For each item,
 * compare scalar fields. If a node and all its descendants are identical,
 * return the old reference. Otherwise, return a shallow copy with only
 * the changed children replaced.
 *
 * Complexity: O(N) where N is the total number of nodes in the tree.
 * Memory: Only allocates new objects along changed paths — unchanged
 * subtrees share memory with the previous render cycle.
 *
 * @see ./prd-tree.ts — memoized NodeRow component that benefits from this
 * @see ../../../views/prd.ts — PRDView that applies this on data updates
 */

import type { PRDItemData, PRDDocumentData } from "./types.js";

// ── Scalar fields to compare ─────────────────────────────────────────

/**
 * Fields checked for item equality. Ordered by likelihood of change
 * (status changes are most common) for early-exit optimization.
 */
const SCALAR_KEYS: ReadonlyArray<keyof PRDItemData> = [
  "status",
  "title",
  "priority",
  "description",
  "startedAt",
  "completedAt",
  "failureReason",
];

// ── Item-level diffing ───────────────────────────────────────────────

/**
 * Compare two items' scalar fields and tags/blockedBy arrays.
 * Returns true if the item's own data (excluding children) is identical.
 */
function itemShallowEqual(a: PRDItemData, b: PRDItemData): boolean {
  // Fast path: same reference
  if (a === b) return true;

  // Check scalar fields
  for (const key of SCALAR_KEYS) {
    if (a[key] !== b[key]) return false;
  }

  // Compare tags arrays
  if (!arraysEqual(a.tags, b.tags)) return false;

  // Compare blockedBy arrays
  if (!arraysEqual(a.blockedBy, b.blockedBy)) return false;

  // Compare acceptanceCriteria arrays
  if (!arraysEqual(a.acceptanceCriteria, b.acceptanceCriteria)) return false;

  return true;
}

/** Shallow comparison of two optional string arrays. */
function arraysEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ── Tree-level diffing ──────────────────────────────────────────────

/**
 * Diff two item arrays and return a structurally-shared copy.
 *
 * For each item in `next`, looks up the corresponding item in `prev`
 * (by ID). If found and unchanged (including all descendants), the old
 * reference is reused. If the item changed or is new, a new object is
 * created with only the changed parts.
 *
 * Returns the original `prev` reference when nothing changed at all.
 */
export function diffItems(
  prev: PRDItemData[],
  next: PRDItemData[],
): PRDItemData[] {
  // Fast path: same reference (no change)
  if (prev === next) return prev;

  // Build ID → item map from prev for O(1) lookup
  const prevById = new Map<string, PRDItemData>();
  for (const item of prev) {
    prevById.set(item.id, item);
  }

  // If the arrays differ in length or item order, we need a new array.
  // Even if lengths match, items may have been reordered.
  let changed = prev.length !== next.length;

  const result: PRDItemData[] = new Array(next.length);

  for (let i = 0; i < next.length; i++) {
    const newItem = next[i];
    const oldItem = prevById.get(newItem.id);

    if (!oldItem) {
      // New item — no sharing possible
      result[i] = newItem;
      changed = true;
      continue;
    }

    // Check if same position (order preserved)
    if (!changed && (i >= prev.length || prev[i].id !== newItem.id)) {
      changed = true;
    }

    // Diff children recursively
    const oldChildren = oldItem.children ?? [];
    const newChildren = newItem.children ?? [];
    const sharedChildren = diffItems(oldChildren, newChildren);
    const childrenChanged = sharedChildren !== oldChildren;

    // Check if the item's own data changed
    const selfChanged = !itemShallowEqual(oldItem, newItem);

    if (!selfChanged && !childrenChanged) {
      // Completely unchanged — reuse old reference
      result[i] = oldItem;
    } else {
      // Something changed — create a new object with shared children
      changed = true;
      result[i] = {
        ...newItem,
        children: sharedChildren.length > 0 ? sharedChildren : newItem.children,
      };
    }
  }

  return changed ? result : prev;
}

/**
 * Diff two PRD documents and return a structurally-shared copy.
 *
 * The returned document reuses the old `items` reference if nothing
 * changed, enabling === checks in Preact components.
 */
export function diffDocument(
  prev: PRDDocumentData | null,
  next: PRDDocumentData,
): PRDDocumentData {
  if (!prev) return next;

  const sharedItems = diffItems(prev.items, next.items);
  const titleChanged = prev.title !== next.title;
  const schemaChanged = prev.schema !== next.schema;

  if (!titleChanged && !schemaChanged && sharedItems === prev.items) {
    // Completely unchanged — return the old reference
    return prev;
  }

  return {
    ...next,
    items: sharedItems,
  };
}

// ── Incremental update helpers ───────────────────────────────────────

/**
 * Apply a partial update to a single item in the tree.
 *
 * Returns a structurally-shared copy where only the target item and
 * its ancestors are new objects. All other subtrees keep their old
 * references.
 *
 * Returns the original `items` reference if the target is not found.
 */
export function applyItemUpdate(
  items: PRDItemData[],
  itemId: string,
  updates: Partial<PRDItemData>,
): PRDItemData[] {
  let changed = false;
  const result: PRDItemData[] = new Array(items.length);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (item.id === itemId) {
      // Found the target — apply updates
      result[i] = { ...item, ...updates };
      changed = true;
      continue;
    }

    // Recurse into children
    if (item.children && item.children.length > 0) {
      const newChildren = applyItemUpdate(item.children, itemId, updates);
      if (newChildren !== item.children) {
        // Target was found in a descendant — shallow-copy this ancestor
        result[i] = { ...item, children: newChildren };
        changed = true;
        continue;
      }
    }

    // Unchanged — reuse reference
    result[i] = item;
  }

  return changed ? result : items;
}

/**
 * Remove an item from the tree by ID.
 *
 * Returns a structurally-shared copy. This is a re-export of the
 * existing `removeItemById` from tree-utils.ts for API consistency,
 * but consumers should prefer the tree-utils version directly.
 *
 * @see ./tree-utils.ts — removeItemById
 */
export { removeItemById } from "./tree-utils.js";
