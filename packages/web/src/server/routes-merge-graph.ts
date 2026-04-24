/**
 * Merge-graph API route — serves the PRD ↔ git-merge context graph.
 *
 *   GET /api/merge-graph            → full graph (nodes + edges + stats)
 *   GET /api/merge-graph/fingerprint → just the cache fingerprint
 *
 * The graph is content-addressed via {@link MergeGraphFingerprint}; the cached
 * payload is held in a module-scoped {@link MergeGraphCache} instance keyed on
 * project directory. Successive requests within the same fingerprint return
 * in ~O(few stat calls).
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
  DEFAULT_MAX_MERGES,
  type BuildMergeGraphOptions,
  type MergeGraph,
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
 * Handle requests under `/api/merge-graph`. Returns true when the request was
 * handled, false otherwise.
 */
export function handleMergeGraphRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  opts: HandleMergeGraphOptions = {},
): boolean {
  const url = req.url || "/";
  const method = req.method || "GET";

  if (!url.startsWith("/api/merge-graph")) return false;

  const qIdx = url.indexOf("?");
  const pathOnly = qIdx === -1 ? url : url.slice(0, qIdx);

  if (method !== "GET") {
    errorResponse(res, 405, "Method not allowed");
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
