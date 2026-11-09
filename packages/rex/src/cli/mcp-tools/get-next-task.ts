import { z } from "zod";
import { findNextTask, collectCompletedIds, explainSelection } from "../../core/next-task.js";
import { completedWorkIds, findNextWorkTask } from "../../core/change-next-task.js";
import { workSetFinishedMessage, type EarlierUse, type WorkSet } from "../../core/work-set.js";
import { isChangeLayerStore, type PRDStore } from "../../store/index.js";
import type { ChangeLayerStore } from "../../store/change-layer-store.js";
import { collectForeignClaims, type ClaimsContext, type SkippedClaim } from "./claims.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";

export interface GetNextTaskArgs {
  tags?: string[];
  /** Pick outside the current branch's work set. */
  any?: boolean;
}

/**
 * `projectDir` is the session's resolved workspace. When given on a v2 tree,
 * selection is narrowed to its checked-out branch's work set
 * (`findNextWorkTask`'s, by `currentWorkSet`'s rule) unless `args.any`;
 * omitted, it is not narrowed. Units from an earlier branch of the same name
 * are reported as `earlierUse`.
 */
export async function handleGetNextTask(
  store: PRDStore,
  args?: GetNextTaskArgs,
  claims?: ClaimsContext,
  projectDir?: string,
): Promise<McpResult> {
  try {
    if (isChangeLayerStore(store)) return await handleGetNextV2Work(store, args, claims, projectDir);
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
 * `parentChain[].type` and `changeId`, the change the unit belongs to. When
 * selection was narrowed to a work set, `workSetBranch` names its branch.
 */
async function handleGetNextV2Work(
  store: ChangeLayerStore,
  args: GetNextTaskArgs | undefined,
  claims: ClaimsContext | undefined,
  projectDir: string | undefined,
): Promise<McpResult> {
  const tree = await store.loadTree();
  const { excludeIds, skipped } = await collectForeignClaims(claims);
  const completed = completedWorkIds(tree);
  const skippedClaimed = skipped.filter((c) => !completed.has(c.taskId));
  const select = { excludeIds, tags: args?.tags };
  const { task: next, workSet, earlierUse } = projectDir
    ? findNextWorkTask(tree, { ...select, workspace: projectDir, any: args?.any === true })
    : { task: findNextWorkTask(tree, select), workSet: null, earlierUse: null };
  const workSetField = {
    ...(workSet ? { workSetBranch: workSet.branch } : {}),
    ...(earlierUse ? { earlierUse } : {}),
  };
  if (!next) return noneLeft(skippedClaimed, workSetField, workSet);
  return textResult(
    JSON.stringify(
      {
        item: next.item,
        parentChain: next.parents.map((p) => ({ id: p.id, title: p.title, level: p.level, type: p.type })),
        explanation: next.explanation,
        changeId: next.unit.change.id,
        ...workSetField,
        ...(skippedClaimed.length > 0 ? { skippedClaimed } : {}),
      },
      null,
      2,
    ),
  );
}

function noneLeft(
  skippedClaimed: SkippedClaim[],
  workSetField: { workSetBranch?: string; earlierUse?: EarlierUse } = {},
  workSet: WorkSet | null = null,
): McpResult {
  const message = workSet
    ? workSet.ids.length === 0 ? workSetFinishedMessage("any: true") : WORK_SET_EXHAUSTED_MCP
    : skippedClaimed.length > 0
      ? `No actionable tasks remaining that are not claimed by another worktree (${skippedClaimed.length} claimed elsewhere)`
      : "No actionable tasks remaining";
  return textResult(JSON.stringify({
    next: null,
    message,
    ...workSetField,
    ...(skippedClaimed.length > 0 ? { skippedClaimed } : {}),
  }));
}

/** `rex next`'s `WORK_SET_EXHAUSTED`, naming the tool's argument instead of the flag. */
const WORK_SET_EXHAUSTED_MCP = "Nothing left in this branch's work set; any: true picks outside it";

export const getNextTaskTool = defineTool({
  name: "get_next_task",
  description: "Get the next actionable task based on priority and dependencies, with explanation of why it was selected. Use when the user asks what to work on next. On a v2 tree, `type` (change, task or subtask) is authoritative; `level` is the v1 projection, kept for compatibility until v1 is refused.",
  schema: {
    tags: z.array(z.string()).optional().describe("Only return tasks that have at least one of these tags. Omit to return any task regardless of tags."),
    any: z.boolean().optional().describe("Pick outside the current branch's work set. Without it, on a branch with assigned tasks (v2), only those are picked."),
  },
  access: "read",
  run: (ws, args) => handleGetNextTask(ws.store, args, ws.claims, ws.projectDir),
});
