/**
 * Search API route — full-text search across PRD items.
 *
 * GET /api/search?q=<query>&limit=N  — search PRD items by text
 *
 * Returns JSON array of results sorted by relevance score descending.
 * Supports:
 * - Multi-word queries (AND logic by default)
 * - OR logic: `word1 OR word2`
 * - Exact phrase matching: `"exact phrase"`
 * - Fuzzy/partial matching (prefix + substring)
 *
 * @module web/server/routes-search
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse } from "./response-utils.js";
import { SearchIndex } from "./search-index.js";

// ── Index cache ────────────────────────────────────────────────────────────
// One SearchIndex per rexDir, lazily created. The index itself handles
// staleness detection via file mtime checks.

const indexCache = new Map<string, SearchIndex>();

function getOrCreateIndex(ctx: ServerContext): SearchIndex {
  let index = indexCache.get(ctx.rexDir);
  if (!index) {
    index = new SearchIndex(ctx.rexDir);
    indexCache.set(ctx.rexDir, index);
  }
  return index;
}

/** Clear the cached index (used in tests). */
export function clearSearchIndexCache(): void {
  indexCache.clear();
}

// ── Route handler ──────────────────────────────────────────────────────────

const SEARCH_PREFIX = "/api/search";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Handle search API requests.
 *
 * GET /api/search?q=<query>&limit=N
 *
 * Returns `true` if the request was handled, `false` otherwise.
 */
export function handleSearchRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): boolean {
  const url = req.url || "";
  const method = req.method || "GET";

  if (!url.startsWith(SEARCH_PREFIX)) return false;

  // Only GET is supported
  if (method !== "GET") {
    errorResponse(res, 405, "Method not allowed");
    return true;
  }

  // Parse query parameters
  const urlObj = new URL(url, "http://localhost");
  const query = urlObj.searchParams.get("q");
  const limitParam = urlObj.searchParams.get("limit");

  if (!query || query.trim().length === 0) {
    errorResponse(res, 400, "Missing required query parameter: q");
    return true;
  }

  // Parse and clamp limit
  let limit = DEFAULT_LIMIT;
  if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, MAX_LIMIT);
    }
  }

  const index = getOrCreateIndex(ctx);
  const startTime = performance.now();
  const results = index.search(query.trim(), limit);
  const elapsed = performance.now() - startTime;

  jsonResponse(res, 200, {
    query: query.trim(),
    count: results.length,
    elapsed_ms: Math.round(elapsed * 100) / 100,
    results,
  });

  return true;
}
