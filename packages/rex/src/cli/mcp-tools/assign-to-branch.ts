/**
 * `assign_to_branch`: put changes and tasks on the current branch's work set,
 * or take them off (`remove`), in the session's resolved workspace.
 *
 * The branch is the checked-out one (`requireWorkSetBranch`): there is no
 * branch argument, so a session cannot write a set onto a branch it is not on.
 * Refused on the default branch and a detached HEAD, and, as every write tool
 * is, while the workspace is refused (`mcp.ts`).
 */

import { z } from "zod";
import {
  assignToBranch,
  describeUnits,
  inheritedUnits,
  requireWorkSetBranch,
  unassignFromBranch,
  WorkSetError,
} from "../../core/work-set.js";
import { prdLayout, loadPrdModel } from "../../store/prd-model-reader.js";
import { NO_PRODUCT_LAYER } from "./get-product.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";

export interface AssignToBranchArgs {
  ids: string[];
  remove?: boolean;
  move?: boolean;
}

export async function handleAssignToBranch(projectDir: string, rexDir: string, args: AssignToBranchArgs): Promise<McpResult> {
  try {
    if ((await prdLayout(rexDir)) !== "v2") return textResult(`${NO_PRODUCT_LAYER} Work sets are kept on a v2 PRD only.`, true);
    if (args.ids.length === 0) return textResult("ids is empty: name at least one change or task.", true);
    if (args.remove && args.move) return textResult("move applies to assigning: pass remove or move, not both.", true);
    const branch = requireWorkSetBranch(projectDir);

    if (args.remove) {
      const report = await unassignFromBranch(rexDir, args.ids, branch);
      const { tree } = await loadPrdModel(rexDir);
      const removed = describeUnits(tree, report.removed.map((r) => r.id));
      const inherited = inheritedUnits(tree, report.inherited);
      return textResult(JSON.stringify({ branch, removed, ...(inherited.length > 0 ? { inherited } : {}) }));
    }
    const report = await assignToBranch(rexDir, args.ids, branch, { move: args.move });
    const { tree } = await loadPrdModel(rexDir);
    const from = new Map(report.moved.map((m) => [m.id, m.from]));
    const assigned = describeUnits(tree, report.assigned).map((u) => (from.has(u.id) ? { ...u, movedFrom: from.get(u.id) } : u));
    return textResult(JSON.stringify({ branch, assigned, unchanged: describeUnits(tree, report.unchanged) }));
  } catch (err) {
    if (err instanceof WorkSetError) return textResult(err.message, true);
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export const assignToBranchTool = defineTool({
  name: "assign_to_branch",
  description:
    "Add changes and tasks to the current git branch's work set, or take them off with remove (v2 PRD). The work set is the tasks " +
    "assigned to the branch, recorded as delivery: { branch } in state.yaml; a task sits on at most one branch. A change id " +
    "assigns its open tasks (a change with no tasks counts as one task, and its branch covers the tasks it is later split into, " +
    "unless a task has its own). A task already on another branch is refused, naming it, unless move is true. Removing a change " +
    "takes off the tasks that inherit from it; a task that only inherits is listed under inherited with its change, unchanged. Acts on the checked-out branch of the session's workspace; refused on the default branch and on a " +
    "detached HEAD. Writes the PRD; commits nothing. Returns what was written (id, title, status; movedFrom for a moved task).",
  schema: {
    ids: z.array(z.string()).describe("Change or task ids, display ids (e.g. CH-12) or aliases"),
    remove: z.boolean().optional().describe("Take the named tasks off this branch's work set instead of adding them"),
    move: z.boolean().optional().describe("When adding: take over tasks that are on another branch instead of refusing"),
  },
  access: "write",
  run: (ws, args) => handleAssignToBranch(ws.projectDir, ws.rexDir, args),
});
