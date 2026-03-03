/**
 * Virtual scrolling engine for the PRD tree.
 *
 * Flattens the hierarchical tree into a linear array respecting expansion
 * state and status filters, then computes which items fall within the
 * current scroll viewport plus a configurable buffer zone. Only those
 * items are rendered, dramatically reducing DOM node count for large trees.
 *
 * The module exposes:
 * - Pure functions for flattening and range computation (easily testable)
 * - A Preact hook (`useVirtualScroll`) for scroll state management
 *
 * @see ./prd-tree.ts — integrating component
 * @see ./compute.ts  — itemMatchesFilter used for visibility checks
 */

import { useState, useEffect, useRef, useMemo, useCallback } from "preact/hooks";
import type { PRDItemData, ItemStatus } from "./types.js";
import { itemMatchesFilter } from "./compute.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/** A flattened tree node with depth and structural metadata for rendering. */
export interface FlatNode {
  /** The original PRD item data. */
  item: PRDItemData;
  /** Depth level in the tree (0 = root). */
  depth: number;
  /** Whether this node is currently expanded (children visible). */
  isExpanded: boolean;
  /** Whether this node has children (regardless of expansion state). */
  hasChildren: boolean;
}

/** Configuration for the virtual scroll engine. */
export interface VirtualScrollConfig {
  /** Estimated height per row in pixels. Default: DEFAULT_ITEM_HEIGHT. */
  itemHeight?: number;
  /** Extra items to render above and below viewport. Default: DEFAULT_BUFFER_COUNT. */
  bufferCount?: number;
}

