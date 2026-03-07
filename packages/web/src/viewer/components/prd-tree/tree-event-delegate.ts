/**
 * Event delegation hook for the PRD tree container.
 *
 * Replaces per-node click and keydown listeners with a single set of
 * delegated handlers on the `[role="tree"]` container. Each event
 * bubbles up and is routed to the correct callback by inspecting the target
 * and its closest `[data-node-id]` ancestor.
 *
 * Click delegation routes to the correct handler based on the target's
 * CSS class: `.prd-inline-add-btn` → add, `.prd-node-action-edit` → edit
 * (select), `.prd-node-action-status` → status picker,
 * `.prd-node-action-delete` → delete, `.prd-chevron` → toggle.
 *
 * Row clicks with keyboard modifiers drive multi-select: Ctrl/Cmd+click
 * toggles individual items, Shift+click extends a range selection, and
 * plain click selects a single item (deselecting all others).
 *
 * Net effect: from O(N * handlers-per-node) down to O(1) for click and
 * keydown — a dramatic reduction in total listener count for large trees.
 *
 * Individual NodeRow components only need `data-node-id` and
 * `data-has-children` attributes; no event handler props.
 *
 * @see ./prd-tree.ts — PRDTree component that consumes this hook
 */

import { useCallback, useRef } from "preact/hooks";
import type { PRDItemData } from "./types.js";

// ── Public interface ────────────────────────────────────────────────

/** Keyboard modifier state at the time of a click or keydown event. */
export interface SelectionModifiers {
  ctrlKey: boolean;
  shiftKey: boolean;
}

export interface TreeDelegationCallbacks {
  /** Look up an item by ID (should be O(1) — backed by a Map). */
  getItem: (id: string) => PRDItemData | null;
  /** Toggle expand/collapse for a node. */
  onToggle: (id: string) => void;
  /** Select an item for detail view (edit button). */
  onSelectItem?: (item: PRDItemData) => void;
  /**
   * Multi-select callback for bulk operations.
   * Replaces the previous checkbox-based toggle. The caller receives the
   * clicked item plus modifier state so it can implement ctrl-toggle,
   * shift-range, and plain-click-single-select semantics.
   */
  onBulkSelect?: (item: PRDItemData, modifiers: SelectionModifiers) => void;
  /** Open / toggle inline add form for a node. */
  onInlineAdd?: (item: PRDItemData) => void;
  /** Remove / delete an item. */
  onRemoveItem?: (item: PRDItemData) => void;
  /** Open inline status picker, passing the anchor button's bounding rect. */
  onStatusClick?: (item: PRDItemData, anchorRect: { left: number; top: number; bottom: number }) => void;
  /** Set of currently expanded node IDs (for keyboard arrow logic). */
  expanded: Set<string>;
}

export interface TreeDelegationHandlers {
  onClick: (e: MouseEvent) => void;
  onKeyDown: (e: KeyboardEvent) => void;
}

// ── Internal helpers ────────────────────────────────────────────────

/**
 * Walk up from the event target to the nearest `[data-node-id]` element.
 * Returns the element + extracted ID, or null if the target is outside any node.
 */
function findNodeRow(target: EventTarget | null): { el: HTMLElement; id: string } | null {
  const el = (target as HTMLElement)?.closest?.("[data-node-id]") as HTMLElement | null;
  if (!el) return null;
  const id = el.getAttribute("data-node-id");
  if (!id) return null;
  return { el, id };
}

// ── Hook ────────────────────────────────────────────────────────────

/**
 * Returns stable delegated event handlers for the tree container.
 *
 * Uses a ref to always read the *latest* callbacks without recreating the
 * handler closures — so the returned handler objects are referentially
 * stable across renders.
 */
