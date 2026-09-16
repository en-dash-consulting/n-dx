/**
 * Workspace API — the worktrees this server can address.
 *
 *   GET  /api/workspaces          — known worktrees with keys, branches and whether resources exist
 *   POST /api/workspaces/refresh  — re-read `git worktree list` now
 *
 * @module web/server/routes-workspaces
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { WorkspaceRegistry } from "./workspaces.js";
import { jsonResponse } from "./response-utils.js";

const WORKSPACES_PATH = "/api/workspaces";

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
  return false;
}
