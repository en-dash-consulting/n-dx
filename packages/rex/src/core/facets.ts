/**
 * Faceted classification for PRD items.
 *
 * Facets are stored as prefixed tags on items: `component:auth`, `concern:security`.
 * This module provides helpers to read, write, and query facet values without
 * requiring schema changes to PRDItem — facets piggyback on the existing `tags` array.
 *
 * @module rex/core/facets
 */

import type { PRDItem, RexConfig } from "../schema/index.js";
import { walkTree } from "./tree.js";

/** Separator between facet key and value in a tag string. */
const FACET_SEP = ":";

// ── Tag-level helpers ────────────────────────────────────────────────────

/** Check whether a tag string is a facet tag (contains exactly one `:`). */
export function isFacetTag(tag: string): boolean {
  const idx = tag.indexOf(FACET_SEP);
  return idx > 0 && idx < tag.length - 1 && tag.indexOf(FACET_SEP, idx + 1) === -1;
}

/** Parse a facet tag into key/value, or return null if not a facet. */
export function parseFacetTag(tag: string): { key: string; value: string } | null {
  const idx = tag.indexOf(FACET_SEP);
  if (idx <= 0 || idx >= tag.length - 1) return null;
  // Reject if there's a second colon (not a simple key:value facet)
  if (tag.indexOf(FACET_SEP, idx + 1) !== -1) return null;
  return { key: tag.slice(0, idx), value: tag.slice(idx + 1) };
}

/** Build a facet tag string from key and value. */
function buildFacetTag(key: string, value: string): string {
  return `${key}${FACET_SEP}${value}`;
}

// ── Item-level accessors ─────────────────────────────────────────────────

/** Get the facet value for a given key on an item, or undefined if not set. */
export function getFacetValue(item: PRDItem, key: string): string | undefined {
  if (!item.tags) return undefined;
  const prefix = key + FACET_SEP;
  for (const tag of item.tags) {
    if (tag.startsWith(prefix)) {
      return tag.slice(prefix.length);
    }
  }
  return undefined;
}

/**
 * Set a facet value on an item (mutates `item.tags`).
 * Replaces an existing value for the same key, or appends if new.
 */
export function setFacetValue(item: PRDItem, key: string, value: string): void {
  const newTag = buildFacetTag(key, value);
  const prefix = key + FACET_SEP;
  if (!item.tags) {
    item.tags = [newTag];
    return;
  }
  const idx = item.tags.findIndex((t) => t.startsWith(prefix));
  if (idx >= 0) {
    item.tags[idx] = newTag;
  } else {
    item.tags.push(newTag);
  }
}

/** Remove a facet key from an item (mutates `item.tags`). Returns true if removed. */
export function removeFacet(item: PRDItem, key: string): boolean {
  if (!item.tags) return false;
  const prefix = key + FACET_SEP;
  const before = item.tags.length;
  item.tags = item.tags.filter((t) => !t.startsWith(prefix));
  return item.tags.length < before;
}

/** Get all facets on an item as a key→value record. */
export function getItemFacets(item: PRDItem): Record<string, string> {
  const result: Record<string, string> = {};
  if (!item.tags) return result;
  for (const tag of item.tags) {
    const parsed = parseFacetTag(tag);
    if (parsed) {
      result[parsed.key] = parsed.value;
    }
  }
  return result;
}

// ── Collection-level queries ─────────────────────────────────────────────

/** Find all items (flattened from tree) matching a facet key/value. */
export function getItemsByFacet(items: PRDItem[], key: string, value: string): PRDItem[] {
  const results: PRDItem[] = [];
  const target = buildFacetTag(key, value);
  for (const { item } of walkTree(items)) {
    if (item.tags?.includes(target)) {
      results.push(item);
    }
  }
  return results;
}

/** Group all items (flattened) by the value of a facet key. Items without the facet are excluded. */
export function groupByFacet(items: PRDItem[], key: string): Map<string, PRDItem[]> {
  const groups = new Map<string, PRDItem[]>();
  const prefix = key + FACET_SEP;
  for (const { item } of walkTree(items)) {
    if (!item.tags) continue;
    for (const tag of item.tags) {
      if (tag.startsWith(prefix)) {
        const value = tag.slice(prefix.length);
        const list = groups.get(value);
        if (list) {
          list.push(item);
        } else {
          groups.set(value, [item]);
        }
        break; // one match per item per facet key
      }
    }
  }
  return groups;
}

// ── Facet config type ────────────────────────────────────────────────────

/** Configuration for a single facet dimension. */
export interface FacetConfig {
  label: string;
  values: string[];
  required?: boolean;
}

// ── Suggestion engine ────────────────────────────────────────────────────

/** A suggested facet value for an item. */
export interface FacetSuggestion {
  key: string;
  value: string;
  reason: string;
}

/**
 * Suggest facets for an item based on keyword matching and parent inheritance.
 *
 * Returns suggestions only — does not mutate the item.
 */
export function suggestFacets(
  item: PRDItem,
  facetConfig: Record<string, FacetConfig>,
  parent?: PRDItem,
): FacetSuggestion[] {
  const suggestions: FacetSuggestion[] = [];
  const existing = getItemFacets(item);
  const searchText = `${item.title} ${item.description ?? ""}`.toLowerCase();

  for (const [key, config] of Object.entries(facetConfig)) {
    // Skip if already set
    if (existing[key]) continue;

    // 1. Inherit from parent
    if (parent) {
      const parentValue = getFacetValue(parent, key);
      if (parentValue && config.values.includes(parentValue)) {
        suggestions.push({
          key,
          value: parentValue,
          reason: `inherited from parent "${parent.title}"`,
        });
        continue;
      }
    }

    // 2. Keyword match against configured values
    for (const value of config.values) {
      if (searchText.includes(value.toLowerCase())) {
        suggestions.push({
          key,
          value,
          reason: `keyword match in title/description`,
        });
        break;
      }
    }
  }

  return suggestions;
}

/**
 * Compute facet distribution: for each configured facet, count items per value.
 */
export function computeFacetDistribution(
  items: PRDItem[],
  facetConfig: Record<string, FacetConfig>,
): Record<string, Record<string, number>> {
  const dist: Record<string, Record<string, number>> = {};

  for (const key of Object.keys(facetConfig)) {
    const counts: Record<string, number> = {};
    const groups = groupByFacet(items, key);
    for (const [value, group] of groups) {
      counts[value] = group.length;
    }
    dist[key] = counts;
  }

  return dist;
}
