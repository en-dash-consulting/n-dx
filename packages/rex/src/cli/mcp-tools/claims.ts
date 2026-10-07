/**
 * Cross-worktree task claims, as the MCP tools read and write them.
 *
 * Shared by `get_next_task` (skips what is claimed elsewhere),
 * `update_task_status` (claims on `in_progress`, releases on terminal
 * statuses), `claim_task` and `release_task` — and by `rex next` on the CLI
 * side, which reads `collectForeignClaims` for the same skip.
 */

import type { ClaimsStore, TaskClaim } from "../../store/index.js";

/**
 * Where the caller's claims live and which worktree it is: selection passes
 * over tasks another worktree holds a live claim on. Omit outside a
 * repository (or in tests) to select without looking at claims.
 */
export interface ClaimsContext {
  store: ClaimsStore;
  worktreeRoot: string;
}

/** Wire shape for a claim that made selection skip a task. */
export interface SkippedClaim {
  taskId: string;
  worktreeRoot: string;
  pid: number;
  expiresAt: string;
}

/** Live claims held by other worktrees, as the set `findNextTask` excludes and the list callers report. */
export async function collectForeignClaims(
  claims: ClaimsContext | undefined,
): Promise<{ excludeIds: Set<string>; skipped: SkippedClaim[] }> {
  if (!claims) return { excludeIds: new Set(), skipped: [] };
  const elsewhere = await claims.store.claimedElsewhere(claims.worktreeRoot);
  const skipped = [...elsewhere.values()].map((c: TaskClaim) => ({
    taskId: c.taskId,
    worktreeRoot: c.worktreeRoot,
    pid: c.pid,
    expiresAt: c.expiresAt,
  }));
  return { excludeIds: new Set(elsewhere.keys()), skipped };
}

/** Statuses that mean the caller is done with the task and the claim must go. */
export const CLAIM_RELEASING_STATUSES = new Set(["completed", "cancelled", "deferred", "blocked", "failing", "deleted", "pending"]);

/**
 * Take the cross-worktree claim on a task, or report who holds it.
 *
 * `get_next_task` has always *read* claims — it skips tasks another worktree
 * is working on — but nothing on the MCP path ever *wrote* one, so two
 * assistants in two worktrees both saw the same task as free and both picked
 * it. The claim is written where the caller commits to the work: moving a task
 * to `in_progress`, or an explicit `claim_task`.
 *
 * Returns null when the claim is held (or when there is no claims store,
 * outside a repository), so callers can treat it as "nothing in the way".
 */
export async function acquireClaim(
  claims: ClaimsContext | undefined,
  taskId: string,
): Promise<{ ok: true; claim: TaskClaim | null } | { ok: false; heldBy: TaskClaim }> {
  if (!claims) return { ok: true, claim: null };
  const result = await claims.store.claim(taskId, { worktreeRoot: claims.worktreeRoot });
  return result.ok ? { ok: true, claim: result.claim } : { ok: false, heldBy: result.heldBy };
}

/** How a held claim reads to the caller that could not take it. */
export function describeHeldClaim(taskId: string, heldBy: TaskClaim): string {
  return `Task "${taskId}" is claimed by another worktree: ${heldBy.worktreeRoot} (PID ${heldBy.pid}, expires ${heldBy.expiresAt}). `
    + `Pick another task, or pass force: true if that run is finished.`;
}
