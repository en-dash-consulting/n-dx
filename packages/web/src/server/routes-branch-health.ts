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
 * `web.sidecarGithubReads` is true and the request asks with `?github=1`;
 * without it the answer is local facts only and `githubDeferred` says GitHub
 * facts are one request away. A local-only answer reuses the PR base the last
 * GitHub read found for that worktree and branch (`baseSource: "pr-cached"`),
 * held in this server's memory. Each predicted conflict carries a class and,
 * except for source conflicts, a fix; `web.generatedFiles` declares the files
 * a command regenerates. See `branch-health/collect.ts` and `conflicts.ts`.
 *
 * @module web/server/routes-branch-health
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerContext } from "./types.js";
import { errorMessage, errorResponse, jsonResponse } from "./response-utils.js";
import {
  collectBranchHealth,
  NotAGitBranchError,
  parseGeneratedFiles,
  PrBaseCache,
  type BranchHealthExec,
} from "./branch-health/index.js";
import { readSidecarSettings } from "./sidecar/settings.js";
import { readWebValue } from "./sidecar/web-config.js";

export const BRANCH_HEALTH_PATH = "/api/branch-health";

/** PR bases found by GitHub reads, for every worktree this server answers. */
const serverPrBases = new PrBaseCache();

export interface BranchHealthRouteOptions {
  /** Injected for tests; defaults to the llm-client `exec`. */
  exec?: BranchHealthExec;
  /** Injected for tests; defaults to this server's cache. */
  prBases?: PrBaseCache;
}

export async function handleBranchHealthRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  options: BranchHealthRouteOptions = {},
): Promise<boolean> {
  // Split the raw target the way the route gate does: URL parsing would read
  // `//host/api/branch-health` as this path, which the gate does not cover.
  const target = req.url || "/";
  const queryAt = target.indexOf("?");
  const path = queryAt < 0 ? target : target.slice(0, queryAt);
  if (path !== BRANCH_HEALTH_PATH || (req.method || "GET") !== "GET") return false;
  const query = new URLSearchParams(queryAt < 0 ? "" : target.slice(queryAt + 1));

  try {
    const health = await collectBranchHealth(ctx.projectDir, {
      githubReads: readSidecarSettings(ctx.projectDir).githubReads,
      localOnly: query.get("github") !== "1",
      prBases: options.prBases ?? serverPrBases,
      generatedFiles: readWebValue(ctx.projectDir, (web) => parseGeneratedFiles(web.generatedFiles)) ?? [],
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
