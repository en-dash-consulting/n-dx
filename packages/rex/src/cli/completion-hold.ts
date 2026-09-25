/**
 * The completion hold, as the two agent-reachable write paths apply it.
 *
 * A `hench run` claims its task with `holdsCompletion`, and applies the task's
 * completion itself once its full test gate passes. Its agent still marks the
 * task completed — through rex MCP (Claude CLI, Codex CLI, or the dashboard's
 * HTTP MCP) or with `rex update` from its shell — and that write must not
 * reach the PRD, because the agent's `git add -A && git commit` would carry
 * it into the work commit ahead of the gate (runs 6eacca42, 8dc53406).
 *
 * The claim is the signal, not an environment variable: it is visible to
 * every rex process in the repository whatever spawned it, including an MCP
 * server that inherits nothing from the run (HTTP transport, or a vendor that
 * scrubs the environment it hands MCP servers), and it dies with the run's
 * pid, so a crashed run cannot leave completions held.
 *
 * Outside a hench run no claim holds completion and both paths write exactly
 * as they always have.
 *
 * @module rex/cli/completion-hold
 */

import type { ClaimsStore, TaskClaim } from "../store/index.js";

export interface CompletionRequest {
  resolutionType?: string;
  resolutionDetail?: string;
}

/**
 * Record the completion on the run's claim instead of writing it, when a live
 * hench run in this worktree holds the task. Null means nothing holds it: the
 * caller writes the status as usual.
 */
export async function holdCompletionForRun(
  claims: { store: ClaimsStore; worktreeRoot: string } | undefined,
  taskId: string,
  request: CompletionRequest,
): Promise<TaskClaim | null> {
  if (!claims) return null;
  return claims.store.recordPendingCompletion(
    taskId,
    { worktreeRoot: claims.worktreeRoot },
    {
      ...(request.resolutionType ? { resolutionType: request.resolutionType } : {}),
      ...(request.resolutionDetail ? { resolutionDetail: request.resolutionDetail } : {}),
      requestedAt: new Date().toISOString(),
    },
  );
}

/**
 * What the agent is told. Worded so it neither retries nor reaches for another
 * way to write the status: the completion is recorded, and will land.
 */
export function describeHeldCompletion(taskId: string, claim: TaskClaim): string {
  return (
    `Completion of ${taskId} recorded, not yet applied: a hench run (pid ${claim.pid}) is working this task ` +
    `and marks it completed itself, with this resolution, once its full test gate passes. ` +
    `Nothing more to do — do not retry or mark it completed another way.`
  );
}
