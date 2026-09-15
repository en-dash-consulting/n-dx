/**
 * This run's side of the cross-worktree task claim.
 *
 * The store itself lives in rex (`@n-dx/rex` → `store/claims.ts`) and knows
 * nothing about runs: it answers "who holds this task" and "take it". What it
 * cannot answer is "what did *this process* take, and has it given it back" —
 * and that is the question the release path has to get right, because a claim
 * that outlives its run blocks the task for every worktree until it expires.
 *
 * So this module keeps the ledger. Every claim taken through {@link claimTask}
 * is recorded, and {@link releaseAllTaskClaims} hands them all back — one call
 * at the end of the command, covering normal completion, failure, and an
 * aborted loop alike, without each of those paths having to remember which
 * task it was on.
 *
 * ## What happens when the process does not get to release
 *
 * Nothing that needs fixing here. A claim is live only while its PID is, so a
 * `SIGKILL`, a crash, or an unhandled `SIGINT` leaves a record that every
 * reader — including the next run in this same worktree — already treats as
 * lapsed. The ledger exists to make the *graceful* path prompt, not to make the
 * abrupt one safe; that is the store's job and it does it without us.
 *
 * @module hench/prd/task-claims
 */

import { openClaimsStore } from "./rex-gateway.js";
import type { TaskClaim } from "./rex-gateway.js";

/**
 * Task ids this process is holding, per project directory.
 *
 * Module-level because it describes the process, not any one call: the claim is
 * taken deep inside brief assembly and released at the top of the command, and
 * threading a handle between those two points would mean every layer in between
 * carrying a parameter it has no use for.
 */
const held = new Map<string, Set<string>>();

/** The ledger entry for one project directory, created on demand. */
function ledgerFor(projectDir: string): Set<string> {
  let ids = held.get(projectDir);
  if (!ids) {
    ids = new Set();
    held.set(projectDir, ids);
  }
  return ids;
}

/**
 * Claim `taskId` for this run.
 *
 * Returns `null` on success, or the claim that blocked us — the holder, not a
 * bare `false`, because every caller that loses this race has to tell the
 * operator *which* checkout to go and look at. Outside a git repository the
 * store is a no-op and the claim always succeeds, which is the pre-claims
 * behaviour.
 */
export async function claimTask(projectDir: string, taskId: string): Promise<TaskClaim | null> {
  const store = openClaimsStore(projectDir);
  if (await store.claim(taskId)) {
    ledgerFor(projectDir).add(taskId);
    return null;
  }
  // Lost it. Re-read to name the holder; if the claim lapsed in between, the
  // honest answer is "blocked by someone", so fall back to a bare record.
  const holders = await store.claimedElsewhere();
  return holders.get(taskId) ?? {
    taskId,
    pid: 0,
    worktreeRoot: "another worktree",
    claimedAt: new Date().toISOString(),
    expiresAt: new Date().toISOString(),
  };
}

/** Hand one task back. Safe to call for a task that was never claimed. */
export async function releaseTask(projectDir: string, taskId: string): Promise<void> {
  ledgerFor(projectDir).delete(taskId);
  await openClaimsStore(projectDir).release(taskId);
}

/**
 * Hand back everything this process claimed in `projectDir`.
 *
 * Never throws: it runs in `finally` blocks, where an error would replace the
 * failure the operator actually needs to see with a claims-file error they can
 * do nothing about. A claim we failed to release lapses on its own.
 */
export async function releaseAllTaskClaims(projectDir: string): Promise<void> {
  const ids = held.get(projectDir);
  if (!ids || ids.size === 0) return;
  held.delete(projectDir);

  const store = openClaimsStore(projectDir);
  for (const taskId of ids) {
    try {
      await store.release(taskId);
    } catch {
      // Advisory state: the claim expires, and the run's own outcome matters more.
    }
  }
}

/**
 * Tasks another worktree is running right now, keyed by id.
 *
 * Task selection excludes these. A read failure yields an empty map rather than
 * an error: claims are an optimisation over doing the work twice, and a
 * repository that cannot answer must still be able to pick a task.
 */
export async function claimedElsewhere(projectDir: string): Promise<Map<string, TaskClaim>> {
  try {
    return await openClaimsStore(projectDir).claimedElsewhere();
  } catch {
    return new Map();
  }
}

/** Test seam: forget this process's ledger without touching the claims file. */
export function resetTaskClaimLedger(): void {
  held.clear();
}
