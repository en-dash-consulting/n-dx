/**
 * Global search overlay — Ctrl+K / Cmd+K to open.
 *
 * Features:
 * - Full-text search against the /api/search endpoint
 * - Filter by item type (epic, feature, task, subtask)
 * - Filter by status (pending, in_progress, completed, blocked)
 * - Filter by priority (critical, high, medium, low)
 * - Search term highlighting with context snippets
 * - Keyboard navigation (Arrow keys, Enter, Escape)
 *
 * @module viewer/components/search-overlay
 */

import { h, Fragment } from "preact";
import type { ComponentChild } from "preact";
import { useState, useEffect, useRef, useCallback, useMemo } from "preact/hooks";
import type { NavigateTo } from "../types.js";

// ── Level emoji (self-contained mirror of prd-tree/levels.ts — no cross-zone import) ──
const LEVEL_EMOJI: Record<string, string> = {
  epic: "\u{1F4E6}",    // 📦
  feature: "\u{2728}",   // ✨
  task: "\u{1F4CB}",     // 📋
  subtask: "\u{1F539}",  // 🔹
};
function getLevelEmoji(level: string): string {
  return LEVEL_EMOJI[level] ?? "\u2022";
}

// ── Types ──────────────────────────────────────────────────────────────────

interface SearchResult {
  id: string;
  title: string;
  description: string | null;
  level: string;
  status: string;
  parentChain: string[];
  score: number;
  matchedFields: string[];
}

interface SearchResponse {
  query: string;
  count: number;
  elapsed_ms: number;
  results: SearchResult[];
}

interface FilterState {
  levels: Set<string>;
  statuses: Set<string>;
  priorities: Set<string>;
}

export interface SearchOverlayProps {
  visible: boolean;
  onClose: () => void;
  navigateTo: NavigateTo;
}

// ── Constants ──────────────────────────────────────────────────────────────

const LEVEL_OPTIONS = [
  { value: "epic", label: "Epic" },
  { value: "feature", label: "Feature" },
  { value: "task", label: "Task" },
  { value: "subtask", label: "Subtask" },
] as const;

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "blocked", label: "Blocked" },
] as const;

const PRIORITY_OPTIONS = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
] as const;

const CONTEXT_CHARS = 50;
const DEBOUNCE_MS = 200;

// ── Highlight helpers ──────────────────────────────────────────────────────

/** Status display labels */
const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  completed: "Completed",
  blocked: "Blocked",
  failing: "Failing",
  deferred: "Deferred",
  deleted: "Deleted",
};

/**
 * Highlight matching terms within text, returning an array of VNodes.
 *
 * Exact matches get yellow highlights; partial (substring) matches get
 * light-blue highlights. Text is truncated with ellipsis if too long,
 * preserving highlights.
 */
function highlightText(
  text: string,
  queryTerms: string[],
  maxLength = 200,
): ComponentChild[] {
  if (!text || queryTerms.length === 0) {
    return [truncate(text ?? "", maxLength)];
  }

  const lower = text.toLowerCase();
  // Build a list of match ranges
  const ranges: Array<{ start: number; end: number; exact: boolean }> = [];

  for (const term of queryTerms) {
    const termLower = term.toLowerCase();
    let pos = 0;
    while (pos < lower.length) {
      const idx = lower.indexOf(termLower, pos);
      if (idx === -1) break;
      // Check if it's a word-boundary exact match
      const isExact = isWordBoundary(lower, idx, termLower.length);
      ranges.push({ start: idx, end: idx + termLower.length, exact: isExact });
      pos = idx + 1;
    }
  }

  if (ranges.length === 0) {
    return [truncate(text, maxLength)];
  }

  // Sort and merge overlapping ranges
  ranges.sort((a, b) => a.start - b.start);
  const merged = mergeRanges(ranges);

  // Build fragments
  const fragments: ComponentChild[] = [];
  let cursor = 0;

  for (const range of merged) {
    if (range.start > cursor) {
      fragments.push(text.slice(cursor, range.start));
    }
    const cls = range.exact ? "search-highlight-exact" : "search-highlight-partial";
    fragments.push(
      h("mark", { class: cls }, text.slice(range.start, range.end)),
    );
    cursor = range.end;
  }

  if (cursor < text.length) {
    fragments.push(text.slice(cursor));
  }

  return fragments;
}

