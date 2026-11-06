/**
 * `apply_change`: a steward applies an open v2 change's amendments to the
 * product layer, whatever `rex.applyOn` says, through `core/apply-change.ts`,
 * the entry the dashboard's Apply shares.
 * Operator-only: not on hench's agent allowlist.
 */

import { z } from "zod";
import { NOTHING_TO_MODIFY } from "../../core/apply-amendments.js";
import { applyChange } from "../../core/apply-change.js";
import { prdLayout } from "../../store/prd-model-reader.js";
import type { PRDStore } from "../../store/index.js";
import { NO_PRODUCT_LAYER } from "./get-product.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";
import { systemClock, type Clock } from "./clock.js";

export async function handleApplyChange(
  store: PRDStore,
  rexDir: string,
  args: { id: string; force?: boolean },
  clock: Clock = systemClock,
): Promise<McpResult> {
  try {
    if ((await prdLayout(rexDir)) !== "v2") return textResult(`${NO_PRODUCT_LAYER} Changes are applied on a v2 PRD only.`, true);
    const outcome = await applyChange(rexDir, args.id, { force: args.force, clock });
    if (!outcome.ok) {
      const hint = outcome.problems.some((p) => p.endsWith(NOTHING_TO_MODIFY))
        ? " No tool edits a stored amendment: add proposed text or a criteria delta to it by hand, or cancel the change and place it again with place_change's proposed or criteria."
        : "";
      return textResult(outcome.message + hint, true);
    }
    // Logged and returned by id: args.id may be a display id, which can later name another change.
    const { change, appliedAt } = outcome;
    const applied = outcome.applied.map(({ delta, nodeId, summary }) => ({ delta, nodeId, summary }));
    await store.appendLog({
      timestamp: appliedAt,
      event: "change_applied",
      itemId: change,
      detail: applied.length ? applied.map((a) => `${a.delta} ${a.nodeId}`).join(", ") : "no amendments",
    });
    return textResult(JSON.stringify({ change, appliedAt, applied }));
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export const applyChangeTool = defineTool({
  name: "apply_change",
  description:
    "Apply an open v2 change's amendments to the product layer as a steward, whatever rex.applyOn says: added nodes are created, " +
    "modified ones edited, removed ones retired, and the change is stamped appliedAt. The whole apply is refused, listing every problem, " +
    "when a live task or nested change is not completed yet, when an amendment does not fit, or when its target's spec moved since it was drafted (force overrides that last check).",
  schema: {
    id: z.string().describe("Change id, display id (e.g. CH-12) or alias"),
    force: z.boolean().optional().describe("Apply amendments whose base no longer matches their target's spec"),
  },
  access: "write",
  run: (ws, args) => handleApplyChange(ws.store, ws.rexDir, args),
});
