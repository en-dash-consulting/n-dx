/**
 * Rex API routes — CRUD for PRD items, tree stats, next task, and log entries.
 *
 * All endpoints are under /api/rex/.
 *
 * This module is the entry point for rex routing. It delegates to focused
 * sub-modules for each domain area:
 *
 *   reads.ts        — PRD read routes (prd, stats, dashboard, next, log)
 *   items.ts        — Item CRUD (add, get, patch, bulk, merge, delete)
 *   requirements.ts — Requirements CRUD, coverage, traceability
 *   prune.ts        — Prune preview and execution
 *   ../routes-rex-analysis.ts — Analysis, proposals, smart-add, batch-import
 *   execution.ts    — Epic-by-epic execution, pause/resume, shutdown
 *   health.ts       — Health score and reorganization proposals
 *   rex-route-helpers.ts — Route-level helpers (load/save PRD, appendLog, etc.)
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerContext } from "../types.js";
import type { WebSocketBroadcaster } from "../websocket.js";

import { routePrdReads } from "./reads.js";
import { routeItems } from "./items.js";
import { routeItemRequirements, routeRequirementsAnalytics } from "./requirements.js";
import { routePrune } from "./prune.js";
import { routeProposals } from "../routes-rex-analysis.js";
import { routeExecution } from "./execution.js";
import { routeHealthReorganize } from "./health.js";

const REX_PREFIX = "/api/rex/";

/**
 * Handle Rex API requests. Returns true if the request was handled.
 *
 * Delegates to focused sub-routers for each domain area:
 * - PRD reads (prd, stats, dashboard, next, log)
 * - Item CRUD (add, get, patch, bulk, merge)
 * - Requirements (item requirements CRUD, coverage, traceability)
 * - Prune (preview, execute)
 * - Proposals (analyze, proposals, smart-add, batch-import)
 * - Execution (epic-by-epic, status, pause, resume)
 * - Health & reorganize (health score, proposals, apply)
 */
export function handleRexRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): boolean | Promise<boolean> {
  const url = req.url || "/";
  const method = req.method || "GET";

  if (!url.startsWith(REX_PREFIX)) return false;

  const fullPath = url.slice(REX_PREFIX.length);
  const qIdx = fullPath.indexOf("?");
  const path = qIdx === -1 ? fullPath : fullPath.slice(0, qIdx);

  // Try each sub-router in turn. The first to return non-false wins.
  const prdResult = routePrdReads(url, path, method, res, ctx);
  if (prdResult !== false) return prdResult;

  const itemsResult = routeItems(path, method, req, res, ctx, broadcast, routeItemRequirements);
  if (itemsResult !== false) return itemsResult;

  const reqAnalyticsResult = routeRequirementsAnalytics(path, method, res, ctx);
  if (reqAnalyticsResult !== false) return reqAnalyticsResult;

  const pruneResult = routePrune(path, method, req, res, ctx, broadcast);
  if (pruneResult !== false) return pruneResult;

  const proposalResult = routeProposals(path, method, req, res, ctx, broadcast);
  if (proposalResult !== false) return proposalResult;

  const execResult = routeExecution(path, method, req, res, ctx, broadcast);
  if (execResult !== false) return execResult;

  const healthResult = routeHealthReorganize(path, method, req, res, ctx, broadcast);
  if (healthResult !== false) return healthResult;

  return false;
}

// Re-export shutdown for use by start.ts
export { shutdownRexExecution } from "./execution.js";
export type { ShutdownRexResult } from "./execution.js";