/** Range of indices to render. */
export interface VisibleRange {
  /** First index to render (inclusive). */
  start: number;
  /** Last index to render (exclusive). */
  end: number;
  /** Pixel offset for the spacer before visible items. */
  offsetY: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default estimated row height in pixels. */
export const DEFAULT_ITEM_HEIGHT = 40;

/** Default number of buffer items above and below viewport. */
export const DEFAULT_BUFFER_COUNT = 10;

// ── Pure functions ────────────────────────────────────────────────────────────

/**
 * Flatten a hierarchical tree into a linear array of FlatNodes.
 *
 * Only includes nodes that:
 * 1. Match the status filter (or have descendants that match)
 * 2. Are within expanded parent branches
 *
 * The result preserves render order (depth-first, pre-order traversal).
 * This is the same ordering that the recursive TreeNodes renderer produced,
 * but in a flat array suitable for virtual scrolling.
 *
 * Complexity: O(V) where V = visible nodes in the expanded tree.
 */
export function flattenVisibleTree(
  items: PRDItemData[],
  expanded: Set<string>,
  activeStatuses: Set<ItemStatus>,
  depth: number = 0,
): FlatNode[] {
  const result: FlatNode[] = [];

  for (const item of items) {
    if (!itemMatchesFilter(item, activeStatuses)) continue;

    const children = item.children ?? [];
    const hasChildren = children.length > 0;
    const isExpanded = expanded.has(item.id);

    result.push({ item, depth, isExpanded, hasChildren });

    if (hasChildren && isExpanded) {
      const childNodes = flattenVisibleTree(children, expanded, activeStatuses, depth + 1);
      for (const cn of childNodes) result.push(cn);
    }
  }

  return result;
}

/**
 * Compute the visible range of indices for the current scroll position.
 *
 * Returns start/end indices and the pixel offset for positioning.
 * Buffer items are included above and below the viewport to prevent
 * flashing during rapid scrolling.
 *
 * When containerHeight is 0 (unmeasured or jsdom), returns the full
 * range so all items render — virtual scrolling activates once the
 * container has a measured height.
 */
export function computeVisibleRange(
  scrollTop: number,
  containerHeight: number,
  totalCount: number,
  itemHeight: number = DEFAULT_ITEM_HEIGHT,
  bufferCount: number = DEFAULT_BUFFER_COUNT,
): VisibleRange {
  if (totalCount === 0) {
    return { start: 0, end: 0, offsetY: 0 };
  }

  // Fallback: container not yet measured — render everything.
  if (containerHeight <= 0) {
    return { start: 0, end: totalCount, offsetY: 0 };
  }

  const startIdx = Math.floor(scrollTop / itemHeight);
  const visibleCount = Math.ceil(containerHeight / itemHeight);

  const start = Math.max(0, startIdx - bufferCount);
  const end = Math.min(totalCount, startIdx + visibleCount + bufferCount);
  const offsetY = start * itemHeight;

  return { start, end, offsetY };
}

/**
 * Find the index of an item in the flat node list by ID.
 * Returns -1 if not found.
 */
export function findFlatNodeIndex(flatNodes: FlatNode[], itemId: string): number {
  for (let i = 0; i < flatNodes.length; i++) {
    if (flatNodes[i].item.id === itemId) return i;
  }
  return -1;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseVirtualScrollOptions {
  /** Flattened visible tree nodes. */
  flatNodes: FlatNode[];
  /** Ref to the scroll container element. */
  containerRef: { current: HTMLDivElement | null };
  /** Virtual scroll configuration. */
  config?: VirtualScrollConfig;
}

export interface UseVirtualScrollResult {
  /** Subset of flatNodes currently visible in the viewport + buffer. */
  visibleNodes: FlatNode[];
  /** Total virtual height of the full tree in pixels. */
  totalHeight: number;
  /** Pixel offset for the spacer before visible items. */
  offsetY: number;
  /** Height in pixels for the spacer after visible items. */
  afterSpaceHeight: number;
  /** Scroll event handler to attach to the container. */
  onScroll: (e: Event) => void;
  /** Scroll the container to center a specific item index. */
  scrollToIndex: (index: number) => void;
  /** Number of items currently rendered. */
  renderedCount: number;
  /** Total number of items in the flattened tree. */
  totalCount: number;
  /** Whether virtual scrolling is active (container has measured height). */
  isActive: boolean;
}

/**
 * Preact hook that manages virtual scroll state.
 *
 * Observes the container element's height via ResizeObserver and
 * computes which items to render based on the current scroll position.
 *
 * When the container height is unmeasured (0), all items are returned
 * as visible — virtual scrolling activates once the browser reports
 * a real height. This handles initial render, jsdom tests, and SSR.
 */
export function useVirtualScroll({
  flatNodes,
  containerRef,
  config = {},
}: UseVirtualScrollOptions): UseVirtualScrollResult {
  const itemHeight = config.itemHeight ?? DEFAULT_ITEM_HEIGHT;
  const bufferCount = config.bufferCount ?? DEFAULT_BUFFER_COUNT;

  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  // Measure container height on mount and resize.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    setContainerHeight(el.clientHeight);

    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  // Reset scrollTop when flatNodes changes significantly (e.g. filter change).
  const prevLengthRef = useRef(flatNodes.length);
  useEffect(() => {
    if (prevLengthRef.current !== flatNodes.length) {
      prevLengthRef.current = flatNodes.length;
      // Don't reset scroll on small changes (expand/collapse).
      // Only reset when the change is dramatic (e.g. filter switch).
      if (Math.abs(prevLengthRef.current - flatNodes.length) > flatNodes.length * 0.5) {
        setScrollTop(0);
      }
    }
  }, [flatNodes.length]);

  const totalHeight = flatNodes.length * itemHeight;
  const isActive = containerHeight > 0;

  const range = useMemo(
    () => computeVisibleRange(scrollTop, containerHeight, flatNodes.length, itemHeight, bufferCount),
    [scrollTop, containerHeight, flatNodes.length, itemHeight, bufferCount],
  );

  const visibleNodes = useMemo(
    () => flatNodes.slice(range.start, range.end),
    [flatNodes, range.start, range.end],
  );

  const afterSpaceHeight = Math.max(0, totalHeight - range.offsetY - visibleNodes.length * itemHeight);

  const onScroll = useCallback((e: Event) => {
    const target = e.target as HTMLElement;
    setScrollTop(target.scrollTop);
  }, []);

  const scrollToIndex = useCallback((index: number) => {
    const el = containerRef.current;
    if (!el) return;
    // Center the item in the viewport.
    const targetScroll = Math.max(0, index * itemHeight - containerHeight / 2 + itemHeight / 2);
    el.scrollTop = targetScroll;
  }, [containerRef, itemHeight, containerHeight]);

  return {
    visibleNodes,
    totalHeight,
    offsetY: range.offsetY,
    afterSpaceHeight,
    onScroll,
    scrollToIndex,
    renderedCount: visibleNodes.length,
    totalCount: flatNodes.length,
    isActive,
  };
}