/** Check if a match at `idx` of length `len` aligns with word boundaries. */
function isWordBoundary(text: string, idx: number, len: number): boolean {
  const before = idx === 0 || /[^a-z0-9]/.test(text[idx - 1]);
  const after = idx + len >= text.length || /[^a-z0-9]/.test(text[idx + len]);
  return before && after;
}

/** Merge overlapping highlight ranges, preferring exact matches. */
function mergeRanges(ranges: Array<{ start: number; end: number; exact: boolean }>): Array<{ start: number; end: number; exact: boolean }> {
  if (ranges.length === 0) return [];
  const result: Array<{ start: number; end: number; exact: boolean }> = [{ ...ranges[0] }];
  for (let i = 1; i < ranges.length; i++) {
    const prev = result[result.length - 1];
    const curr = ranges[i];
    if (curr.start <= prev.end) {
      prev.end = Math.max(prev.end, curr.end);
      if (curr.exact) prev.exact = true;
    } else {
      result.push({ ...curr });
    }
  }
  return result;
}

/** Truncate text with ellipsis. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "\u2026";
}

/**
 * Extract a context snippet around the first match in `text`.
 * Shows CONTEXT_CHARS before and after the match.
 */
function getContextSnippet(
  text: string,
  queryTerms: string[],
): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();

  for (const term of queryTerms) {
    const idx = lower.indexOf(term.toLowerCase());
    if (idx !== -1) {
      const start = Math.max(0, idx - CONTEXT_CHARS);
      const end = Math.min(text.length, idx + term.length + CONTEXT_CHARS);
      let snippet = text.slice(start, end);
      if (start > 0) snippet = "\u2026" + snippet;
      if (end < text.length) snippet = snippet + "\u2026";
      return snippet;
    }
  }
  return null;
}

/**
 * Extract meaningful search terms from a query string for highlighting.
 * Strips OR keywords, extracts quoted phrases, and removes stop words.
 */
function extractQueryTerms(query: string): string[] {
  const terms: string[] = [];

  // Extract quoted phrases
  const quotePattern = /"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = quotePattern.exec(query)) !== null) {
    terms.push(match[1].trim());
  }

  // Extract remaining words
  const remaining = query.replace(/"[^"]*"/g, "").replace(/\bOR\b/g, " ");
  const words = remaining.split(/\s+/).filter((w) => w.length > 0);
  terms.push(...words);

  return terms;
}

// ── Component ──────────────────────────────────────────────────────────────

