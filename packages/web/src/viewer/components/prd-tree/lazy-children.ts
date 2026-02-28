/**
 * Lazy rendering wrapper for collapsed tree branches.
 *
 * Defers DOM creation for child nodes until the parent is expanded by the
 * user. On collapse, children are hidden via CSS immediately and then
 * unmounted from the DOM after a short delay. Rapid expand/collapse cycles
 * within the delay window reuse the existing DOM — preserving component
 * state and avoiding expensive re-mounts.
 *
 * Lifecycle:
 * 1. Initially collapsed → children not mounted (zero DOM cost)
 * 2. Parent expanded → children mount, CSS class reveals them
 * 3. Parent collapsed → CSS hides children; unmount scheduled after delay
 * 4. Rapid re-expand before unmount → cancels timer, children stay mounted
 *
 * @see ./prd-tree.ts — TreeNodes component that wraps child branches
 */

import { h } from "preact";
import type { VNode, ComponentChildren } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";

/**
 * Delay in milliseconds before unmounting children after a collapse.
 * During this window, rapid re-expansion reuses the existing DOM (no re-mount).
 * @internal Exported for testing.
 */
export const UNMOUNT_DELAY_MS = 300;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LazyChildrenProps {
  /** Whether the parent node is currently expanded. */
  isOpen: boolean;
  /** Render function that produces the child VDOM tree. Only called when
   *  children should be in the DOM — avoids VDOM creation when unmounted. */
  renderChildren: () => ComponentChildren;
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Wrapper that defers child DOM creation until the parent node is expanded.
 *
 * When `isOpen` transitions from false → true, children are mounted and
 * revealed via a CSS class. When `isOpen` transitions from true → false,
 * children are hidden immediately (CSS) and unmounted after
 * {@link UNMOUNT_DELAY_MS} to handle rapid toggling without flicker.
 */
export function LazyChildren({ isOpen, renderChildren }: LazyChildrenProps): VNode | null {
  // Whether children are currently mounted in the DOM.
  const [mounted, setMounted] = useState(isOpen);
  // Ref for the deferred-unmount timer.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isOpen) {
      // Expanding: mount immediately, cancel any pending unmount.
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setMounted(true);
    } else {
      // Collapsing: defer unmount so rapid re-expansion reuses the DOM.
      timerRef.current = setTimeout(() => {
        setMounted(false);
        timerRef.current = null;
      }, UNMOUNT_DELAY_MS);
    }
  }, [isOpen]);

  // Cleanup timer if the component itself unmounts (e.g. parent is removed).
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  if (!mounted) return null;

  return h(
    "div",
    {
      class: `prd-children${isOpen ? "" : " prd-children-collapsed"}`,
      role: "group",
      "aria-hidden": isOpen ? undefined : "true",
    },
    renderChildren(),
  );
}
