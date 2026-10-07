import { z } from "zod";
import { findNextTask, collectCompletedIds, explainSelection } from "../../core/next-task.js";
import type { PRDStore } from "../../store/index.js";
import { collectForeignClaims, type ClaimsContext } from "./claims.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";

export async function handleGetNextTask(
  store: PRDStore,
  args?: { tags?: string[] },
  claims?: ClaimsContext,
): Promise<McpResult> {
  try {
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
    if (!result) {
      return textResult(JSON.stringify({
        next: null,
        message: skippedClaimed.length > 0
          ? `No actionable tasks remaining that are not claimed by another worktree (${skippedClaimed.length} claimed elsewhere)`
          : "No actionable tasks remaining",
        ...(skippedClaimed.length > 0 ? { skippedClaimed } : {}),
      }));
    }
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

export const getNextTaskTool = defineTool({
  name: "get_next_task",
  description: "Get the next actionable task based on priority and dependencies, with explanation of why it was selected. Use when the user asks what to work on next.",
  schema: {
    tags: z.array(z.string()).optional().describe("Only return tasks that have at least one of these tags. Omit to return any task regardless of tags."),
  },
  access: "read",
  run: (ws, args) => handleGetNextTask(ws.store, args, ws.claims),
});
