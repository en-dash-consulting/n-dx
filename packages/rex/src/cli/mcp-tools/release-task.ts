import { z } from "zod";
import { resolveItemRef, type PRDStore } from "../../store/index.js";
import type { ClaimsContext } from "./claims.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";

/** `release_task` — give a claim back without moving the task's status. */
export async function handleReleaseTask(
  store: PRDStore,
  args: { id: string },
  claims?: ClaimsContext,
): Promise<McpResult> {
  try {
    // Claims are keyed by node id; a v2 display id or alias is what claim_task accepted.
    args = { id: await resolveItemRef(store, args.id) };
    const released = claims ? await claims.store.release(args.id, { worktreeRoot: claims.worktreeRoot }) : false;
    if (!released && claims) {
      const runClaim = (await claims.store.readClaims()).find(
        (c) => c.taskId === args.id && c.holdsCompletion && c.worktreeRoot === claims.worktreeRoot,
      );
      if (runClaim) {
        return textResult(JSON.stringify({
          id: args.id,
          released: false,
          reason: `held by the hench run working this task (pid ${runClaim.pid}); it releases the claim when the run ends`,
        }));
      }
    }
    return textResult(JSON.stringify({ id: args.id, released }));
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export const releaseTaskTool = defineTool({
  name: "release_task",
  description: "Release this worktree's claim on a task without changing its status. Use when abandoning a task you claimed but did not finish.",
  schema: {
    id: z.string().describe("Task ID to release"),
  },
  access: "write",
  run: (ws, args) => handleReleaseTask(ws.store, args, ws.claims),
});
