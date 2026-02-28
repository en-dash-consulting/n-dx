/**
 * Event delegation hook for the PRD tree container.
 *
 * Replaces per-node click, contextmenu, and keydown listeners with a single
 * set of delegated handlers on the `[role="tree"]` container. Each event
 * bubbles up and is routed to the correct callback by inspecting the target
 * and its closest `[data-node-id]` ancestor.
 *
 * Net effect: from O(N * handlers-per-node) down to O(1) for click,
 * contextmenu, and keydown — a dramatic reduction in total listener count
 * for large trees.
 *
 * Individual NodeRow components only need `data-node-id` and
 * `data-has-children` attributes; no event handler props.
 *
 * Checkbox `onChange` is intentionally NOT delegated — Preact's controlled
 * input model requires `onChange` on the element itself to stay in sync.
 * The delegated click handler detects checkbox clicks and returns early.
 *
 * @see ./prd-tree.ts — PRDTree component that consumes this hook
 */

import { useCallback, useRef } from "preact/hooks";
import type { PRDItemData } from "./types.js";

// ── Public interface ────────────────────────────────────────────────

export interface TreeDelegationCallbacks {
  /** Look up an item by ID (should be O(1) — backed by a Map). */
  getItem: (id: string) => PRDItemData | null;
  /** Toggle expand/collapse for a node. */
  onToggle: (id: string) => void;
  /** Select an item for detail view. */
  onSelectItem?: (item: PRDItemData) => void;
  /** Open / toggle inline add form for a node. */
  onInlineAdd?: (item: PRDItemData) => void;
  /** Remove / delete an item. */
  onRemoveItem?: (item: PRDItemData) => void;
  /** Show context menu at viewport position for an item. */
  onContextMenu?: (item: PRDItemData, x: number, y: number) => void;
  /** Set of currently expanded node IDs (for keyboard arrow logic). */
  expanded: Set<string>;
}

export interface TreeDelegationHandlers {
  onClick: (e: MouseEvent) => void;
  onContextMenu: (e: MouseEvent) => void;
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

    // Checkbox — handled by its own onChange; bail out to avoid double-toggle.
    if (
      target.classList.contains("prd-bulk-checkbox") ||
      target.closest(".prd-bulk-checkbox-wrapper")
    ) {
      return;
    }

    // Inline add button
    if (target.closest(".prd-inline-add-btn")) {
      if (c.onInlineAdd) c.onInlineAdd(item);
      return;
    }

    // Inline delete button
    if (target.closest(".prd-inline-delete-btn")) {
      if (c.onRemoveItem) c.onRemoveItem(item);
      return;
    }

    // Chevron toggle
    if (target.classList.contains("prd-chevron")) {
      if (hasChildren) c.onToggle(node.id);
      return;
    }

    // Default: select the item, or toggle if no onSelect provided.
    if (c.onSelectItem) {
      c.onSelectItem(item);
    } else if (hasChildren) {
      c.onToggle(node.id);
    }
  }, []);

  // ── Context-menu delegation ───────────────────────────────────────
  const onContextMenu = useCallback((e: MouseEvent) => {
    const node = findNodeRow(e.target);
    if (!node) return;

    const c = cbRef.current;
    const item = c.getItem(node.id);
    if (!item) return;

    // Only show when there are actions available (delete).
    if (!c.onRemoveItem || !c.onContextMenu) return;

    e.preventDefault();
    e.stopPropagation();
    c.onContextMenu(item, e.clientX, e.clientY);
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

    // Enter / Space → select or toggle
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (c.onSelectItem) {
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

    // Arrow up/down → navigate between visible tree items
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
      }
    }
  }, []);

  return { onClick, onContextMenu, onKeyDown };
}
