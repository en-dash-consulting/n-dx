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

export class TaskClaims {
  /** Task ids this instance has claimed and not yet released. */
  readonly held = new Set<string>();

  constructor(
    readonly store: ClaimsStore,
    readonly holder: ClaimHolder,
  ) {}

  /** Claims for the repository containing `projectDir`; a no-op outside one. */
  static forProject(projectDir: string): TaskClaims {
    return new TaskClaims(openClaimsStore(projectDir), resolveClaimHolder(projectDir));
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
    const result = await this.store.claim(taskId, { worktreeRoot: this.holder.worktreeRoot, pid: this.holder.pid });
    if (!result.ok) return result.heldBy;
    this.held.add(taskId);
    return null;
  }

  /** Release one claim this run holds. */
  async release(taskId: string): Promise<void> {
    if (!this.held.delete(taskId)) return;
    await this.store.release(taskId, this.holder);
  }

  /** Release everything this run still holds. Errors are swallowed: the run is already over. */
  async releaseAll(): Promise<void> {
    for (const taskId of [...this.held]) {
      try {
        await this.release(taskId);
      } catch {
        // The claim dies with this pid anyway.
      }
    }
  }
}
