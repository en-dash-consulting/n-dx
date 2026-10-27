/**
 * `place_change`: rank where a v2 change belongs on the product layer, or
 * record the placement chosen.
 *
 * Without `target` it reads: the rules' shortlist and relation. With `target`
 * it writes the change's `touches` or a `modified` amendment and clears
 * `needsPlacement` (`core/change-place.ts`). An amendment takes its
 * `proposed` text and `criteria` delta here: no other tool edits a v2
 * amendment, and an amends placement with neither is refused, as apply would.
 * With `propose` instead of `target` it records a new capability or
 * constraint under a live area (`recordProposal`), for when nothing fits.
 */

import { z } from "zod";
import { ChangePlacementError, PLACEMENT_CONTENT_NEEDS_AMENDS, recordPlacement, recordProposal, suggestPlacement } from "../../core/change-place.js";
import { AmendmentSchema, CriterionSchema, type AddedNodeType, type CriteriaDelta, type Criterion } from "../../schema/v2.js";
import { loadPrdModel, prdLayout } from "../../store/prd-model-reader.js";
import { withPrdModelTransaction } from "../../store/prd-model-transaction.js";
import type { PRDStore } from "../../store/index.js";
import { NO_PRODUCT_LAYER } from "./get-product.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";
import { systemClock, type Clock } from "./clock.js";

export interface PlaceChangeArgs {
  id: string;
  target?: string;
  relation?: "touches" | "amends";
  summary?: string;
  proposed?: string;
  criteria?: CriteriaDelta;
  propose?: ProposeArgs;
}

export interface ProposeArgs {
  type: AddedNodeType;
  under: string;
  title: string;
  summary?: string;
  proposed?: string;
  criteria?: { add: Criterion[] };
}

export async function handlePlaceChange(store: PRDStore, rexDir: string, args: PlaceChangeArgs, clock: Clock = systemClock): Promise<McpResult> {
  try {
    if ((await prdLayout(rexDir)) !== "v2") return textResult(`${NO_PRODUCT_LAYER} Changes are placed on a v2 PRD only.`, true);
    if (args.propose !== undefined) {
      const { target, relation, summary, proposed, criteria } = args;
      if ([target, relation, summary, proposed, criteria].some((v) => v !== undefined)) {
        return textResult("propose records a new node and carries its own summary, proposed and criteria: pass target or propose, not both.", true);
      }
      return await handlePropose(store, rexDir, args.id, args.propose, clock);
    }
    // Explicit, not the rules' default: content written onto an amendment should not hang on a ranking.
    if ((args.proposed !== undefined || args.criteria !== undefined) && (args.target === undefined || args.relation !== "amends")) {
      return textResult(PLACEMENT_CONTENT_NEEDS_AMENDS, true);
    }
    if (args.target === undefined) {
      if (args.relation !== undefined || args.summary !== undefined) {
        return textResult("relation and summary record a placement: pass target with them, or leave all three out for the shortlist.", true);
      }
      const { tree } = await loadPrdModel(rexDir);
      return textResult(JSON.stringify(suggestPlacement(tree, args.id), null, 2));
    }
    const target = args.target;
    let now!: Date;
    const { result } = await withPrdModelTransaction(rexDir, (model) => {
      now = clock();
      const { relation, summary, proposed, criteria } = args;
      const placed = recordPlacement(model.tree, args.id, { target, relation, summary, proposed, criteria }, now);
      return { tree: placed.tree, result: placed };
    });
    const { change, placement, warnings } = result;
    await store.appendLog({
      timestamp: now.toISOString(),
      event: "change_placed",
      itemId: change,
      detail: `${placement.relation} ${placement.target}`,
    });
    return textResult(JSON.stringify({ change, ...placement, ...(warnings.length ? { warnings } : {}) }));
  } catch (err) {
    if (err instanceof ChangePlacementError) return textResult(err.message, true);
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

async function handlePropose(store: PRDStore, rexDir: string, id: string, propose: ProposeArgs, clock: Clock): Promise<McpResult> {
  let now!: Date;
  const { result } = await withPrdModelTransaction(rexDir, (model) => {
    now = clock();
    const recorded = recordProposal(model.tree, id, propose, now);
    return { tree: recorded.tree, result: recorded };
  });
  const { change, proposal, warnings } = result;
  await store.appendLog({
    timestamp: now.toISOString(),
    event: "change_proposed",
    itemId: change,
    detail: `${proposal.type} under ${proposal.under}: ${proposal.title}`,
  });
  const proposed = { target: proposal.target, under: proposal.under, title: proposal.title, type: proposal.type };
  return textResult(JSON.stringify({ change, proposed, ...(warnings.length ? { warnings } : {}) }));
}

export const placeChangeTool = defineTool({
  name: "place_change",
  description:
    "Place a v2 change on the product layer. Without target: returns the rules' shortlist of capabilities and constraints the change " +
    "could amend or touch, best first, each with a strength (strong, possible or weak), the relation the rules chose, and tied when the " +
    "top two share a score (their order is then arbitrary). With target: records it (touches joins the change's touches; " +
    "amends adds a modified amendment and needs proposed text or a criteria delta, or it is refused as apply_change would) and clears needsPlacement. " +
    "When nothing on the shortlist fits, pass propose instead of target to record a new capability or constraint under a live area " +
    "(an added amendment; it joins the product layer only when the change is applied), which also clears needsPlacement. " +
    "Only an open change is placed.",
  schema: {
    id: z.string().describe("Change id, display id (e.g. CH-12) or alias"),
    target: z.string().optional().describe("Capability or constraint to place the change on. Omit to get the shortlist without writing"),
    relation: z.enum(["touches", "amends"]).optional().describe("With target: touches (works on it) or amends (edits its requirements). Default: the rules' relation"),
    summary: z.string().optional().describe("With target and relation amends: the amendment's summary. Default: the change's title"),
    proposed: z.string().optional().describe("With target and relation amends: the target's replacement statement. Required with amends unless criteria is given"),
    criteria: AmendmentSchema.shape.criteria.describe(
      "With target and relation amends: capability criteria edits ({add?: [{id, text}], replace?: [{id, text}], remove?: [id]}). Required with amends unless proposed is given",
    ),
    propose: z
      .object({
        type: z.enum(["capability", "constraint"]).describe("The kind of node proposed"),
        under: z.string().describe("Live area (id, display id or alias) the new node goes under; see get_product"),
        title: z.string().describe("The new node's title"),
        summary: z.string().optional().describe("The amendment's summary. Default: the change's title"),
        proposed: z.string().optional().describe("The new node's statement"),
        criteria: z.object({ add: z.array(CriterionSchema) }).optional().describe("A new capability's capability criteria ({add: [{id, text}]}); a constraint has none"),
      })
      .optional()
      .describe("Instead of target, when nothing on the shortlist fits: propose a new capability or constraint. Not with target, relation, summary, proposed or criteria"),
  },
  access: (args) => (args.target === undefined && args.propose === undefined ? "read" : "write"),
  run: (ws, args) => handlePlaceChange(ws.store, ws.rexDir, args),
});