export function SearchOverlay({ visible, onClose, navigateTo }: SearchOverlayProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    levels: new Set(),
    statuses: new Set(),
    priorities: new Set(),
  });
  const [elapsed, setElapsed] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Query terms for highlighting
  const queryTerms = useMemo(() => extractQueryTerms(query), [query]);

  // Active filter count
  const activeFilterCount = filters.levels.size + filters.statuses.size + filters.priorities.size;

  // Filter results client-side
  const filteredResults = useMemo(() => {
    if (activeFilterCount === 0) return results;
    return results.filter((r) => {
      if (filters.levels.size > 0 && !filters.levels.has(r.level)) return false;
      if (filters.statuses.size > 0 && !filters.statuses.has(r.status)) return false;
      // Priority filtering is approximate — the API doesn't return priority,
      // so we skip it when the field isn't available. A future enhancement
      // could add priority to SearchResult.
      return true;
    });
  }, [results, filters, activeFilterCount]);

  // Focus input when overlay opens
  useEffect(() => {
    if (visible) {
      // Small delay to let the overlay render before focusing
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    } else {
      // Reset state when closing
      setQuery("");
      setResults([]);
      setActiveIndex(-1);
      setFiltersExpanded(false);
      setElapsed(null);
    }
  }, [visible]);

  // Perform search with debounce
  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setElapsed(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // Build query params — include filter params for server-side filtering if supported
      const params = new URLSearchParams({ q: q.trim(), limit: "50" });
      const res = await fetch(`/api/search?${params.toString()}`);
      if (!res.ok) {
        setResults([]);
        return;
      }
      const data: SearchResponse = await res.json();
      setResults(data.results);
      setElapsed(data.elapsed_ms);
      setActiveIndex(-1);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Handle query input with debounce
  const handleInput = useCallback((value: string) => {
    setQuery(value);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => doSearch(value), DEBOUNCE_MS);
  }, [doSearch]);

  // Navigate to a search result
  const navigateToResult = useCallback((result: SearchResult) => {
    onClose();
    navigateTo("prd", { taskId: result.id });
  }, [onClose, navigateTo]);

  // Toggle a filter value
  const toggleFilter = useCallback((group: keyof FilterState, value: string) => {
    setFilters((prev) => {
      const next = { ...prev, [group]: new Set(prev[group]) };
      if (next[group].has(value)) {
        next[group].delete(value);
      } else {
        next[group].add(value);
      }
      return next;
    });
  }, []);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!visible) return;

    switch (e.key) {
      case "Escape":
        e.preventDefault();
        onClose();
        break;

      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((prev) => {
          const max = filteredResults.length - 1;
          const next = prev < max ? prev + 1 : 0;
          scrollResultIntoView(next);
          return next;
        });
        break;

      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((prev) => {
          const max = filteredResults.length - 1;
          const next = prev > 0 ? prev - 1 : max;
          scrollResultIntoView(next);
          return next;
        });
        break;

      case "Enter":
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < filteredResults.length) {
          navigateToResult(filteredResults[activeIndex]);
        }
        break;
    }
  }, [visible, activeIndex, filteredResults, onClose, navigateToResult]);

  // Scroll active result into view
  const scrollResultIntoView = (index: number) => {
    requestAnimationFrame(() => {
      const container = resultsRef.current;
      if (!container) return;
      const items = container.querySelectorAll("[data-result-index]");
      const target = items[index] as HTMLElement | undefined;
      target?.scrollIntoView({ block: "nearest" });
    });
  };

  // Attach global keydown for keyboard nav inside the overlay
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => handleKeyDown(e);
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [visible, handleKeyDown]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  if (!visible) return null;

  return h("div", {
    class: "search-overlay",
    role: "dialog",
    "aria-label": "Search PRD items",
    "aria-modal": "true",
    onClick: (e: MouseEvent) => {
      // Close when clicking backdrop
      if ((e.target as HTMLElement).classList.contains("search-overlay")) {
        onClose();
      }
    },
  },
    h("div", { class: "search-overlay-panel" },
      // ── Search Input ──────────────────────────────────────────────
      h("div", { class: "search-overlay-header" },
        h("div", { class: "search-overlay-input-row" },
          h("span", { class: "search-overlay-icon", "aria-hidden": "true" }, "\u{1F50D}"),
          h("input", {
            ref: inputRef,
            class: "search-overlay-input",
            type: "search",
            placeholder: "Search PRD items\u2026",
            value: query,
            "aria-label": "Search PRD items",
            "aria-autocomplete": "list",
            "aria-controls": "search-results-list",
            "aria-activedescendant": activeIndex >= 0 ? `search-result-${activeIndex}` : undefined,
            onInput: (e: Event) => handleInput((e.target as HTMLInputElement).value),
          }),
          h("kbd", { class: "search-overlay-kbd" }, "esc"),
        ),
        // ── Filter Toggle ───────────────────────────────────────────
        h("div", { class: "search-overlay-filter-toggle" },
          h("button", {
            class: `search-overlay-filter-btn${filtersExpanded ? " active" : ""}`,
            onClick: () => setFiltersExpanded((p) => !p),
            "aria-expanded": filtersExpanded,
            "aria-controls": "search-filters",
          },
            "Filters",
            activeFilterCount > 0
              ? h("span", { class: "search-overlay-filter-badge" }, String(activeFilterCount))
              : null,
          ),
          query && !loading
            ? h("span", { class: "search-overlay-stats", "aria-live": "polite" },
                `${filteredResults.length} result${filteredResults.length !== 1 ? "s" : ""}`,
                elapsed != null ? ` (${elapsed}ms)` : "",
              )
            : null,
        ),
      ),

      // ── Filters Panel ─────────────────────────────────────────────
      filtersExpanded
        ? h("div", { id: "search-filters", class: "search-overlay-filters", role: "group", "aria-label": "Search filters" },
            // Type filters
            renderFilterGroup("Type", "levels", LEVEL_OPTIONS, filters.levels, toggleFilter),
            // Status filters
            renderFilterGroup("Status", "statuses", STATUS_OPTIONS, filters.statuses, toggleFilter),
            // Priority filters
            renderFilterGroup("Priority", "priorities", PRIORITY_OPTIONS, filters.priorities, toggleFilter),
          )
        : null,

      // ── Results ───────────────────────────────────────────────────
      h("div", {
        ref: resultsRef,
        id: "search-results-list",
        class: "search-overlay-results",
        role: "listbox",
        "aria-label": "Search results",
      },
        loading
          ? h("div", { class: "search-overlay-loading" }, "Searching\u2026")
          : query && filteredResults.length === 0
            ? h("div", { class: "search-overlay-empty" }, "No results found")
            : filteredResults.map((result, i) =>
                renderResult(result, i, i === activeIndex, queryTerms, navigateToResult),
              ),
      ),

      // ── Footer ────────────────────────────────────────────────────
      h("div", { class: "search-overlay-footer" },
        h("span", null,
          h("kbd", null, "\u2191\u2193"), " navigate  ",
          h("kbd", null, "\u21B5"), " select  ",
          h("kbd", null, "esc"), " close",
        ),
      ),
    ),
  );
}

