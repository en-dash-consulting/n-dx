/**
 * The run's side of cross-worktree task claims.
 *
 * Two worktrees of one repository each have their own `.rex/prd_tree`, so
 * nothing in the PRD stops both from picking the same task. The claims store
 * (rex, `<git common dir>/ndx/claims.json`) is the one file both can see.
 * This module is what a `hench run` does with it:
 *
 * - before selecting, ask which tasks other worktrees hold and pass over them;
 * - the moment a task is selected — explicitly or automatically — claim it,
 *   before the pre-run gate, the brief, or any LLM turn;
 * - refresh what it holds for as long as it runs;
 * - when the run ends, however it ends, release what it claimed.
 *
 * A claim from the same worktree is never a conflict: a retry in the checkout
 * that already holds the task (after a crash, or a second attempt in a loop)
 * takes the claim over. Outside a git repository the underlying store is a
 * no-op and every method here degrades to "nothing is claimed".
 *
 * Release is best-effort by design. A process that dies without releasing
 * leaves a claim whose pid is dead, and the store treats that as no claim at
 * all — so a hard kill (second Ctrl-C, OOM) wedges nothing.
 *
 * ## Why a claim has to be refreshed
 *
 * A claim carries an expiry as well as a pid, and both have to fail before
 * it is ignored. The pid covers the common death — crash, kill, reboot — and
 * recovers in seconds. The expiry covers what the pid cannot see: a process
 * that is alive but no longer working the task, and any claim written by a
 * process on another machine, where `kill(pid, 0)` means nothing.
 *
 * That expiry is what makes refreshing necessary. A run longer than the TTL
 * would otherwise let its own claim lapse while it is still working, and the
 * next worktree to select would walk straight onto the task. Runs that long
 * are ordinary here — an `--epic-by-epic` pass over a large epic outlives a
 * four-hour claim comfortably — so the run refreshes on a timer rather than
 * assuming it will finish first. See {@link TaskClaims.startRenewal}.
 *
 * @module hench/process/task-claims
 */

import { openClaimsStore, resolveClaimHolder } from "../prd/rex-gateway.js";
import type { ClaimsStore, ClaimHolder, TaskClaim } from "../prd/rex-gateway.js";
import { CLIError } from "../prd/llm-gateway.js";

/** Thrown when an explicitly requested task is being worked on in another worktree. */
export class TaskClaimedElsewhereError extends CLIError {
  readonly taskId: string;
  readonly claim: TaskClaim;

  constructor(taskId: string, claim: TaskClaim, title?: string) {
    const label = title ? `"${title}" (${taskId})` : taskId;
    super(
      `Task ${label} is being worked on in another worktree: ${claim.worktreeRoot} (pid ${claim.pid}, claim expires ${claim.expiresAt}).`,
      "Pick a different task, wait for that run to finish, or run from that worktree — a run there takes the claim over.",
    );
    this.name = "TaskClaimedElsewhereError";
    this.taskId = taskId;
    this.claim = claim;
  }
}

/**
 * A claim this run held that another worktree has taken over.
 *
 * Emitted by the renewal timer, not by anything the run does, so it can
 * arrive at any point during a run. The run deliberately keeps going — see
 * {@link TaskClaims.renewNow} — which is exactly why it has to be said out
 * loud somewhere the operator is looking.
 */
export interface ClaimLostEvent {
  /** When the refusal was observed. */
  at: string;
  taskId: string;
  /** Worktree root that now holds the task. */
  holderWorktree: string;
}

/**
 * Never wake more often than this to refresh, however short a claim's life.
 * Guards against a tiny TTL (tests, a future per-call override) turning
 * renewal into a busy loop on the claims lock.
 */
const MIN_RENEWAL_INTERVAL_MS = 30_000;

/**
 * Never sleep longer than this between refreshes. Bounds how stale the
 * timer's view of the soonest expiry can get when claims are added while it
 * is already waiting.
 */
const MAX_RENEWAL_INTERVAL_MS = 15 * 60 * 1000;

export class TaskClaims {
  /** Task ids this instance has claimed and not yet released. */
  readonly held = new Set<string>();

  /** Expiry of each held claim, epoch ms. Drives when renewal next wakes. */
  private readonly expiries = new Map<string, number>();

  private renewalTimer: ReturnType<typeof setTimeout> | null = null;
  private renewalActive = false;

  /** The most recent claim this run lost to another worktree, if any. */
  claimLost: ClaimLostEvent | null = null;

  /**
   * Notified when a renewal is refused because another worktree took the
   * task. The run loop uses this to stamp the run record and save it, so the
   * dashboard's Sessions tray learns about it while the run is still going
   * rather than at the end. Set by `recordClaimLoss` in agent/lifecycle.
   */
  onClaimLost: ((event: ClaimLostEvent) => void) | null = null;

  constructor(
    readonly store: ClaimsStore,
    readonly holder: ClaimHolder,
    /**
     * Observe claims without writing any. A dry run reports what a real run
     * would meet — including a refusal — but must not take a claim, because
     * it does no work and the claim it took would refuse a real run starting
     * in another worktree during the preview.
     */
    readonly readOnly = false,
  ) {}

