import { z } from "zod";
import { deleteItem, cleanBlockedByRefs } from "../../core/delete.js";
import { validateTransition } from "../../core/transitions.js";
import { computeTimestampUpdates } from "../../core/timestamps.js";
import { findAutoCompletions } from "../../core/parent-completion.js";
import { resolveRexPaths } from "../../store/index.js";
import { syncFolderTree } from "../commands/folder-tree-sync.js";
import { holdCompletionForRun, describeHeldCompletion } from "../completion-hold.js";
import type { PRDItem, ItemStatus } from "../../schema/index.js";
import type { PRDStore, TaskClaim } from "../../store/index.js";
import {
  acquireClaim,
  describeHeldClaim,
  CLAIM_RELEASING_STATUSES,
  type ClaimsContext,
} from "./claims.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";

export async function handleUpdateTaskStatus(
  store: PRDStore,
  projectDir: string,
  args: { id: string; status: string; force?: boolean; reason?: string; resolutionType?: string; resolutionDetail?: string },
  claims?: ClaimsContext,
): Promise<McpResult> {
  try {
    const { id, status, force, reason, resolutionType, resolutionDetail } = args;
    const existing = await store.getItem(id);
    if (!existing) {
      return textResult(`Item "${id}" not found. Use get_prd_status to see available items.`, true);
    }

    if (!force) {
      const transition = validateTransition(existing.status, status as ItemStatus);
      if (!transition.allowed) {
        return textResult(`${transition.message} Pass force: true to override.`, true);
      }
    }

    // A hench run in this worktree applies the completion itself, after its
    // test gate — see cli/completion-hold.ts. Recorded, not written: no PRD
    // save, no claim release, and nothing in the tree for `git add -A`.
    if (status === "completed") {
      const held = await holdCompletionForRun(claims, id, { resolutionType, resolutionDetail });
      if (held) {
        await store.appendLog({
          timestamp: new Date().toISOString(),
          event: "completion_held",
          itemId: id,
          detail: `Completion held for hench run (pid ${held.pid}) until its test gate passes`,
        });
        return textResult(JSON.stringify({
          id,
          title: existing.title,
          previousStatus: existing.status,
          newStatus: existing.status,
          completionHeld: true,
          message: describeHeldCompletion(id, held),
        }));
      }
    }

    // Starting work is where the claim is taken: it is the point the caller
    // commits to the task, and it is a step the ndx-work flow already
    // performs. Refuse rather than write a status that contradicts a live
    // claim held by another worktree — that is the double-pick this prevents.
    let claimed: TaskClaim | null = null;
    if (status === "in_progress") {
      const attempt = await acquireClaim(claims, id);
      if (!attempt.ok) {
        if (!force) return textResult(describeHeldClaim(id, attempt.heldBy), true);
      } else {
        claimed = attempt.claim;
      }
    }

    // Handle deletion: remove item and children from tree. The transaction
    // holds the PRD lock across the whole read-modify-write so a concurrent
    // writer's item cannot be clobbered by this full-document save.
    if (status === "deleted") {
      if (claims) await claims.store.release(id, { worktreeRoot: claims.worktreeRoot });
      const deletedIds = await store.withTransaction(async (doc) => {
        const ids = deleteItem(doc.items, id);
        cleanBlockedByRefs(doc.items, new Set(ids));
        return ids;
      });

      await store.appendLog({
        timestamp: new Date().toISOString(),
        event: "item_deleted",
        itemId: id,
        detail: `Deleted ${existing.level}: ${existing.title} (${deletedIds.length} item(s) removed)`,
      });

      await syncFolderTree(resolveRexPaths(projectDir).rexDir, store);

      return textResult(
        JSON.stringify({
          id,
          title: existing.title,
          deleted: true,
          removedCount: deletedIds.length,
          removedIds: deletedIds,
        }),
      );
    }

    const tsUpdates = computeTimestampUpdates(existing.status, status as ItemStatus, existing);
    const statusUpdates: Partial<PRDItem> = { status: status as ItemStatus, ...tsUpdates };
    if (status === "failing" && reason) {
      statusUpdates.failureReason = reason;
    }
    if (status === "completed" && resolutionType) {
      statusUpdates.resolutionType = resolutionType as PRDItem["resolutionType"];
    }
    if (status === "completed" && resolutionDetail) {
      statusUpdates.resolutionDetail = resolutionDetail;
    }
    await store.updateItem(id, statusUpdates, { applyAttribution: true, projectDir });
    // The task is no longer being worked here, so the claim must not outlive
    // the run — otherwise the next worktree to ask is told it is taken for the
    // rest of the TTL.
    if (claims && CLAIM_RELEASING_STATUSES.has(status)) await claims.store.release(id, { worktreeRoot: claims.worktreeRoot });
    await store.appendLog({
      timestamp: new Date().toISOString(),
      event: "status_changed",
      itemId: id,
      detail: `${existing.status} → ${status}${force ? " (forced)" : ""}`,
    });

    // Re-check parent auto-completion after this status change. A deferred
    // status can never itself make a parent auto-completable (only a fully
    // `completed` child set can — see parent-completion.ts), but re-checking
    // here is harmless and keeps this in sync with add-item's trigger.
    const autoCompleted: Array<{ id: string; title: string; level: string }> = [];
    if (status === "completed" || status === "deferred") {
      const doc = await store.loadDocument();
      const { completedItems } = findAutoCompletions(doc.items, id);

      for (const item of completedItems) {
        const parentItem = await store.getItem(item.id);
        if (!parentItem) continue;

        const parentTsUpdates = computeTimestampUpdates(
          parentItem.status,
          "completed",
          parentItem,
        );
        await store.updateItem(item.id, {
          status: "completed" as ItemStatus,
          ...parentTsUpdates,
          // Cascaded close, not a deliberate edit of this ancestor — leave its
          // authorship with whoever last touched it on purpose (#368).
        }, { applyAttribution: true, preserveModifiedBy: true, projectDir });
        await store.appendLog({
          timestamp: new Date().toISOString(),
          event: "auto_completed",
          itemId: item.id,
          detail: `Auto-completed ${item.level}: ${item.title} (all children done)`,
        });
        autoCompleted.push(item);
      }
    }

    await syncFolderTree(resolveRexPaths(projectDir).rexDir, store);

    return textResult(
      JSON.stringify({
        id,
        title: existing.title,
        previousStatus: existing.status,
        newStatus: status,
        ...(claimed ? { claim: { worktreeRoot: claimed.worktreeRoot, pid: claimed.pid, expiresAt: claimed.expiresAt } } : {}),
        ...(autoCompleted.length > 0 ? { autoCompleted } : {}),
      }),
    );
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export const updateTaskStatusTool = defineTool({
  name: "update_task_status",
  description: "Update the status of a PRD item. Use when starting work (in_progress), finishing (completed), or encountering blockers.",
  schema: {
    id: z.string().describe("Item ID"),
    status: z.enum(["pending", "in_progress", "completed", "failing", "deferred", "blocked", "cancelled", "deleted"]).describe("New status"),
    force: z.boolean().optional().describe("Force the transition even if it violates transition rules (e.g. completed → pending)"),
    reason: z.string().optional().describe("Failure reason (used when status is 'failing')"),
    resolutionType: z.enum(["code-change", "config-override", "acknowledgment", "deferred", "unclassified"]).optional().describe("How the task was resolved (required when status is 'completed')"),
    resolutionDetail: z.string().optional().describe("Brief description of how the resolution was achieved"),
  },
  access: "write",
  run: (ws, args) => handleUpdateTaskStatus(ws.store, ws.projectDir, args, ws.claims),
});
