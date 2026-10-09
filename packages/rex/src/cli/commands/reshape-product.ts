/**
 * The product-layer pass of `rex reshape` on a v2 tree.
 *
 * Proposals on product nodes never move a product file: the accepted ones
 * become one drafted change whose `removed` and `added` (and, for a merge or
 * an update, `modified`) amendments describe the restructure
 * (`core/product-reshape.ts`). Applying it is a steward's call:
 * `rex change apply`.
 */

import type { PRDItem } from "../../schema/index.js";
import type { ReshapeProposal } from "../../core/reshape.js";
import { addProductReshapeChange, draftProductReshape, type ProductReshapeDraft, type SkippedProposal } from "../../core/product-reshape.js";
import type { RuleNode } from "../../schema/v2-rules.js";
import type { LLMVendor } from "@n-dx/llm-client";
import { withPrdModelTransaction } from "../../store/prd-model-transaction.js";
import { reasonForReshape, formatReshapeProposal } from "../../analyze/reshape-reason.js";
import { classifyLLMError } from "../llm-error-classifier.js";
import { CLIError } from "../errors.js";
import { info, startSpinner } from "../output.js";
import type { PRDStore } from "../../store/index.js";

export interface ProductReshapeSummary {
  proposals: Array<{ id: string } & ReshapeProposal["action"]>;
  /** The drafted change, when proposals were accepted and at least one could be expressed. */
  change?: { id: string; label: string; amendments: number };
  skipped: SkippedProposal[];
}

export interface ProductReshapeOptions {
  dir: string;
  rexDir: string;
  store: PRDStore;
  items: PRDItem[];
  model: string;
  vendor: LLMVendor;
  dryRun: boolean;
  accept: boolean;
  review: (proposals: ReshapeProposal[], items: PRDItem[]) => Promise<ReshapeProposal[]>;
}

/** Propose a reshape of the product layer and, once accepted, draft it as one change. */
export async function reshapeProductLayer(opts: ProductReshapeOptions): Promise<ProductReshapeSummary> {
  const spinner = startSpinner("Analyzing the product layer...");
  let proposals: ReshapeProposal[];
  try {
    proposals = (await reasonForReshape(opts.items, { dir: opts.dir, model: opts.model })).proposals;
    spinner.stop();
  } catch (err) {
    spinner.stop();
    const classified = classifyLLMError(err instanceof Error ? err : new Error(String(err)), opts.vendor, "analyze the product layer");
    throw new CLIError(classified.message, classified.suggestion, classified.code);
  }

  const summary: ProductReshapeSummary = { proposals: proposals.map((p) => ({ id: p.id, ...p.action })), skipped: [] };
  if (proposals.length === 0) {
    info("Product layer: no reshape proposals.");
    return summary;
  }

  info(`\nProduct layer: ${proposals.length} proposal${proposals.length === 1 ? "" : "s"}. Accepted ones are drafted as one change; no product file moves.\n`);
  proposals.forEach((p, i) => {
    info(`${i + 1}. ${formatReshapeProposal(p, opts.items)}`);
    info("");
  });
  if (opts.dryRun) return summary;

  let accepted: ReshapeProposal[];
  if (opts.accept) accepted = proposals;
  else if (process.stdin.isTTY) accepted = await opts.review(proposals, opts.items);
  else {
    info("Product-layer proposals shown above. Run with --accept to draft them as a change.");
    return summary;
  }
  if (accepted.length === 0) return summary;

  const now = new Date();
  const { result: drafted } = await withPrdModelTransaction<{ draft: ProductReshapeDraft; change?: RuleNode }>(opts.rexDir, (model) => {
    const draft = draftProductReshape(model.tree.product, accepted);
    if (draft.amends.length === 0) return { tree: model.tree, result: { draft, change: undefined } };
    const reasons = accepted.filter((p) => draft.drafted.includes(p.id)).map((p) => p.action.reason);
    const { tree, change } = addProductReshapeChange(model.tree, draft, reasons, now);
    return { tree, result: { draft, change } };
  });

  summary.skipped = drafted.draft.skipped;
  for (const skip of drafted.draft.skipped) {
    const index = proposals.findIndex((p) => p.id === skip.proposalId);
    info(`  Not drafted: proposal ${index + 1}: ${skip.reason}`);
  }
  if (!drafted.change) {
    info("No product-layer proposal could be drafted as an amendment.");
    return summary;
  }

  const label = drafted.change.displayId ?? drafted.change.id;
  summary.change = { id: drafted.change.id, label, amendments: drafted.draft.amends.length };
  info(`Drafted change ${label} "${drafted.change.title}" with ${drafted.draft.amends.length} amendment${drafted.draft.amends.length === 1 ? "" : "s"}.`);
  info(`  Review it in changes/${drafted.change.slug}/; apply it with 'rex change apply ${label}'.`);
  await opts.store.appendLog({
    timestamp: now.toISOString(),
    event: "reshape_product_drafted",
    itemId: drafted.change.id,
    detail: JSON.stringify({ amendments: drafted.draft.amends.length, drafted: drafted.draft.drafted.length, skipped: drafted.draft.skipped.length }),
  });
  return summary;
}
