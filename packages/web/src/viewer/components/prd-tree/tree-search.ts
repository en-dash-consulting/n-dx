/**
 * Pure search/filter functions for the PRD tree.
 *
 * Provides case-insensitive substring matching against item titles and
 * descriptions, with optional tag and status facet filters that narrow
 * results further. Returns both the set of matching item IDs and their
 * ancestor IDs (to preserve tree context in filtered views).
 *
 * @see ./prd-tree.ts — integrating component
 * @see ./virtual-scroll.ts — flattenVisibleTree respects search results
 */

import type {
  SearchablePRDItem,
  SearchFacets,
} from "./search-types.js";
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
 * Check if a single item passes the facet filters (ignoring text query).
 * Tag facets use AND logic: item must have every selected tag.
 * Status facets use OR logic: item status must be one of the selected statuses.
 */
function itemPassesFacets(item: SearchablePRDItem, facets: SearchFacets): boolean {
  // Status facet: OR logic — item's status must be in the set
  if (facets.statuses && facets.statuses.size > 0) {
    if (!facets.statuses.has(item.status)) return false;
  }

  // Tag facet: AND logic — item must have ALL selected tags
  if (facets.tags && facets.tags.size > 0) {
    const itemTags = item.tags ?? [];
    for (const tag of facets.tags) {
      if (!itemTags.includes(tag)) return false;
    }
  }

  return true;
}

/**
 * Search the PRD tree for items matching a query string and/or facet filters.
 *
 * Matching rules:
 * - Case-insensitive substring match against title and description
 * - Tag facets narrow results to items having ALL selected tags (AND)
 * - Status facets narrow results to items matching ANY selected status (OR)
 * - Text query and facets combine with AND logic
 * - Empty query with no facets returns an empty result (caller shows full tree)
 * - Ancestor nodes of matches are included in visibleIds/expandIds
 *
 * Complexity: O(N) where N = total tree nodes.
 */
export function searchTree(
  items: SearchablePRDItem[],
  query: string,
  facets?: SearchFacets,
): TreeSearchResult {
  const trimmed = query.trim().toLowerCase();
  const hasTextQuery = trimmed.length > 0;
  const hasFacets = facets != null && (
    (facets.tags != null && facets.tags.size > 0) ||
    (facets.statuses != null && facets.statuses.size > 0)
  );

  if (!hasTextQuery && !hasFacets) {
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
  function walk(nodes: SearchablePRDItem[], ancestors: string[]): boolean {
    let anyMatch = false;

    for (const item of nodes) {
      // Text matching (skip if no text query — facets-only mode)
      let textMatch = true;
      if (hasTextQuery) {
        const titleMatch = item.title.toLowerCase().includes(trimmed);
        const descMatch = item.description
          ? item.description.toLowerCase().includes(trimmed)
          : false;
        textMatch = titleMatch || descMatch;
      }

      // Facet matching
      const facetMatch = hasFacets ? itemPassesFacets(item, facets!) : true;

      const selfMatch = textMatch && facetMatch;

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

// ── Tag collection ──────────────────────────────────────────────────────────

/**
 * Collect all unique tags from the PRD tree, sorted alphabetically.
 * Used to populate tag facet chips dynamically.
 */
export function collectAllTags(items: SearchablePRDItem[]): string[] {
  const tags = new Set<string>();
  function walk(nodes: SearchablePRDItem[]) {
    for (const item of nodes) {
      if (item.tags) {
        for (const tag of item.tags) {
          tags.add(tag);
        }
      }
      if (item.children) walk(item.children);
    }
  }
  walk(items);
  return [...tags].sort();
}

// ── Branch collection & filtering ──────────────────────────────────────────

/**
 * Collect all unique branch names from the PRD tree, sorted alphabetically.
 * Used to populate the branch filter dropdown.
 */
export function collectAllBranches(items: SearchablePRDItem[]): string[] {
  const branches = new Set<string>();
  function walk(nodes: SearchablePRDItem[]) {
    for (const item of nodes) {
      if (item.branch) branches.add(item.branch);
      if (item.children) walk(item.children);
    }
  }
  walk(items);
  return [...branches].sort();
}

/**
 * Build the set of item IDs that should remain visible when filtering by branch.
 *
 * Returns the IDs of items whose `branch` matches the given value, plus the
 * IDs of all their ancestor nodes (so tree structure context is preserved).
 * Ancestors are detected the same way `searchTree` detects them — by walking
 * the tree and propagating upward when any descendant matches.
 *
 * Complexity: O(N) where N = total tree nodes.
 */
export function buildBranchVisibleSet(
  items: SearchablePRDItem[],
  branch: string,
): Set<string> {
  const visibleIds = new Set<string>();

  function walk(nodes: SearchablePRDItem[], ancestors: string[]): boolean {
    let anyMatch = false;
    for (const node of nodes) {
      const childAncestors = [...ancestors, node.id];
      const childMatch = node.children ? walk(node.children, childAncestors) : false;
      const selfMatch = node.branch === branch;

      if (selfMatch || childMatch) {
        visibleIds.add(node.id);
        for (const aid of ancestors) visibleIds.add(aid);
        anyMatch = true;
      }
    }
    return anyMatch;
  }

  walk(items, []);
  return visibleIds;
}

/**
 * Check if an item (or any descendant) is in the visible set.
 * Used by flattenVisibleTree when a search is active.
 */
export function itemMatchesSearch(
  item: SearchablePRDItem,
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
