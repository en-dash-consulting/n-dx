import { z } from "zod";
import { findNextTask, collectCompletedIds, explainSelection } from "../../core/next-task.js";
import { completedWorkIds, findNextWorkTask } from "../../core/change-next-task.js";
import { isChangeLayerStore, type PRDStore } from "../../store/index.js";
import type { ChangeLayerStore } from "../../store/change-layer-store.js";
import { collectForeignClaims, type ClaimsContext, type SkippedClaim } from "./claims.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";

export async function handleGetNextTask(
  store: PRDStore,
  args?: { tags?: string[] },
  claims?: ClaimsContext,
): Promise<McpResult> {
  try {
    if (isChangeLayerStore(store)) return await handleGetNextV2Work(store, args, claims);
    const doc = await store.loadDocument();
    const completedIds = collectCompletedIds(doc.items);
    const { excludeIds, skipped } = await collectForeignClaims(claims);
    const options = {
      ...(args?.tags?.length ? { tags: args.tags } : {}),
      ...(excludeIds.size > 0 ? { excludeIds } : {}),
    };
    const result = findNextTask(doc.items, completedIds, options);
    // Only claims on tasks that would otherwise have been candidates matter to
    // the caller; a claim on a completed task is noise.
    const skippedClaimed = skipped.filter((c) => !completedIds.has(c.taskId));
    if (!result) return noneLeft(skippedClaimed);
    const explanation = explainSelection(doc.items, result, completedIds);
    return textResult(
      JSON.stringify(
        {
          item: result.item,
          parentChain: result.parents.map((p) => ({
            id: p.id,
            title: p.title,
            level: p.level,
          })),
          explanation,
          ...(skippedClaimed.length > 0 ? { skippedClaimed } : {}),
        },
        null,
        2,
      ),
    );
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

/**
 * A v2 tree selects through `findNextWork`: placed changes and their tasks,
 * task-less changes as units, never the Inbox. The answer keeps the v1 fields
 * and adds `item.type`, `item.displayId` (and the item's other v2 fields),
 * `parentChain[].type` and `changeId`, the change the unit belongs to.
 */
async function handleGetNextV2Work(
  store: ChangeLayerStore,
  args: { tags?: string[] } | undefined,
  claims: ClaimsContext | undefined,
): Promise<McpResult> {
  const tree = await store.loadTree();
  const { excludeIds, skipped } = await collectForeignClaims(claims);
  const completed = completedWorkIds(tree);
  const skippedClaimed = skipped.filter((c) => !completed.has(c.taskId));
  const next = findNextWorkTask(tree, { excludeIds, tags: args?.tags });
  if (!next) return noneLeft(skippedClaimed);
  return textResult(
    JSON.stringify(
      {
        item: next.item,
        parentChain: next.parents.map((p) => ({ id: p.id, title: p.title, level: p.level, type: p.type })),
        explanation: next.explanation,
        changeId: next.unit.change.id,
        ...(skippedClaimed.length > 0 ? { skippedClaimed } : {}),
      },
      null,
      2,
    ),
  );
}

function noneLeft(skippedClaimed: SkippedClaim[]): McpResult {
  return textResult(JSON.stringify({
    next: null,
    message: skippedClaimed.length > 0
      ? `No actionable tasks remaining that are not claimed by another worktree (${skippedClaimed.length} claimed elsewhere)`
      : "No actionable tasks remaining",
    ...(skippedClaimed.length > 0 ? { skippedClaimed } : {}),
  }));
}

export const getNextTaskTool = defineTool({
  name: "get_next_task",
  description: "Get the next actionable task based on priority and dependencies, with explanation of why it was selected. Use when the user asks what to work on next.",
  schema: {
    tags: z.array(z.string()).optional().describe("Only return tasks that have at least one of these tags. Omit to return any task regardless of tags."),
  },
  access: "read",
  run: (ws, args) => handleGetNextTask(ws.store, args, ws.claims),
});
