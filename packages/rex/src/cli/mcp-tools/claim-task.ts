/**
 * Claims are how two worktrees of one repository avoid picking the same task.
 * `get_next_task` skips what is claimed elsewhere and `update_task_status`
 * claims on `in_progress`; `claim_task` and `release_task` make the hold
 * explicit for the gap between selecting a task and starting it.
 */

import { z } from "zod";
import { changeWorkShape } from "../../core/change-selection.js";
import { changeLayerType } from "../../core/layer-projection.js";
import type { PRDItem } from "../../schema/index.js";
import type { ChangeNodeType } from "../../schema/v2.js";
import { isChangeLayerStore, resolveItemRef, type PRDStore } from "../../store/index.js";
import { acquireWorkClaim, describeHeldClaim, type ClaimsContext } from "./claims.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";

/**
 * `claim_task` — hold a task for this worktree before the work starts.
 *
 * `update_task_status` claims on `in_progress`, but a session selects a task,
 * plans it and only then starts: without this, that window is exactly when the
 * other worktree picks the same task. Claiming at selection closes it.
 */
export async function handleClaimTask(
  store: PRDStore,
  args: { id: string },
  claims?: ClaimsContext,
): Promise<McpResult> {
  try {
    args = { id: await resolveItemRef(store, args.id) };
    const existing = await store.getItem(args.id);
    if (!existing) {
      return textResult(`Item "${args.id}" not found. Use get_prd_status to see available items.`, true);
    }
    const type = isChangeLayerStore(store) ? changeLayerType(existing) : undefined;
    const refusal = type ? changeLayerClaimRefusal(existing, type) : undefined;
    if (refusal) return textResult(refusal, true);
    if (!claims) {
      return textResult(JSON.stringify({ id: args.id, claimed: false, reason: "not a git repository — claims are a no-op here" }));
    }
    const attempt = await acquireWorkClaim(store, claims, args.id);
    if (!attempt.ok) return textResult(describeHeldClaim(args.id, attempt.heldBy), true);
    return textResult(JSON.stringify({
      id: args.id,
      title: existing.title,
      ...(type ? { type } : {}),
      claimed: true,
      worktreeRoot: attempt.claim?.worktreeRoot ?? claims.worktreeRoot,
      expiresAt: attempt.claim?.expiresAt ?? null,
    }));
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

/**
 * On a v2 tree the claimable unit is what selection offers ({@link changeWorkShape}):
 * a task, or a change with no live tasks or nested changes.
 */
function changeLayerClaimRefusal(item: PRDItem, type: ChangeNodeType): string | undefined {
  if (type === "subtask") return `"${item.id}" is a subtask: claim its task instead.`;
  if (type !== "change") return undefined;
  const shape = changeWorkShape(item);
  if (shape === "tasks") return `"${item.id}" is a change with tasks: claim one of its tasks instead.`;
  if (shape !== "container") return undefined;
  const nested = (item.children ?? []).filter((c) => (c.type === "change" || c.type === "task") && c.status !== "deleted");
  return `"${item.id}" is a change that holds changes: claim one of its nested changes or tasks instead (${nested.map((c) => `${c.type} ${c.id}`).join(", ")}).`;
}

export const claimTaskTool = defineTool({
  name: "claim_task",
  description: "Claim a task for this worktree so other worktrees' agents skip it. Use right after selecting a task, before planning or editing. Claims are released by update_task_status when the task reaches a terminal status, or by release_task.",
  schema: {
    id: z.string().describe("Task ID to claim"),
  },
  access: "write",
  run: (ws, args) => handleClaimTask(ws.store, args, ws.claims),
});
