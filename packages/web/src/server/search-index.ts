/**
 * In-memory search index for PRD items.
 *
 * Builds an inverted index from PRD item titles, descriptions, acceptance
 * criteria, and tags. Supports fuzzy/partial matching, exact phrase matching
 * with quotes, multi-word AND/OR queries, and relevance-weighted scoring
 * (title matches rank higher than descriptions).
 *
 * The index is lazy — built on first search — and auto-invalidated when the
 * PRD file changes (checked via mtime on each search request).
 *
 * @module web/server/search-index
 */

import { statSync } from "node:fs";
import { join } from "node:path";
import type { PRDItem, PRDDocument } from "./rex-gateway.js";
import { walkTree } from "./rex-gateway.js";
import { loadPRDSync } from "./prd-io.js";

// ── Types ──────────────────────────────────────────────────────────────────

/** A single indexed item with pre-extracted text fields. */
export interface IndexedItem {
  id: string;
  title: string;
  description: string;
  level: string;
  status: string;
  tags: string[];
  /** All text from acceptance criteria joined. */
  acceptanceCriteria: string;
  /** Parent chain titles for breadcrumb display. */
  parentChain: string[];
}

/** A search result returned by the index. */
export interface SearchResult {
  id: string;
  title: string;
  description: string | null;
  level: string;
  status: string;
  parentChain: string[];
  /** Relevance score — higher is better. */
  score: number;
  /** Which fields matched the query. */
  matchedFields: string[];
}

/** Parsed representation of a user query. */
export interface ParsedQuery {
  /** Exact phrases extracted from quoted segments. */
  phrases: string[];
  /** Individual terms after removing quoted segments. */
  terms: string[];
  /** Whether OR logic is requested (default is AND). */
  isOr: boolean;
}

// ── Field weights ──────────────────────────────────────────────────────────

/** Relevance weights per field — title matches score highest. */
const FIELD_WEIGHTS: Record<string, number> = {
  title: 10,
  tags: 6,
  description: 3,
  acceptanceCriteria: 2,
};

// ── Stop words (minimal set to avoid removing meaningful search terms) ─────

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "shall",
  "should", "may", "might", "must", "can", "could",
  "and", "but", "or", "nor", "not", "so", "if", "then",
  "for", "in", "on", "at", "to", "of", "by", "with", "from",
]);

// ── Inverted index entry ───────────────────────────────────────────────────

interface TermEntry {
  /** Item ID. */
  id: string;
  /** Which field this term was found in. */
  field: string;
  /** Position of the term in the field's token list (for phrase matching). */
  position: number;
}

// ── Query parsing ──────────────────────────────────────────────────────────

/**
 * Parse a raw query string into structured components.
 *
 * Supports:
 * - `"exact phrase"` — quoted segments for exact phrase matching
 * - `word1 word2` — AND logic (all words must match) by default
 * - `word1 OR word2` — OR logic when "OR" appears between terms
 * - Case insensitive
 */
export function parseQuery(raw: string): ParsedQuery {
  const phrases: string[] = [];
  let remaining = raw;

  // Extract quoted phrases
  const quotePattern = /"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = quotePattern.exec(raw)) !== null) {
    const phrase = match[1].trim().toLowerCase();
    if (phrase.length > 0) {
      phrases.push(phrase);
    }
  }
  remaining = remaining.replace(quotePattern, " ").trim();

  // Detect OR logic: if "OR" appears as a standalone word (case-sensitive)
  const isOr = /\bOR\b/.test(remaining);
  remaining = remaining.replace(/\bOR\b/g, " ");

  // Tokenize remaining terms
  const terms = remaining
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOP_WORDS.has(t));

  return { phrases, terms, isOr };
}

// ── Tokenizer ──────────────────────────────────────────────────────────────

