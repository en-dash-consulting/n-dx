/**
 * `apply_change`: a steward applies an open v2 change's amendments to the
 * product layer, whatever `rex.applyOn` says (`core/apply-amendments.ts`).
 * Operator-only: not on hench's agent allowlist.
 */

import { z } from "zod";
import { applyAmendments, ApplyAmendmentsError } from "../../core/apply-amendments.js";
import { indexTree } from "../../schema/v2-rules.js";
import { prdLayout } from "../../store/prd-model-reader.js";
import { withPrdModelTransaction } from "../../store/prd-model-transaction.js";
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
    let appliedAt!: string;
    const { result } = await withPrdModelTransaction(rexDir, (model) => {
      const now = clock();
      appliedAt = now.toISOString();
      const out = applyAmendments(model.tree, args.id, { appliedAt, now, force: args.force });
      // Logged and returned by id: args.id may be a display id, which can later name another change.
      const change = indexTree(out.tree).resolve(args.id)!.id;
      return { tree: out.tree, result: { change, applied: out.applied } };
    });
    const { change, applied } = result;
    await store.appendLog({
      timestamp: appliedAt,
      event: "change_applied",
      itemId: change,
      detail: applied.length ? applied.map((a) => `${a.delta} ${a.nodeId}`).join(", ") : "no amendments",
    });
    return textResult(JSON.stringify({ change, appliedAt, applied }));
  } catch (err) {
    if (err instanceof ApplyAmendmentsError) return textResult(err.message, true);
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export const applyChangeTool = defineTool({
  name: "apply_change",
  description:
    "Apply an open v2 change's amendments to the product layer as a steward, whatever rex.applyOn says: added nodes are created, " +
    "modified ones edited, removed ones retired, and the change is stamped appliedAt. The whole apply is refused, listing every problem, " +
    "when an amendment does not fit or its target's spec moved since it was drafted (force overrides that last check).",
  schema: {
    id: z.string().describe("Change id, display id (e.g. CH-12) or alias"),
    force: z.boolean().optional().describe("Apply amendments whose base no longer matches their target's spec"),
  },
  access: "write",
  run: (ws, args) => handleApplyChange(ws.store, ws.rexDir, args),
});
