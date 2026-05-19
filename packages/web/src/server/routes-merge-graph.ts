/**
 * Merge-graph API route — serves the PRD ↔ git-merge context graph.
 *
 *   GET /api/merge-graph             → full graph (nodes + edges + stats)
 *   GET /api/merge-graph/fingerprint → just the cache fingerprint
 *   GET /api/prd-origin?path=…       → introducing-commit for one PRD item
 *
 * The graph is content-addressed via {@link MergeGraphFingerprint}; the cached
 * payload is held in a module-scoped {@link MergeGraphCache} instance keyed on
 * project directory. Successive requests within the same fingerprint return
 * in ~O(few stat calls).
 *
 * The `/api/prd-origin` lookups are cached separately via a small per-process
 * LRU keyed on `<projectDir>|<path>` so repeated clicks on the same node
 * don't re-spawn `git log`.
 *
 * @module web/server/routes-merge-graph
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse } from "./response-utils.js";
import {
  MergeGraphCache,
  computeFingerprint,
  createGitRunner,
  resolveItemOrigin,
  DEFAULT_MAX_MERGES,
  type BuildMergeGraphOptions,
  type MergeGraph,
  type PrdOrigin,
} from "./merge-history.js";
import { join } from "node:path";

/**
 * Per-project cache for merge-graph payloads. Keyed on project directory
 * because the server may (in the future) host multiple projects.
 */
const caches = new Map<string, MergeGraphCache>();

function getCache(projectDir: string): MergeGraphCache {
  let cache = caches.get(projectDir);
  if (!cache) {
    cache = new MergeGraphCache();
    caches.set(projectDir, cache);
  }
  return cache;
}

/** Test hook — clear all cached graphs. */
export function clearMergeGraphCaches(): void {
  caches.clear();
  originLru.clear();
}

// ── PRD origin LRU ───────────────────────────────────────────────────────────
//
// `git log --diff-filter=A --follow` is fast (typically tens of ms) but not
// free, and the user can click the same node repeatedly. A bounded LRU keyed
// on `<projectDir>|<treePath>` caches results within the process. Sentinel
// `null` is also cached so we don't re-shell-out for items with no commit
// history (newly-created PRD items).

const ORIGIN_LRU_CAP = 256;
type OriginCacheValue = PrdOrigin | null;
const originLru = new Map<string, OriginCacheValue>();

function originLruGet(key: string): OriginCacheValue | undefined {
  if (!originLru.has(key)) return undefined;
  const v = originLru.get(key) as OriginCacheValue;
  // Re-insert to mark as most-recently-used.
  originLru.delete(key);
  originLru.set(key, v);
  return v;
}

function originLruSet(key: string, value: OriginCacheValue): void {
  if (originLru.has(key)) originLru.delete(key);
  originLru.set(key, value);
  while (originLru.size > ORIGIN_LRU_CAP) {
    const firstKey = originLru.keys().next().value;
    if (firstKey === undefined) break;
    originLru.delete(firstKey);
  }
}

/** Test hook — flush the per-process origin LRU. */
export function clearPrdOriginCache(): void {
  originLru.clear();
}

/**
 * Validate the `path` query parameter for the `/api/prd-origin` route.
 *
 * Accepts a slug-chain produced by `flattenPrdItems` — slashes are allowed
 * because the chain is `<epic>/<feature>/<task>`, but path-traversal markers,
 * absolute paths, backslashes (Windows separators leaking through), and
 * NUL bytes are rejected. Empty strings are rejected too — the route requires
 * a real item.
 *
 * Returns the cleaned path on success or a string error message on failure.
 */
export function validateOriginPath(raw: string | null): { ok: true; path: string } | { ok: false; reason: string } {
  if (!raw) return { ok: false, reason: "missing path" };
  if (raw.length > 2048) return { ok: false, reason: "path too long" };
  if (raw.includes("\0")) return { ok: false, reason: "path contains NUL" };
  if (raw.includes("\\")) return { ok: false, reason: "path contains backslash" };
  if (raw.startsWith("/")) return { ok: false, reason: "path must be relative" };
  // Reject `..` segments — split by `/` so we don't false-flag `foo..bar` slugs.
  const segments = raw.split("/");
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") {
      return { ok: false, reason: "path contains traversal or empty segment" };
    }
  }
  return { ok: true, path: raw };
}