/** Tokenize a text string into lowercase alphanumeric tokens. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

// ── SearchIndex class ──────────────────────────────────────────────────────

export class SearchIndex {
  /** Inverted index: term → list of (itemId, field, position). */
  private invertedIndex = new Map<string, TermEntry[]>();

  /** Full indexed items keyed by ID. */
  private items = new Map<string, IndexedItem>();

  /** Lowercased full-text per field per item for phrase matching. */
  private fieldText = new Map<string, Map<string, string>>();

  /** File mtime when the index was last built (for staleness check). */
  private builtAtMtime: number = 0;

  /** Path to prd.json (set once). */
  private prdPath: string;

  /** Rex directory path for centralized PRD loading. */
  private rexDir: string;

  constructor(rexDir: string) {
    this.rexDir = rexDir;
    this.prdPath = join(rexDir, "prd.json");
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Search the index with the given raw query string.
   *
   * Automatically rebuilds the index if the PRD file has changed since the
   * last build. Returns results sorted by relevance score descending.
   */
  search(query: string, limit = 50): SearchResult[] {
    this.ensureFresh();

    const parsed = parseQuery(query);
    if (parsed.terms.length === 0 && parsed.phrases.length === 0) {
      return [];
    }

    // Score each item
    const scores = new Map<string, { score: number; matchedFields: Set<string> }>();

    // Score term matches (supports partial/fuzzy prefix matching)
    for (const term of parsed.terms) {
      const termHits = this.findTermMatches(term);
      for (const hit of termHits) {
        let entry = scores.get(hit.id);
        if (!entry) {
          entry = { score: 0, matchedFields: new Set() };
          scores.set(hit.id, entry);
        }
        entry.score += FIELD_WEIGHTS[hit.field] ?? 1;
        entry.matchedFields.add(hit.field);
      }
    }

    // Score phrase matches
    for (const phrase of parsed.phrases) {
      for (const [id, fields] of this.fieldText) {
        for (const [field, text] of fields) {
          if (text.includes(phrase)) {
            let entry = scores.get(id);
            if (!entry) {
              entry = { score: 0, matchedFields: new Set() };
              scores.set(id, entry);
            }
            // Phrases are worth more — they indicate exact intent
            entry.score += (FIELD_WEIGHTS[field] ?? 1) * 2;
            entry.matchedFields.add(field);
          }
        }
      }
    }

    // Apply AND/OR filtering
    const results: SearchResult[] = [];
    const totalQueryParts = parsed.terms.length + parsed.phrases.length;

    for (const [id, { score, matchedFields }] of scores) {
      const item = this.items.get(id);
      if (!item) continue;

      if (!parsed.isOr && totalQueryParts > 1) {
        // AND mode: verify all terms and phrases matched
        const matchedParts = this.countMatchedParts(id, parsed);
        if (matchedParts < totalQueryParts) continue;
      }

      results.push({
        id: item.id,
        title: item.title,
        description: item.description || null,
        level: item.level,
        status: item.status,
        parentChain: item.parentChain,
        score,
        matchedFields: [...matchedFields],
      });
    }

    // Sort by score descending
    results.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      // Tiebreak: title match first, then alphabetical
      const aTitle = a.matchedFields.includes("title") ? 0 : 1;
      const bTitle = b.matchedFields.includes("title") ? 0 : 1;
      if (aTitle !== bTitle) return aTitle - bTitle;
      return a.title.localeCompare(b.title);
    });

    return results.slice(0, limit);
  }

  /**
   * Force a rebuild of the index from the current PRD file.
   * Returns the number of items indexed.
   */
  rebuild(): number {
    this.invertedIndex.clear();
    this.items.clear();
    this.fieldText.clear();

    const doc = this.loadPRD();
    if (!doc) {
      this.builtAtMtime = 0;
      return 0;
    }

    // Walk the tree and index every item
    for (const { item, parents } of walkTree(doc.items)) {
      this.indexItem(item, parents);
    }

    // Record the mtime we built from
    this.builtAtMtime = this.getPrdMtime();
    return this.items.size;
  }

  /** Invalidate the cached index, forcing a rebuild on next search. */
  invalidate(): void {
    this.builtAtMtime = 0;
  }

  /** Number of items currently in the index. */
  get size(): number {
    return this.items.size;
  }

  /** Number of unique terms in the inverted index. */
  get termCount(): number {
    return this.invertedIndex.size;
  }

  // ── Internal ───────────────────────────────────────────────────────────

  /** Ensure the index is fresh by checking PRD file mtime. */
  private ensureFresh(): void {
    const currentMtime = this.getPrdMtime();
    if (currentMtime !== this.builtAtMtime || this.builtAtMtime === 0) {
      this.rebuild();
    }
  }

  /** Get the PRD file modification time (0 if file doesn't exist). */
  private getPrdMtime(): number {
    try {
      return statSync(this.prdPath).mtimeMs;
    } catch {
      return 0;
    }
  }

  /** Load the PRD document from disk. */
  private loadPRD(): PRDDocument | null {
    return loadPRDSync(this.rexDir);
  }

  /** Index a single PRD item. */
  private indexItem(item: PRDItem, parents: PRDItem[]): void {
    const indexed: IndexedItem = {
      id: item.id,
      title: item.title,
      description: item.description ?? "",
      level: item.level,
      status: item.status,
      tags: item.tags ?? [],
      acceptanceCriteria: (item.acceptanceCriteria ?? []).join(" "),
      parentChain: parents.map((p) => p.title),
    };

    this.items.set(item.id, indexed);

    // Build per-field lowercased text for phrase matching
    const fields = new Map<string, string>();
    fields.set("title", indexed.title.toLowerCase());
    fields.set("description", indexed.description.toLowerCase());
    fields.set("acceptanceCriteria", indexed.acceptanceCriteria.toLowerCase());
    fields.set("tags", indexed.tags.join(" ").toLowerCase());
    this.fieldText.set(item.id, fields);

    // Tokenize and add to inverted index
    this.addTokens(item.id, "title", tokenize(indexed.title));
    this.addTokens(item.id, "description", tokenize(indexed.description));
    this.addTokens(item.id, "acceptanceCriteria", tokenize(indexed.acceptanceCriteria));
    this.addTokens(item.id, "tags", tokenize(indexed.tags.join(" ")));
  }

  /** Add tokens to the inverted index for a specific item and field. */
  private addTokens(id: string, field: string, tokens: string[]): void {
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      let entries = this.invertedIndex.get(token);
      if (!entries) {
        entries = [];
        this.invertedIndex.set(token, entries);
      }
      entries.push({ id, field, position: i });
    }
  }

  /**
   * Find all items that match a term, supporting prefix/partial matching.
   * Returns deduplicated hits (one per item-field combination).
   */
  private findTermMatches(term: string): TermEntry[] {
    const results: TermEntry[] = [];
    const seen = new Set<string>();

    // Exact match
    const exact = this.invertedIndex.get(term);
    if (exact) {
      for (const entry of exact) {
        const key = `${entry.id}:${entry.field}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push(entry);
        }
      }
    }

    // Prefix match — find all terms that start with the search term
    // (only if term is at least 3 chars to avoid too many partial matches)
    if (term.length >= 3) {
      for (const [indexedTerm, entries] of this.invertedIndex) {
        if (indexedTerm !== term && indexedTerm.startsWith(term)) {
          for (const entry of entries) {
            const key = `${entry.id}:${entry.field}`;
            if (!seen.has(key)) {
              seen.add(key);
              // Partial matches score slightly less
              results.push({ ...entry });
            }
          }
        }
      }
    }

    // Substring match — for "fuzzy" matching, check if any indexed term
    // contains the search term (only for terms >= 4 chars)
    if (term.length >= 4) {
      for (const [indexedTerm, entries] of this.invertedIndex) {
        if (indexedTerm !== term && !indexedTerm.startsWith(term) && indexedTerm.includes(term)) {
          for (const entry of entries) {
            const key = `${entry.id}:${entry.field}`;
            if (!seen.has(key)) {
              seen.add(key);
              results.push({ ...entry });
            }
          }
        }
      }
    }

    return results;
  }

  /**
   * Count how many distinct query parts (terms + phrases) matched for an item.
   * Used for AND logic filtering.
   */
  private countMatchedParts(id: string, parsed: ParsedQuery): number {
    let matched = 0;

    // Check terms
    for (const term of parsed.terms) {
      const hits = this.findTermMatches(term);
      if (hits.some((h) => h.id === id)) {
        matched++;
      }
    }

    // Check phrases
    const fields = this.fieldText.get(id);
    if (fields) {
      for (const phrase of parsed.phrases) {
        for (const text of fields.values()) {
          if (text.includes(phrase)) {
            matched++;
            break; // Count each phrase once
          }
        }
      }
    }

    return matched;
  }
}
