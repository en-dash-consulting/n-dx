/**
 * Pure search/filter functions for the PRD tree.
 *
 * Provides case-insensitive substring matching against item titles and
 * descriptions, returning both the set of matching item IDs and their
 * ancestor IDs (to preserve tree context in filtered views).
 *
 * @see ./prd-tree.ts — integrating component
 * @see ./virtual-scroll.ts — flattenVisibleTree respects search results
 */

import type { PRDItemData } from "./types.js";
import type { ComponentChild } from "preact";
import { h } from "preact";

// ── Search result types ─────────────────────────────────────────────────────

export interface TreeSearchResult {
  /** IDs of items whose title or description matched the query. */
  matchIds: Set<string>;
  /** IDs of ancestor nodes that should remain visible for tree context. */
  ancestorIds: Set<string>;
  /** Combined set: matchIds ∪ ancestorIds — all nodes to show. */
  visibleIds: Set<string>;
  /** IDs of all ancestors that should be auto-expanded to reveal matches. */
  expandIds: Set<string>;
  /** Total number of direct matches. */
  matchCount: number;
}

// ── Core search ──────────────────────────────────────────────────────────────

/**
 * Search the PRD tree for items matching a query string.
 *
 * Matching rules:
 * - Case-insensitive substring match against title and description
 * - Empty/blank query returns an empty result (caller shows full tree)
 * - Ancestor nodes of matches are included in visibleIds/expandIds
 *
 * Complexity: O(N) where N = total tree nodes.
 */
export function searchTree(
  items: PRDItemData[],
  query: string,
): TreeSearchResult {
  const trimmed = query.trim().toLowerCase();

  if (!trimmed) {
    return {
      matchIds: new Set(),
      ancestorIds: new Set(),
      visibleIds: new Set(),
      expandIds: new Set(),
      matchCount: 0,
    };
  }

  const matchIds = new Set<string>();
  const ancestorIds = new Set<string>();

  // Walk the tree, collecting matches and propagating ancestor info upward.
  function walk(nodes: PRDItemData[], ancestors: string[]): boolean {
    let anyMatch = false;

    for (const item of nodes) {
      const titleMatch = item.title.toLowerCase().includes(trimmed);
      const descMatch = item.description
        ? item.description.toLowerCase().includes(trimmed)
        : false;
      const selfMatch = titleMatch || descMatch;

      // Recurse into children first to detect descendant matches.
      const childAncestors = [...ancestors, item.id];
      const childMatch = item.children
        ? walk(item.children, childAncestors)
        : false;

      if (selfMatch) {
        matchIds.add(item.id);
        // Mark all ancestors as visible
        for (const aid of ancestors) {
          ancestorIds.add(aid);
        }
        anyMatch = true;
      }

      if (childMatch) {
        // Item is an ancestor of a match — already added by the child walk
        anyMatch = true;
      }
    }

    return anyMatch;
  }

  walk(items, []);

  const visibleIds = new Set<string>([...matchIds, ...ancestorIds]);
  // Expand all ancestors so matches are visible
  const expandIds = new Set<string>(ancestorIds);

  return {
    matchIds,
    ancestorIds,
    visibleIds,
    expandIds,
    matchCount: matchIds.size,
  };
}

/**
 * Check if an item (or any descendant) is in the visible set.
 * Used by flattenVisibleTree when a search is active.
 */
export function itemMatchesSearch(
  item: PRDItemData,
  visibleIds: Set<string>,
): boolean {
  if (visibleIds.has(item.id)) return true;
  if (item.children) {
    return item.children.some((child) => itemMatchesSearch(child, visibleIds));
  }
  return false;
}

// ── Text highlighting ────────────────────────────────────────────────────────

/**
 * Highlight all occurrences of `query` within `text`, returning an array
 * of string and VNode fragments suitable for Preact rendering.
 *
 * Uses case-insensitive matching. Non-matching segments are plain strings;
 * matching segments are wrapped in `<mark class="prd-search-highlight">`.
 *
 * Returns `[text]` unchanged when query is empty.
 */
export function highlightSearchText(
  text: string,
  query: string,
): ComponentChild[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed || !text) return [text];

  const lower = text.toLowerCase();
  const fragments: ComponentChild[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const idx = lower.indexOf(trimmed, cursor);
    if (idx === -1) {
      fragments.push(text.slice(cursor));
      break;
    }

    // Text before match
    if (idx > cursor) {
      fragments.push(text.slice(cursor, idx));
    }

    // Matched text
    fragments.push(
      h("mark", { class: "prd-search-highlight" }, text.slice(idx, idx + trimmed.length)),
    );

    cursor = idx + trimmed.length;
  }

  return fragments;
}