function parseMaxMerges(url: string): number {
  const q = url.indexOf("?");
  if (q === -1) return DEFAULT_MAX_MERGES;
  const params = new URLSearchParams(url.slice(q));
  const raw = params.get("max");
  if (!raw) return DEFAULT_MAX_MERGES;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_MERGES;
  // Hard cap to keep the payload bounded.
  return Math.min(n, 5000);
}

export interface HandleMergeGraphOptions {
  /** Override the cache used for this request (test injection). */
  cache?: MergeGraphCache;
  /** Override the build options (test injection — merged into defaults). */
  overrideBuildOptions?: Partial<BuildMergeGraphOptions>;
}

/**
 * Handle requests under `/api/merge-graph` and the sibling `/api/prd-origin`.
 * Returns true when the request was handled, false otherwise.
 */
export function handleMergeGraphRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  opts: HandleMergeGraphOptions = {},
): boolean {
  const url = req.url || "/";
  const method = req.method || "GET";

  const isMergeGraph = url.startsWith("/api/merge-graph");
  const isPrdOrigin = url.startsWith("/api/prd-origin");
  if (!isMergeGraph && !isPrdOrigin) return false;

  const qIdx = url.indexOf("?");
  const pathOnly = qIdx === -1 ? url : url.slice(0, qIdx);

  if (method !== "GET") {
    errorResponse(res, 405, "Method not allowed");
    return true;
  }

  // ── /api/prd-origin ────────────────────────────────────────────────────────
  if (pathOnly === "/api/prd-origin") {
    const params = qIdx === -1 ? new URLSearchParams() : new URLSearchParams(url.slice(qIdx));
    const validation = validateOriginPath(params.get("path"));
    if (!validation.ok) {
      errorResponse(res, 400, validation.reason);
      return true;
    }

    const cacheKey = `${ctx.projectDir}|${validation.path}`;
    const cached = originLruGet(cacheKey);
    if (cached !== undefined) {
      jsonResponse(res, 200, { origin: cached });
      return true;
    }

    const relPath = `.rex/prd_tree/${validation.path}/index.md`;
    const runner =
      opts.overrideBuildOptions?.gitRunner ?? createGitRunner(ctx.projectDir);
    let origin: PrdOrigin | null;
    try {
      origin = resolveItemOrigin(runner, relPath);
    } catch (err) {
      errorResponse(res, 500, (err as Error).message);
      return true;
    }
    originLruSet(cacheKey, origin);
    jsonResponse(res, 200, { origin });
    return true;
  }

  const cache = opts.cache ?? getCache(ctx.projectDir);
  const maxMerges = parseMaxMerges(url);

  const buildOptions: BuildMergeGraphOptions = {
    projectDir: ctx.projectDir,
    rexDir: ctx.rexDir,
    henchRunsDir: join(ctx.projectDir, ".hench", "runs"),
    maxMerges,
    ...(opts.overrideBuildOptions ?? {}),
  };

  if (pathOnly === "/api/merge-graph/fingerprint") {
    // Cheap fingerprint-only response — lets clients detect changes without
    // re-downloading the full graph.
    const runner =
      buildOptions.gitRunner ?? createGitRunner(ctx.projectDir);
    const fingerprint = computeFingerprint({
      rexDir: buildOptions.rexDir,
      henchRunsDir:
        buildOptions.henchRunsDir ?? join(ctx.projectDir, ".hench", "runs"),
      gitRunner: runner,
      maxMerges,
    });
    jsonResponse(res, 200, { fingerprint });
    return true;
  }

  if (pathOnly === "/api/merge-graph") {
    try {
      const graph: MergeGraph = cache.get(buildOptions);
      jsonResponse(res, 200, graph);
    } catch (err) {
      errorResponse(res, 500, (err as Error).message);
    }
    return true;
  }

  return false;
}
