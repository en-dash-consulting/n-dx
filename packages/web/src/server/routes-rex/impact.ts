/**
 * GET /api/rex/impact — every PRD item's at-a-glance impact (size, file kinds,
 * security and essential flags), keyed by item id. Read-only.
 *
 * @see ../item-impact.ts
 */

import type { ServerResponse } from "node:http";
import { join } from "node:path";
import type { ServerContext } from "../types.js";
import { jsonResponse, errorResponse } from "../response-utils.js";
import { loadPRDSync } from "../prd-io.js";
import { henchDirIn } from "../paths.js";
import { RunFilesCache, computeImpacts, importFanIn, type ImpactSourceItem } from "../item-impact.js";

/** One cache per runs directory, so each workspace keeps its own. */
const caches = new Map<string, RunFilesCache>();

function runFiles(projectDir: string): Map<string, string[]> {
  const runsDir = join(henchDirIn(projectDir), "runs");
  let cache = caches.get(runsDir);
  if (!cache) caches.set(runsDir, (cache = new RunFilesCache(runsDir, projectDir)));
  return cache.byTask();
}

export function routeImpact(path: string, method: string, res: ServerResponse, ctx: ServerContext): boolean {
  if (path !== "impact" || method !== "GET") return false;
  const doc = loadPRDSync(ctx.rexDir);
  if (!doc) {
    errorResponse(res, 404, "No PRD data found");
    return true;
  }
  const items = computeImpacts(doc.items as unknown as ImpactSourceItem[], runFiles(ctx.projectDir), importFanIn(ctx.svDir));
  jsonResponse(res, 200, { items });
  return true;
}
