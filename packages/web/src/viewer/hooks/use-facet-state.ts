/**
 * Facet filter state management with URL hash persistence.
 *
 * Manages active tag and status facets, syncing state to the URL hash
 * so filtered views are shareable. Reads initial state from the URL
 * on mount and writes back on every change.
 *
 * URL format: #facets=tag:foo,tag:bar,status:pending,status:blocked
 * Combined with existing hash params using & separator.
 *
 * @see ../components/prd-tree/facet-filter.ts — FacetFilter component
 * @see ../components/prd-tree/search-types.ts — SearchFacets type
 */

import { useState, useCallback, useEffect, useRef } from "preact/hooks";
import type {
  SearchFacets,
  SearchItemStatus,
} from "../components/prd-tree/search-types.js";

// ── URL hash encoding/decoding ───────────────────────────────────────────

const FACET_PARAM = "facets";

/** Parse facet state from the URL hash. */
function parseFacetsFromHash(): { tags: Set<string>; statuses: Set<SearchItemStatus> } {
  const tags = new Set<string>();
  const statuses = new Set<SearchItemStatus>();

  try {
    const hash = window.location.hash.slice(1); // remove leading #
    if (!hash) return { tags, statuses };

    const params = new URLSearchParams(hash);
    const facetStr = params.get(FACET_PARAM);
    if (!facetStr) return { tags, statuses };

    for (const part of facetStr.split(",")) {
      const colonIdx = part.indexOf(":");
      if (colonIdx === -1) continue;
      const type = part.slice(0, colonIdx);
      const value = decodeURIComponent(part.slice(colonIdx + 1));
      if (type === "tag" && value) {
        tags.add(value);
      } else if (type === "status" && value) {
        statuses.add(value as SearchItemStatus);
      }
    }
  } catch {
    // Ignore malformed hashes
  }

  return { tags, statuses };
}

/** Write facet state to the URL hash, preserving other hash params. */
function writeFacetsToHash(tags: Set<string>, statuses: Set<SearchItemStatus>): void {
  try {
    const hash = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);

    const parts: string[] = [];
    for (const tag of [...tags].sort()) {
      parts.push(`tag:${encodeURIComponent(tag)}`);
    }
    for (const status of [...statuses].sort()) {
      parts.push(`status:${encodeURIComponent(status)}`);
    }

    if (parts.length > 0) {
      params.set(FACET_PARAM, parts.join(","));
    } else {
      params.delete(FACET_PARAM);
    }

    const newHash = params.toString();
    const url = new URL(window.location.href);
    url.hash = newHash || "";
    window.history.replaceState(null, "", url.toString());
  } catch {
    // Ignore errors in URL manipulation
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface FacetState {
  /** Currently active tag facets. */
  activeTags: Set<string>;
  /** Currently active status facets (for search narrowing, not the tree-level filter). */
  activeSearchStatuses: Set<SearchItemStatus>;
  /** Combined facets object for searchTree(). null when no facets are active. */
  searchFacets: SearchFacets | undefined;
  /** Update active tags. */
  setActiveTags: (tags: Set<string>) => void;
  /** Update active search statuses. */
  setActiveSearchStatuses: (statuses: Set<SearchItemStatus>) => void;
  /** Clear all facets. */
  clearFacets: () => void;
  /** Whether any facet is currently active. */
  hasFacets: boolean;
}

export function useFacetState(): FacetState {
  // Initialize from URL hash
  const [activeTags, setActiveTagsRaw] = useState<Set<string>>(() => {
    const parsed = parseFacetsFromHash();
    return parsed.tags;
  });

  const [activeSearchStatuses, setActiveSearchStatusesRaw] = useState<Set<SearchItemStatus>>(() => {
    const parsed = parseFacetsFromHash();
    return parsed.statuses;
  });

  // Track whether we've initialized (skip first URL write)
  const initialized = useRef(false);

  // Sync to URL hash on state changes
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      return;
    }
    writeFacetsToHash(activeTags, activeSearchStatuses);
  }, [activeTags, activeSearchStatuses]);

  const setActiveTags = useCallback((tags: Set<string>) => {
    setActiveTagsRaw(tags);
  }, []);

  const setActiveSearchStatuses = useCallback((statuses: Set<SearchItemStatus>) => {
    setActiveSearchStatusesRaw(statuses);
  }, []);

  const clearFacets = useCallback(() => {
    setActiveTagsRaw(new Set());
    setActiveSearchStatusesRaw(new Set());
  }, []);

  const hasFacets = activeTags.size > 0 || activeSearchStatuses.size > 0;

  const searchFacets: SearchFacets | undefined = hasFacets
    ? { tags: activeTags, statuses: activeSearchStatuses }
    : undefined;

  return {
    activeTags,
    activeSearchStatuses,
    searchFacets,
    setActiveTags,
    setActiveSearchStatuses,
    clearFacets,
    hasFacets,
  };
}
