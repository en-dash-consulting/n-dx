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
 * | retired   | deleted, and an applied change amends it with delta `removed` |
 * | changing  | a building change amends it or a parent capability            |
 * | proposed  | never met (`metAt` absent)                                    |
 * | revised   | the spec hash differs from `metAt`                            |
 * | met       | the hash equals `metAt`                                       |
 *
 * A building change is open and either started or placed
 * ({@link isBuildingChange}), so an untouched Inbox draft leaves the node it
 * amends revised. A sub-capability inherits its parent's criteria, so it reads
 * changing while its parent does. A failing check does not change the status;
 * it shows on health only.
 *
 * Apply retires a node by setting it `deleted`, so refs resolve against the
 * tombstone-aware {@link productIndex}. A deleted node is reported only when
 * retired; one no applied change removed, and a node under a deleted parent,
 * have no row.
 *
 * ## Health
 *
 * `defective` when one of the node's current checks fails (`skipped` does
 * not), or while an open change marked `fix: true` targets the node through
 * `amends` or `touches`; otherwise `ok`. A check counts only when its
 * `requirementId` is one of the node's requirements, and per requirement the
 * result with the latest `at` wins. The `fix` field on the change is the only
 * way an open change is identified as a fix: no history is read, so a bug no
 * check catches still shows once someone opens a change to repair it.
 *
 * A retired node is always `ok`: it has no requirement left to fail, so its
 * last checks and any fix still aimed at it are stale.
 *
 * @module rex/core/product-status
 */

import { changingNodes, isAppliedChange, isOpenChange, nodeSpec, specHash, type RuleNode, type V2Tree } from "../schema/v2-rules.js";
import type { ChangeNode, CheckResult } from "../schema/v2.js";
import { productIndex } from "./product-edges.js";

export const INTENT_STATUSES = ["proposed", "changing", "met", "revised", "retired"] as const;
export type IntentStatus = (typeof INTENT_STATUSES)[number];

export const HEALTH_VALUES = ["ok", "defective"] as const;
export type Health = (typeof HEALTH_VALUES)[number];

export interface ProductStatus {
  status: IntentStatus;
  health: Health;
}

/** Status and health of every live or retired capability and constraint, keyed by id. */
export function computeProductStatus(tree: V2Tree): Record<string, ProductStatus> {
  const index = productIndex(tree);
  const changing = changingNodes(index);
  const retired = new Set<string>();
  const fixing = new Set<string>();

  for (const { node, retired: deleted } of index.entries) {
    if (node.type !== "change" || deleted) continue;
    const change = node as ChangeNode;
    if (isAppliedChange(node)) {
      for (const a of change.amends ?? []) {
        const target = a.delta === "removed" ? index.resolve(a.target) : undefined;
        if (target) retired.add(target.id);
      }
    }
    if (isOpenChange(node) && change.fix === true) {
      for (const ref of [...(change.amends ?? []).map((a) => a.target), ...(change.touches ?? [])]) {
        const target = index.resolve(ref);
        if (target) fixing.add(target.id);
      }
    }
  }

  const out: Record<string, ProductStatus> = {};
  for (const { node, root, retired: tombstone } of index.entries) {
    if (root !== "product" || (node.type !== "capability" && node.type !== "constraint")) continue;
    const isRetired = node.status === "deleted" && retired.has(node.id);
    if (tombstone && !isRetired) continue;
    const status: IntentStatus = isRetired
      ? "retired"
      : changing.has(node)
        ? "changing"
        : !node.metAt
          ? "proposed"
          : specHash(nodeSpec(node)) !== node.metAt
            ? "revised"
            : "met";
    const defective = !isRetired && (fixing.has(node.id) || currentChecks(node).some((c) => c.result === "fail"));
    out[node.id] = { status, health: defective ? "defective" : "ok" };
  }
  return out;
}

/**
 * The checks that still count: one per current requirement, the one with the
 * latest `at` (the later entry on a tie or an unparsable stamp).
 */
function currentChecks(node: RuleNode): CheckResult[] {
  const requirements = node.type === "capability" || node.type === "constraint" ? (node.requirements ?? []) : [];
  const current = new Set(requirements.map((r) => r.id));
  const latest = new Map<string, CheckResult>();
  for (const c of node.checks ?? []) {
    if (!current.has(c.requirementId)) continue;
    const held = latest.get(c.requirementId);
    if (!held || !(Date.parse(c.at) < Date.parse(held.at))) latest.set(c.requirementId, c);
  }
  return [...latest.values()];
}
