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
 * is recorded and renewed at one third of its TTL while the run owns it.
 * {@link releaseAllTaskClaims} stops those heartbeats and hands every claim
 * back — one call at the end of the command, covering normal completion,
 * failure, and an aborted loop alike, without each of those paths having to
 * remember which task it was on.
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
import type { ClaimsStore, TaskClaim } from "./rex-gateway.js";
import { getWorktreeRoot } from "./llm-gateway.js";

/** Renew with two more attempts available before the current lease expires. */
const CLAIM_RENEWAL_DIVISOR = 3;

/** Mirrors rex's documented default; custom TTLs are passed through explicitly. */
const DEFAULT_CLAIM_TTL_MS = 4 * 60 * 60 * 1000;

interface HeldClaim {
  store: ClaimsStore;
  taskId: string;
  ttlMs: number;
  timer?: ReturnType<typeof setTimeout>;
  renewal?: Promise<void>;
}

/**
 * Claims this process is holding, per project directory.
 *
 * Module-level because it describes the process, not any one call: the claim is
 * taken deep inside brief assembly and released at the top of the command, and
 * threading a handle between those two points would mean every layer in between
 * carrying a parameter it has no use for.
 */
const held = new Map<string, Map<string, HeldClaim>>();

/** The ledger entry for one project directory, created on demand. */
function ledgerFor(projectDir: string): Map<string, HeldClaim> {
  let claims = held.get(projectDir);
  if (!claims) {
    claims = new Map();
    held.set(projectDir, claims);
  }
  return claims;
}

/** Is this still the active ledger entry, rather than one already released? */
function isHeld(projectDir: string, entry: HeldClaim): boolean {
  return held.get(projectDir)?.get(entry.taskId) === entry;
}

/** Stop tracking one claim and return any renewal already in flight. */
function forgetClaim(projectDir: string, taskId: string): HeldClaim | undefined {
  const claims = held.get(projectDir);
  if (!claims) return undefined;
  const entry = claims.get(taskId);
  if (!entry) return undefined;

  claims.delete(taskId);
  if (claims.size === 0) held.delete(projectDir);
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = undefined;
  return entry;
}

/** Schedule one lease renewal without keeping the process alive on its own. */
function scheduleRenewal(projectDir: string, entry: HeldClaim): void {
  const intervalMs = Math.max(1, Math.floor(entry.ttlMs / CLAIM_RENEWAL_DIVISOR));
  entry.timer = setTimeout(() => {
    entry.timer = undefined;
    entry.renewal = renewClaim(projectDir, entry).finally(() => {
      entry.renewal = undefined;
      if (isHeld(projectDir, entry)) scheduleRenewal(projectDir, entry);
    });
  }, intervalMs);
  entry.timer.unref?.();
}

/** Refresh the lease. A transient store error gets another attempt next tick. */
async function renewClaim(projectDir: string, entry: HeldClaim): Promise<void> {
  if (!isHeld(projectDir, entry)) return;
  try {
    const renewed = await entry.store.claim(entry.taskId, { ttlMs: entry.ttlMs });
    if (!renewed && isHeld(projectDir, entry)) forgetClaim(projectDir, entry.taskId);
  } catch {
    // Advisory state: retry while the claim remains in this run's ledger.
  }
}

/**
 * Claim `taskId` for this run.
 *
 * Returns `null` on success, or the claim that blocked us — the holder, not a
 * bare `false`, because every caller that loses this race has to tell the
 * operator *which* checkout to go and look at. Outside a git repository the
 * store is a no-op and the claim always succeeds, which is the pre-claims
 * behaviour. `ttlMs` is primarily a deterministic-test seam; production
 * callers use rex's default four-hour lease.
 */
export async function claimTask(
  projectDir: string,
  taskId: string,
  options?: { ttlMs?: number },
): Promise<TaskClaim | null> {
  const store = openClaimsStore(projectDir);
  const ttlMs = options?.ttlMs ?? DEFAULT_CLAIM_TTL_MS;
  if (await store.claim(taskId, { ttlMs })) {
    forgetClaim(projectDir, taskId);
    const entry: HeldClaim = { store, taskId, ttlMs };
    ledgerFor(projectDir).set(taskId, entry);
    if (store.path) scheduleRenewal(projectDir, entry);
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

/** Render the holder accurately for same-worktree and cross-worktree collisions. */
export function describeTaskClaimHolder(projectDir: string, holder: TaskClaim): string {
  const worktreeRoot = getWorktreeRoot(projectDir) ?? projectDir;
  return holder.worktreeRoot === worktreeRoot
    ? `another process in this worktree (${holder.worktreeRoot})`
    : `another worktree (${holder.worktreeRoot})`;
}

/**
 * Hand one task back. Safe to call for a task that was never claimed.
 *
 * TODO(PR #371 follow-up): call this after each loop iteration once its
 * terminal outcome is known. A claim retained for an uncommitted-work refusal
 * must remain recoverable; completed and ordinary failed iterations should not
 * stay reserved until the entire loop exits.
 */
export async function releaseTask(projectDir: string, taskId: string): Promise<void> {
  const entry = forgetClaim(projectDir, taskId);
  await entry?.renewal;
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
  const claims = held.get(projectDir);
  if (!claims || claims.size === 0) return;
  held.delete(projectDir);

  for (const entry of claims.values()) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = undefined;
  }

  for (const entry of claims.values()) {
    try {
      await entry.renewal;
      await entry.store.release(entry.taskId);
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
  for (const claims of held.values()) {
    for (const entry of claims.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
  }
  held.clear();
}
