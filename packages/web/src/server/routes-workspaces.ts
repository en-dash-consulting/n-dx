/**
 * Workspace API — the worktrees this server can address.
 *
 *   GET  /api/workspaces                 — known worktrees with keys, branches and whether resources exist
 *   POST /api/workspaces/refresh         — re-read `git worktree list` now
 *   GET  /api/workspaces/:key/prd-delta  — how that worktree's PRD differs from the anchor's (see prd-delta.ts)
 *
 * @module web/server/routes-workspaces
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { WorkspaceRegistry } from "./workspaces.js";
import { jsonResponse, errorResponse } from "./response-utils.js";
import { loadPRDSync } from "./prd-io.js";
import { cachedPrdDelta } from "./prd-delta.js";

const WORKSPACES_PATH = "/api/workspaces";
const PRD_DELTA_PATTERN = /^\/api\/workspaces\/([^/]+)\/prd-delta$/;

export async function handleWorkspacesRoute(
  req: IncomingMessage,
  res: ServerResponse,
  registry: WorkspaceRegistry,
): Promise<boolean> {
  const url = (req.url || "/").split("?")[0];
  const method = req.method || "GET";

  if (url === WORKSPACES_PATH && method === "GET") {
    jsonResponse(res, 200, { anchor: registry.anchorKey, workspaces: registry.list() });
    return true;
  }
  if (url === `${WORKSPACES_PATH}/refresh` && method === "POST") {
    const result = await registry.refresh();
    jsonResponse(res, 200, { ...result, anchor: registry.anchorKey, workspaces: registry.list() });
    return true;
  }
  const deltaMatch = PRD_DELTA_PATTERN.exec(url);
  if (deltaMatch && method === "GET") {
    let key: string;
    try {
      key = decodeURIComponent(deltaMatch[1]);
    } catch {
      errorResponse(res, 400, "Malformed workspace key");
      return true;
    }
    // get() creates the worktree's resources — including the tree watcher
    // that invalidates this delta — on first use.
    const workspace = registry.get(key);
    if (!workspace) {
      jsonResponse(res, 404, { error: `Unknown workspace "${key}"`, known: registry.keys() });
      return true;
    }
    const anchor = registry.anchor;
    const delta = cachedPrdDelta(
      {
        anchorRexDir: anchor.ctx.rexDir,
        workspaceRexDir: workspace.ctx.rexDir,
        anchorKey: anchor.key,
        workspaceKey: workspace.key,
      },
      loadPRDSync,
    );
    jsonResponse(res, 200, delta);
    return true;
  }
  return false;
}