  /** Claims for the repository containing `projectDir`; a no-op outside one. */
  static forProject(projectDir: string, options: { readOnly?: boolean } = {}): TaskClaims {
    return new TaskClaims(
      openClaimsStore(projectDir),
      resolveClaimHolder(projectDir),
      options.readOnly ?? false,
    );
  }

  /** Ids of tasks other worktrees currently hold — what autoselection passes over. */
  async foreignClaims(): Promise<Map<string, TaskClaim>> {
    return this.store.claimedElsewhere(this.holder.worktreeRoot);
  }

  /** The live claim another worktree holds on `taskId`, or null. */
  async heldElsewhere(taskId: string): Promise<TaskClaim | null> {
    return this.store.isClaimedByOther(taskId, this.holder);
  }

  /**
   * Claim `taskId` for this run. Returns the foreign claim that refused it, or
   * null on success — the caller decides whether that is fatal (explicit
   * task) or a reason to pick another (autoselect).
   */
  async claim(taskId: string): Promise<TaskClaim | null> {
    // Read-only: answer the question the caller is really asking — "would a
    // real run be refused?" — and record nothing.
    if (this.readOnly) return this.heldElsewhere(taskId);

    const result = await this.store.claim(taskId, { worktreeRoot: this.holder.worktreeRoot, pid: this.holder.pid });
    if (!result.ok) return result.heldBy;
    this.held.add(taskId);
    this.noteExpiry(taskId, result.claim);
    // A claim taken after renewal started may expire sooner than whatever the
    // pending timer was aimed at, so re-aim it.
    if (this.renewalActive) this.scheduleRenewal();
    return null;
  }

  /** Release one claim this run holds. */
  async release(taskId: string): Promise<void> {
    if (!this.held.delete(taskId)) return;
    this.expiries.delete(taskId);
    await this.store.release(taskId, this.holder);
  }

  /**
   * Begin refreshing held claims until {@link stopRenewal}.
   *
   * Idempotent, and a no-op in read-only mode, where nothing is ever held.
   * The timer is `unref`ed: renewal keeps a claim alive for as long as the
   * run is alive, but never keeps the process alive on its own.
   */
  startRenewal(): void {
    if (this.readOnly || this.renewalActive) return;
    this.renewalActive = true;
    this.scheduleRenewal();
  }

  /** Stop refreshing. Safe to call when renewal never started. */
  stopRenewal(): void {
    this.renewalActive = false;
    if (this.renewalTimer) {
      clearTimeout(this.renewalTimer);
      this.renewalTimer = null;
    }
  }

  /**
   * Refresh every held claim once, moving each expiry forward.
   *
   * A refusal means this worktree no longer holds the task: the claim lapsed
   * and another worktree took it. The run keeps going — abandoning work in
   * progress would be worse than the overlap, and the other worktree is
   * already on it — but the task is dropped from `held` so this run cannot
   * later release a claim that is no longer its own.
   *
   * Exposed for tests; the timer is the only production caller.
   */
  async renewNow(): Promise<void> {
    for (const taskId of [...this.held]) {
      try {
        const result = await this.store.claim(taskId, {
          worktreeRoot: this.holder.worktreeRoot,
          pid: this.holder.pid,
        });
        if (result.ok) {
          this.noteExpiry(taskId, result.claim);
        } else {
          this.held.delete(taskId);
          this.expiries.delete(taskId);
          const event: ClaimLostEvent = {
            at: new Date().toISOString(),
            taskId,
            holderWorktree: result.heldBy.worktreeRoot,
          };
          this.claimLost = event;
          try {
            this.onClaimLost?.(event);
          } catch {
            // A listener that throws must not stop the remaining claims being
            // refreshed, nor fail a run that is otherwise fine.
          }
        }
      } catch {
        // Transient: a locked or unwritable store must not fail the run. The
        // claim keeps its current expiry and the next tick tries again.
      }
    }
  }

  /** Record when a claim lapses, so renewal knows when to wake. */
  private noteExpiry(taskId: string, claim: TaskClaim): void {
    const expires = Date.parse(claim.expiresAt);
    if (Number.isFinite(expires)) this.expiries.set(taskId, expires);
  }

  /**
   * Aim the timer at half the time left on the claim that lapses soonest, so
   * a refresh is attempted, and can fail once, before anything expires.
   * Derived from the claim the store actually wrote rather than from a TTL
   * constant here, so the two cannot drift apart.
   */
  private scheduleRenewal(): void {
    if (this.renewalTimer) {
      clearTimeout(this.renewalTimer);
      this.renewalTimer = null;
    }
    if (!this.renewalActive || this.expiries.size === 0) return;

    const soonest = Math.min(...this.expiries.values());
    const remaining = soonest - Date.now();
    const delay = Math.min(
      MAX_RENEWAL_INTERVAL_MS,
      Math.max(MIN_RENEWAL_INTERVAL_MS, remaining / 2),
    );

    this.renewalTimer = setTimeout(() => {
      void this.renewNow().finally(() => this.scheduleRenewal());
    }, delay);
    this.renewalTimer.unref?.();
  }

  /** Release everything this run still holds. Errors are swallowed: the run is already over. */
  async releaseAll(): Promise<void> {
    this.stopRenewal();
    for (const taskId of [...this.held]) {
      try {
        await this.release(taskId);
      } catch {
        // The claim dies with this pid anyway.
      }
    }
  }
}
