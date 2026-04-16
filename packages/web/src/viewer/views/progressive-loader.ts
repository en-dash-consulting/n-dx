/**
 * Progressive tree loading for large PRD datasets.
 *
 * Renders tree nodes in configurable chunks rather than all at once. A flat
 * "node budget" controls how many visible nodes are rendered: the tree is
 * walked in render order and items beyond the budget are excluded. Parents
 * whose children are partially truncated keep their structural position so
 * scroll position is stable.
 *
 * The module exposes:
 * - Pure functions for counting and slicing visible nodes (easily testable)
 * - A Preact hook (`useProgressiveLoader`) for chunk state management
 * - A `LoadMoreIndicator` component for the "load more" UI
 *
 * Search and filter operations always work on the **full** item tree —
 * progressive loading only limits the **rendering** pass, not the data.
 *
 * @see ../components/prd-tree/prd-tree.ts   — integrating component
 * @see ../components/prd-tree/compute.ts    — itemMatchesFilter used for visibility checks
 */

import { h } from "preact";
import type { VNode } from "preact";
import { useState, useCallback, useEffect, useRef } from "preact/hooks";
import type { PRDItemData, ItemStatus } from "../components/prd-tree/types.js";
import { itemMatchesFilter } from "../components/prd-tree/compute.js";

/** Default number of nodes to render per chunk. */
export const DEFAULT_CHUNK_SIZE = 50;

/**
 * Minimum item count before progressive loading activates.
 * Trees smaller than this render in full without any chunking UI.
 */
export const PROGRESSIVE_THRESHOLD = 50;

// ── Pure counting ────────────────────────────────────────────────────

/**
 * Count visible nodes in a tree, respecting the status filter.
 *
 * A node is "visible" when it (or any descendant) matches the active status
 * filter — the same logic `itemMatchesFilter` uses. Each visible node
 * contributes 1 to the count, and visible children are counted recursively.
 *
 * Complexity: O(N) where N = total nodes in tree.
 */
export function countVisibleNodes(
  items: PRDItemData[],
  activeStatuses: Set<ItemStatus>,
): number {
  let count = 0;
  for (const item of items) {
    if (!itemMatchesFilter(item, activeStatuses)) continue;
    count++;
    if (item.children && item.children.length > 0) {
      count += countVisibleNodes(item.children, activeStatuses);
    }
  }
  return count;
}

// ── Tree slicing ─────────────────────────────────────────────────────

/**
 * Mutable budget counter passed by reference through the recursive slice.
 * Using an object avoids threading a return value through every call.
 */
interface SliceBudget {
  remaining: number;
}

/**
 * Result of a progressive tree slice operation.
 */
export interface ProgressiveSlice {
  /** Items to render (may be a subset of the original tree). */
  items: PRDItemData[];
  /** Number of visible nodes in this slice. */
  renderedCount: number;
  /** Total visible nodes in the unsliced tree. */
  totalCount: number;
}

/**
 * Internal recursive slicer. Walks `items` in render order, consuming from
 * `budget.remaining` for each visible node. Stops including siblings once
 * the budget reaches zero. Children are sliced recursively with the shared
 * budget object, so a deep subtree naturally shares the budget with its
 * later siblings.
 *
 * Structural sharing: when all children of a node survive the slice, the
 * original item reference is reused (no shallow copy). Only items at the
 * truncation boundary get a new object.
 */
function sliceItems(
  items: PRDItemData[],
  activeStatuses: Set<ItemStatus>,
  budget: SliceBudget,
): { items: PRDItemData[]; fullyRendered: boolean } {
  const result: PRDItemData[] = [];
  let fullyRendered = true;

  for (const item of items) {
    if (budget.remaining <= 0) {
      fullyRendered = false;
      break;
    }
    if (!itemMatchesFilter(item, activeStatuses)) continue;

    // This node consumes 1 from the budget.
    budget.remaining--;

    if (item.children && item.children.length > 0) {
      const childSlice = sliceItems(item.children, activeStatuses, budget);

      if (childSlice.fullyRendered) {
        // All visible children survived — reuse the original item reference.
        result.push(item);
      } else {
        // Some children truncated — shallow-copy with sliced children.
        result.push({
          ...item,
          children: childSlice.items.length > 0 ? childSlice.items : undefined,
        });
        fullyRendered = false;
      }
    } else {
      result.push(item);
    }
  }

  return { items: result, fullyRendered };
}

/**
 * Slice a tree to fit within a node budget.
 *
 * Returns the original `items` array unchanged when the total visible count
 * fits within the limit (common case for small trees).
 *
 * @param items          Full PRD item tree
 * @param activeStatuses Status filter (from StatusFilter component)
 * @param limit          Maximum number of visible nodes to include
 * @returns Progressive slice with rendered/total counts
 */
export function sliceVisibleTree(
  items: PRDItemData[],
  activeStatuses: Set<ItemStatus>,
  limit: number,
): ProgressiveSlice {
  const totalCount = countVisibleNodes(items, activeStatuses);

  if (totalCount <= limit) {
    return { items, renderedCount: totalCount, totalCount };
  }

  const budget: SliceBudget = { remaining: limit };
  const sliced = sliceItems(items, activeStatuses, budget);
  const renderedCount = limit - budget.remaining;

  return { items: sliced.items, renderedCount, totalCount };
}

// ── Hook ─────────────────────────────────────────────────────────────