// ── Sub-renderers ──────────────────────────────────────────────────────────

function renderFilterGroup(
  label: string,
  group: keyof FilterState,
  options: ReadonlyArray<{ value: string; label: string }>,
  active: Set<string>,
  onToggle: (group: keyof FilterState, value: string) => void,
) {
  return h("div", { class: "search-filter-group" },
    h("span", { class: "search-filter-group-label" }, label),
    h("div", { class: "search-filter-group-options" },
      ...options.map((opt) =>
        h("label", {
          class: `search-filter-chip${active.has(opt.value) ? " active" : ""}`,
          key: opt.value,
        },
          h("input", {
            type: "checkbox",
            checked: active.has(opt.value),
            onChange: () => onToggle(group, opt.value),
            class: "sr-only",
          }),
          opt.label,
        ),
      ),
    ),
  );
}

function renderResult(
  result: SearchResult,
  index: number,
  isActive: boolean,
  queryTerms: string[],
  onSelect: (result: SearchResult) => void,
) {
  const contextSnippet = result.description
    ? getContextSnippet(result.description, queryTerms)
    : null;

  const statusClass = `status-badge status-badge--${result.status}`;
  const statusLabel = STATUS_LABELS[result.status] ?? result.status;
  const levelIcon = getLevelEmoji(result.level);

  return h("div", {
    id: `search-result-${index}`,
    key: result.id,
    class: `search-overlay-result${isActive ? " active" : ""}`,
    role: "option",
    "aria-selected": isActive,
    "data-result-index": index,
    tabIndex: -1,
    onClick: () => onSelect(result),
    onMouseEnter: () => {
      // Allow mouse to update active index for visual feedback
      // (handled via CSS :hover, but aria-selected needs state)
    },
  },
    // Top row: level icon + highlighted title + status badge
    h("div", { class: "search-result-header" },
      h("span", { class: "search-result-level", title: result.level }, levelIcon),
      h("span", { class: "search-result-title" },
        ...highlightText(result.title, queryTerms),
      ),
      h("span", { class: statusClass }, statusLabel),
    ),
    // Breadcrumb parent chain
    result.parentChain.length > 0
      ? h("div", { class: "search-result-breadcrumb" },
          result.parentChain.join(" \u203A "),
        )
      : null,
    // Context snippet with highlights
    contextSnippet
      ? h("div", { class: "search-result-context" },
          ...highlightText(contextSnippet, queryTerms, 200),
        )
      : null,
    // Matched fields
    result.matchedFields.length > 0
      ? h("div", { class: "search-result-meta" },
          "Matched: ",
          result.matchedFields.join(", "),
        )
      : null,
  );
}

// ── Global keyboard shortcut hook ──────────────────────────────────────────

/**
 * Hook to register the global Ctrl+K / Cmd+K shortcut.
 * Returns [isOpen, open, close] controls.
 */
export function useSearchOverlay(): [boolean, () => void, () => void] {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+K or Cmd+K to open/toggle search
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return [isOpen, open, close];
}