export function useTreeEventDelegation(cb: TreeDelegationCallbacks): TreeDelegationHandlers {
  // Store latest callbacks in a ref so the memoized handlers never go stale.
  const cbRef = useRef(cb);
  cbRef.current = cb;

  // ── Click delegation ──────────────────────────────────────────────
  const onClick = useCallback((e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const node = findNodeRow(target);
    if (!node) return;

    const c = cbRef.current;
    const item = c.getItem(node.id);
    if (!item) return;

    const hasChildren = node.el.hasAttribute("data-has-children");

    // Inline add button
    if (target.closest(".prd-inline-add-btn")) {
      if (c.onInlineAdd) c.onInlineAdd(item);
      return;
    }

    // Edit action button — select item for detail panel
    if (target.closest(".prd-node-action-edit")) {
      if (c.onSelectItem) c.onSelectItem(item);
      return;
    }

    // Status action button — open inline status picker
    if (target.closest(".prd-node-action-status")) {
      if (c.onStatusClick) {
        const btn = target.closest(".prd-node-action-status") as HTMLElement;
        const rect = btn.getBoundingClientRect();
        c.onStatusClick(item, { left: rect.left, top: rect.top, bottom: rect.bottom });
      }
      return;
    }

    // Delete action button
    if (target.closest(".prd-node-action-delete")) {
      if (c.onRemoveItem) c.onRemoveItem(item);
      return;
    }

    // Chevron toggle
    if (target.classList.contains("prd-chevron")) {
      if (hasChildren) c.onToggle(node.id);
      return;
    }

    // Default: multi-select with modifier support, falling back to
    // detail-panel selection or expand/collapse toggle.
    if (c.onBulkSelect) {
      const modifiers: SelectionModifiers = {
        ctrlKey: e.ctrlKey || e.metaKey,
        shiftKey: e.shiftKey,
      };
      c.onBulkSelect(item, modifiers);
    } else if (c.onSelectItem) {
      c.onSelectItem(item);
    } else if (hasChildren) {
      c.onToggle(node.id);
    }
  }, []);

  // ── Keydown delegation ────────────────────────────────────────────
  const onKeyDown = useCallback((e: KeyboardEvent) => {
    const node = findNodeRow(e.target);
    if (!node) return;

    const c = cbRef.current;
    const item = c.getItem(node.id);
    if (!item) return;

    const hasChildren = node.el.hasAttribute("data-has-children");
    const isExpanded = c.expanded.has(node.id);

    // Enter / Space → toggle selection (like ctrl+click) or select item
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (c.onBulkSelect) {
        // Space/Enter toggles selection like ctrl+click
        c.onBulkSelect(item, { ctrlKey: true, shiftKey: false });
      } else if (c.onSelectItem) {
        c.onSelectItem(item);
      } else if (hasChildren) {
        c.onToggle(node.id);
      }
    }

    // Arrow right → expand collapsed node
    if (hasChildren && e.key === "ArrowRight" && !isExpanded) {
      e.preventDefault();
      c.onToggle(node.id);
    }

    // Arrow left → collapse expanded node
    if (hasChildren && e.key === "ArrowLeft" && isExpanded) {
      e.preventDefault();
      c.onToggle(node.id);
    }

    // Arrow up/down → navigate between visible tree items.
    // Shift+Arrow extends range selection to the newly focused item.
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      // e.currentTarget is the tree container where the handler is attached.
      const container = e.currentTarget as HTMLElement;
      const items = Array.from(container.querySelectorAll<HTMLElement>('[role="treeitem"]'));
      const idx = items.indexOf(node.el);
      if (idx < 0) return;
      const next = e.key === "ArrowDown" ? idx + 1 : idx - 1;
      if (next >= 0 && next < items.length) {
        items[next].focus();
        // Shift+Arrow → extend range selection to the next item
        if (e.shiftKey && c.onBulkSelect) {
          const nextId = items[next].getAttribute("data-node-id");
          if (nextId) {
            const nextItem = c.getItem(nextId);
            if (nextItem) {
              c.onBulkSelect(nextItem, { ctrlKey: false, shiftKey: true });
            }
          }
        }
      }
    }
  }, []);

  return { onClick, onKeyDown };
}