export interface ProgressiveLoaderState {
  /** Current node rendering limit. */
  limit: number;
  /** Whether there are more nodes beyond the current limit. */
  hasMore: boolean;
  /** Load the next chunk of nodes. */
  loadMore: () => void;
  /** Load all remaining nodes at once. */
  loadAll: () => void;
  /** Whether a chunk load is in progress (brief transition state). */
  isLoading: boolean;
  /** Number of visible nodes that will be rendered. */
  renderedCount: number;
  /** Total visible nodes in the full tree. */
  totalCount: number;
  /** Whether progressive loading is active (tree exceeds threshold). */
  isActive: boolean;
}

/**
 * Manages progressive loading state for a tree of the given size.
 *
 * The hook auto-resets the limit when `totalCount` changes (e.g. after a
 * filter change or data refresh), ensuring the user always starts from a
 * reasonable chunk size.
 *
 * A brief `isLoading` transition (one frame) is triggered on `loadMore` /
 * `loadAll` to give the browser a paint opportunity before the potentially
 * heavy render of additional nodes.
 *
 * @param totalCount Total visible nodes (from countVisibleNodes)
 * @param chunkSize  Number of nodes per chunk (DEFAULT_CHUNK_SIZE)
 */
export function useProgressiveLoader(
  totalCount: number,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): ProgressiveLoaderState {
  const isActive = totalCount > PROGRESSIVE_THRESHOLD;
  const [limit, setLimit] = useState(() =>
    isActive ? chunkSize : totalCount,
  );
  const [isLoading, setIsLoading] = useState(false);
  const rafRef = useRef<number>(0);

  // Reset limit when total changes (filter/data update).
  // Use a ref to track the previous total to avoid unnecessary resets.
  const prevTotalRef = useRef(totalCount);
  useEffect(() => {
    if (prevTotalRef.current !== totalCount) {
      prevTotalRef.current = totalCount;
      setLimit(isActive ? chunkSize : totalCount);
      setIsLoading(false);
    }
  }, [totalCount, chunkSize, isActive]);

  // Cleanup rAF on unmount.
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const loadMore = useCallback(() => {
    setIsLoading(true);
    // Defer the actual limit increase by one frame so the browser can
    // paint the loading indicator before the heavy render kicks in.
    rafRef.current = requestAnimationFrame(() => {
      setLimit((prev) => Math.min(prev + chunkSize, totalCount));
      setIsLoading(false);
    });
  }, [chunkSize, totalCount]);

  const loadAll = useCallback(() => {
    setIsLoading(true);
    rafRef.current = requestAnimationFrame(() => {
      setLimit(totalCount);
      setIsLoading(false);
    });
  }, [totalCount]);

  const effectiveLimit = isActive ? Math.min(limit, totalCount) : totalCount;

  return {
    limit: effectiveLimit,
    hasMore: isActive && effectiveLimit < totalCount,
    loadMore,
    loadAll,
    isLoading,
    renderedCount: Math.min(effectiveLimit, totalCount),
    totalCount,
    isActive,
  };
}

// ── Load More indicator component ────────────────────────────────────

export interface LoadMoreIndicatorProps {
  /** Number of nodes currently rendered. */
  renderedCount: number;
  /** Total visible nodes in the tree. */
  totalCount: number;
  /** Number of nodes to add per chunk. */
  chunkSize: number;
  /** Whether a load operation is in progress. */
  isLoading: boolean;
  /** Load the next chunk. */
  onLoadMore: () => void;
  /** Load all remaining nodes. */
  onLoadAll: () => void;
}

/**
 * "Load More" indicator shown below the tree when progressive loading is
 * active and there are more nodes to reveal.
 */
export function LoadMoreIndicator({
  renderedCount,
  totalCount,
  chunkSize,
  isLoading,
  onLoadMore,
  onLoadAll,
}: LoadMoreIndicatorProps): VNode {
  const remaining = totalCount - renderedCount;
  const nextChunk = Math.min(remaining, chunkSize);

  return h(
    "div",
    { class: "prd-load-more", role: "status", "aria-live": "polite" },
    // Progress info
    h(
      "div",
      { class: "prd-load-more-info" },
      `Showing ${renderedCount} of ${totalCount} nodes`,
    ),
    // Progress bar
    h(
      "div",
      {
        class: "prd-load-more-progress",
        role: "progressbar",
        "aria-valuenow": String(renderedCount),
        "aria-valuemin": "0",
        "aria-valuemax": String(totalCount),
        "aria-label": `${renderedCount} of ${totalCount} nodes loaded`,
      },
      h("div", {
        class: "prd-load-more-progress-fill",
        style: `width: ${Math.round((renderedCount / totalCount) * 100)}%`,
      }),
    ),
    // Action buttons
    h(
      "div",
      { class: "prd-load-more-actions" },
      h(
        "button",
        {
          class: "prd-load-more-btn prd-load-more-btn-primary",
          onClick: onLoadMore,
          disabled: isLoading,
          "aria-label": `Load ${nextChunk} more nodes`,
        },
        isLoading ? "Loading\u2026" : `Load ${nextChunk} more`,
      ),
      h(
        "button",
        {
          class: "prd-load-more-btn prd-load-more-btn-secondary",
          onClick: onLoadAll,
          disabled: isLoading,
          "aria-label": `Load all ${remaining} remaining nodes`,
        },
        isLoading ? "Loading\u2026" : `Load all (${remaining})`,
      ),
    ),
  );
}
