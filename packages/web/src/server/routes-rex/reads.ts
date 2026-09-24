/**
 * PRD read routes: prd, stats, dashboard, next, log, claims.
 *
 * All handlers are read-only — they load the PRD and return computed views.
 */

import type { ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import type { ServerContext } from "../types.js";
import { jsonResponse, errorResponse } from "../response-utils.js";
import { loadPRDSync } from "../prd-io.js";
import { findNextTask, collectCompletedIds } from "./rex-route-helpers.js";

import {
  computeStats,
  computeEpicStats,
  computePriorityDistribution,
  computeRequirementsSummary,
  findItem,
  openClaimsStore,
  resolveClaimHolder,
} from "../rex-gateway.js";

/**
 * One live cross-worktree claim, as the dashboard shows it. Mirrors
 * `ClaimEntry` in viewer/hooks/use-claims.ts.
 */
export interface ClaimWire {
  taskId: string;
  /** Title from this workspace's PRD, or null when the task exists only in the claiming worktree. */
  taskTitle: string | null;
  /** Realpath of the claiming worktree root. */
  worktreeRoot: string;
  /** Its basename — the label the chip shows. */
  worktree: string;
  /** Whether the claim is held from the worktree this server serves. */
  isServedHere: boolean;
  pid: number;
  host: string;
  claimedAt: string;
  expiresAt: string;
}

/**
 * A higher-priority task the next-task read passed over because another
 * worktree holds it. Included so the card can say why the suggestion is not
 * the top of the queue, instead of the operator discovering it as Execute's
 * 409 a click later.
 */
export interface SkippedForClaimWire {
  taskId: string;
  title: string;
  /** Realpath of the claiming worktree root. */
  worktreeRoot: string;
  /** Its basename — the label the card shows. */
  worktree: string;
}

/**
 * The next actionable task with foreign live claims excluded — the same set
 * the Execute route's 409 check consults, so the suggestion is always a task
 * Execute will accept. Claims are read for the request's workspace
 * (`ctx.projectDir`), matching how Execute resolves its holder.
 *
 * Also reports the highest-priority task that was passed over because of a
 * claim, when there is one: the unexcluded pick, if it differs and is
 * claimed, is exactly that task.
 */
async function findNextUnclaimedTask(
  ctx: ServerContext,
  items: Parameters<typeof findNextTask>[0],
  completedIds: Set<string>,
): Promise<{ task: ReturnType<typeof findNextTask>; skipped?: SkippedForClaimWire }> {
  const holder = resolveClaimHolder(ctx.projectDir);
  const foreign = await openClaimsStore(ctx.projectDir).claimedElsewhere(holder.worktreeRoot);
  if (foreign.size === 0) {
    return { task: findNextTask(items, completedIds) };
  }

  const task = findNextTask(items, completedIds, { excludeIds: new Set(foreign.keys()) });
  const top = findNextTask(items, completedIds);
  if (top && top.id !== (task?.id ?? null)) {
    const claim = foreign.get(top.id);
    if (claim) {
      return {
        task,
        skipped: {
          taskId: top.id,
          title: top.title,
          worktreeRoot: claim.worktreeRoot,
          worktree: basename(claim.worktreeRoot) || claim.worktreeRoot,
        },
      };
    }
  }
  return { task };
}

/**
 * GET /api/rex/claims — every live claim in the repository's claims store.
 *
 * Read-only. The store lives in the git common dir, so this is the same
 * answer from every worktree; dead-pid and expired claims are already gone
 * by the time it is read. Outside a repository the store is a no-op and the
 * list is empty.
 */
async function handleClaims(res: ServerResponse, ctx: ServerContext): Promise<boolean> {
  const holder = resolveClaimHolder(ctx.projectDir);
  const claims = await openClaimsStore(ctx.projectDir).readClaims();
  const doc = claims.length > 0 ? loadPRDSync(ctx.rexDir) : null;
  const wire: ClaimWire[] = claims
    .map((c) => ({
      taskId: c.taskId,
      taskTitle: doc ? findItem(doc.items, c.taskId)?.item.title ?? null : null,
      worktreeRoot: c.worktreeRoot,
      worktree: basename(c.worktreeRoot) || c.worktreeRoot,
      isServedHere: c.worktreeRoot === holder.worktreeRoot,
      pid: c.pid,
      host: c.host,
      claimedAt: c.claimedAt,
      expiresAt: c.expiresAt,
    }))
    .sort((a, b) => a.claimedAt.localeCompare(b.claimedAt) || a.taskId.localeCompare(b.taskId));
  jsonResponse(res, 200, { servedWorktree: holder.worktreeRoot, claims: wire });
  return true;
}

/** PRD read routes: prd, stats, dashboard, next, log, claims. */
export function routePrdReads(
  url: string, path: string, method: string,
  res: ServerResponse, ctx: ServerContext,
): boolean | Promise<boolean> {
  // GET /api/rex/claims — live cross-worktree task claims
  if (path === "claims" && method === "GET") {
    return handleClaims(res, ctx);
  }

  // GET /api/rex/prd — full PRD document
  if (path === "prd" && method === "GET") {
    const doc = loadPRDSync(ctx.rexDir);
    if (!doc) {
      errorResponse(res, 404, "No PRD data found");
      return true;
    }
    jsonResponse(res, 200, doc);
    return true;
  }

  // GET /api/rex/stats — tree stats
  if (path === "stats" && method === "GET") {
    const doc = loadPRDSync(ctx.rexDir);
    if (!doc) {
      errorResponse(res, 404, "No PRD data found");
      return true;
    }
    const stats = computeStats(doc.items);
    jsonResponse(res, 200, {
      title: doc.title,
      stats,
      percentComplete: stats.total > 0
        ? Math.round((stats.completed / stats.total) * 100)
        : 0,
    });
    return true;
  }

  // GET /api/rex/dashboard — dashboard data (overall + per-epic + next task + priority distribution)
  if (path === "dashboard" && method === "GET") {
    const doc = loadPRDSync(ctx.rexDir);
    if (!doc) {
      errorResponse(res, 404, "No PRD data found");
      return true;
    }
    return (async () => {
      const stats = computeStats(doc.items);
      const completedIds = collectCompletedIds(doc.items);
      const { task: next, skipped } = await findNextUnclaimedTask(ctx, doc.items, completedIds);
      const epics = computeEpicStats(doc.items);
      const priorities = computePriorityDistribution(doc.items);
      const reqSummary = computeRequirementsSummary(doc.items);
      jsonResponse(res, 200, {
        title: doc.title,
        stats,
        percentComplete: stats.total > 0
          ? Math.round((stats.completed / stats.total) * 100)
          : 0,
        epics,
        nextTask: next,
        ...(skipped ? { nextTaskSkipped: skipped } : {}),
        priorities,
        requirements: reqSummary,
      });
      return true;
    })();
  }

  // GET /api/rex/next — next actionable task, skipping tasks other worktrees hold
  if (path === "next" && method === "GET") {
    const doc = loadPRDSync(ctx.rexDir);
    if (!doc) {
      errorResponse(res, 404, "No PRD data found");
      return true;
    }
    return (async () => {
      const completedIds = collectCompletedIds(doc.items);
      const { task: next, skipped } = await findNextUnclaimedTask(ctx, doc.items, completedIds);
      if (!next) {
        jsonResponse(res, 200, {
          task: null,
          message: "All tasks completed or blocked",
          ...(skipped ? { skipped } : {}),
        });
        return true;
      }
      jsonResponse(res, 200, { task: next, ...(skipped ? { skipped } : {}) });
      return true;
    })();
  }

  // GET /api/rex/log — execution log
  if (path === "log" && method === "GET") {
    const logPath = join(ctx.rexDir, "execution-log.jsonl");
    if (!existsSync(logPath)) {
      jsonResponse(res, 200, { entries: [] });
      return true;
    }
    try {
      const raw = readFileSync(logPath, "utf-8");
      const lines = raw.trim().split("\n").filter(Boolean);

      // Parse limit from query string
      const queryIdx = url.indexOf("?");
      let limit = 0;
      if (queryIdx !== -1) {
        const params = new URLSearchParams(url.slice(queryIdx));
        const limitStr = params.get("limit");
        if (limitStr) limit = parseInt(limitStr, 10);
      }

      const entries = lines
        .map((line) => { try { return JSON.parse(line); } catch { return null; } })
        .filter(Boolean);

      const result = limit > 0 ? entries.slice(-limit) : entries;
      jsonResponse(res, 200, { entries: result });
    } catch {
      jsonResponse(res, 200, { entries: [] });
    }
    return true;
  }

  return false;
}
