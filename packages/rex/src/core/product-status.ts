/**
 * Intent status and health of product nodes (capabilities and constraints).
 * Both are derived, never set: nothing here writes, and neither value has a
 * field in the intent or state schemas. They are read from the spec hash,
 * `metAt`, the last check results and the changes that amend or touch a node.
 *
 * ## Status
 *
 * The first row that holds wins:
 *
 * | Status    | When                                                          |
 * |-----------|---------------------------------------------------------------|
 * | retired   | an applied change amends it with delta `removed`              |
 * | changing  | an open change amends it                                      |
 * | proposed  | never met (`metAt` absent)                                    |
 * | revised   | the spec hash differs from `metAt`                            |
 * | met       | the hash equals `metAt`                                       |
 *
 * A failing check does not change the status; it shows on health only.
 *
 * ## Health
 *
 * `defective` when one of the node's checks fails (`skipped` does not), or
 * while an open change marked `fix: true` targets the node through `amends`
 * or `touches`; otherwise `ok`. The `fix` field on the change is the only way
 * an open change is identified as a fix: no history is read, so a bug no check
 * catches still shows once someone opens a change to repair it.
 *
 * @module rex/core/product-status
 */

import { indexTree, isAppliedChange, isOpenChange, nodeSpec, specHash, type RuleNode, type V2Tree } from "../schema/v2-rules.js";
import type { ChangeNode } from "../schema/v2.js";

export const INTENT_STATUSES = ["proposed", "changing", "met", "revised", "retired"] as const;
export type IntentStatus = (typeof INTENT_STATUSES)[number];

export const HEALTH_VALUES = ["ok", "defective"] as const;
export type Health = (typeof HEALTH_VALUES)[number];

export interface ProductStatus {
  status: IntentStatus;
  health: Health;
}

/** Status and health of every live capability and constraint, keyed by id. */
export function computeProductStatus(tree: V2Tree): Record<string, ProductStatus> {
  const index = indexTree(tree);
  const amended = new Set<string>();
  const retired = new Set<string>();
  const fixing = new Set<string>();

  for (const { node } of index.entries) {
    if (node.type !== "change") continue;
    const change = node as ChangeNode;
    const open = isOpenChange(node);
    for (const a of change.amends ?? []) {
      const target = index.resolve(a.target);
      if (!target) continue;
      if (open) amended.add(target.id);
      else if (a.delta === "removed" && isAppliedChange(node)) retired.add(target.id);
    }
    if (open && change.fix === true) {
      for (const ref of [...(change.amends ?? []).map((a) => a.target), ...(change.touches ?? [])]) {
        const target = index.resolve(ref);
        if (target) fixing.add(target.id);
      }
    }
  }

  const out: Record<string, ProductStatus> = {};
  for (const { node, root } of index.entries) {
    if (root !== "product" || (node.type !== "capability" && node.type !== "constraint")) continue;
    const checkFails = (node.checks ?? []).some((c) => c.result === "fail");
    const status: IntentStatus = retired.has(node.id)
      ? "retired"
      : amended.has(node.id)
        ? "changing"
        : !node.metAt
          ? "proposed"
          : specHash(nodeSpec(node)) !== node.metAt
            ? "revised"
            : "met";
    out[node.id] = { status, health: checkFails || fixing.has(node.id) ? "defective" : "ok" };
  }
  return out;
}
