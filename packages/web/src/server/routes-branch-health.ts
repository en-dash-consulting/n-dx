/**
 * Branch health route.
 *
 * GET /api/branch-health — the addressed workspace's branch status: branch,
 *   head, base and where it came from, ahead/behind, predicted conflicts,
 *   stack containment, and PR facts when GitHub reads are allowed.
 *
 * Answers for the workspace the request addressed (`X-Ndx-Workspace` or the
 * `/w/<key>/` slot), so the Workspaces board asks once per worktree. Refused
 * while `git.branchHealth` is off (route-feature-gates.ts). gh runs only when
 * `web.sidecarGithubReads` is true. See `branch-health/collect.ts`.
 *
 * @module web/server/routes-branch-health
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerContext } from "./types.js";
import { errorMessage, errorResponse, jsonResponse } from "./response-utils.js";
import { collectBranchHealth, NotAGitBranchError, type BranchHealthExec } from "./branch-health/index.js";
import { readSidecarSettings } from "./sidecar/settings.js";

export const BRANCH_HEALTH_PATH = "/api/branch-health";

export interface BranchHealthRouteOptions {
  /** Injected for tests; defaults to the llm-client `exec`. */
  exec?: BranchHealthExec;
}

export async function handleBranchHealthRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  options: BranchHealthRouteOptions = {},
): Promise<boolean> {
  const path = (req.url || "/").split("?")[0];
  if (path !== BRANCH_HEALTH_PATH || (req.method || "GET") !== "GET") return false;

  try {
    const health = await collectBranchHealth(ctx.projectDir, {
      githubReads: readSidecarSettings(ctx.projectDir).githubReads,
      exec: options.exec,
    });
    jsonResponse(res, 200, health);
  } catch (err) {
    if (err instanceof NotAGitBranchError) {
      errorResponse(res, 409, `No branch to report on: ${err.message}`);
    } else {
      errorResponse(res, 500, `Branch health failed: ${errorMessage(err)}`);
    }
  }
  return true;
}
