/**
 * `rex remove <id>` on a v2 PRD: delete a change, task or subtask and
 * everything under it, inside {@link withPrdModelTransaction} so the PRD lock
 * is held from the read to the write and the removal is logged.
 *
 * Product nodes are not removed here: a product node retires through an
 * applied change with a `removed` amendment. An applied change that records
 * where a product node came from, or marks one retired, stays
 * ({@link pruneKeepReason}).
 */

import { pruneKeepReason } from "../../core/prune.js";
import type { PRDItem } from "../../schema/index.js";
import { indexTree, type RuleNode, type V2Tree } from "../../schema/v2-rules.js";
import { resolveRexPaths, resolveStore } from "../../store/index.js";
import { withPrdModelTransaction } from "../../store/prd-model-transaction.js";
import { CLIError } from "../errors.js";
import { result } from "../output.js";
import { nodeLabel } from "./v2-cli.js";

/** Every node under `node`, itself included. */
function subtreeNodes(node: RuleNode): RuleNode[] {
  return [node, ...(node.children ?? []).flatMap(subtreeNodes)];
}

/** `nodes` without `gone`, and without `gone` ids in any `blockedBy`. */
function withoutNodes(nodes: RuleNode[], gone: ReadonlySet<string>): RuleNode[] {
  return nodes
    .filter((n) => !gone.has(n.id))
    .map((n) => {
      const blockedBy = n.blockedBy?.filter((b) => !gone.has(b));
      return {
        ...n,
        ...(blockedBy ? { blockedBy } : {}),
        ...(n.children ? { children: withoutNodes(n.children, gone) } : {}),
      };
    });
}

function count(n: number): string {
  return `${n} item${n === 1 ? "" : "s"}`;
}

export async function cmdRemoveChange(dir: string, ref: string, flags: Record<string, string>): Promise<void> {
  const rexDir = resolveRexPaths(dir).rexDir;
  const { result: removed } = await withPrdModelTransaction(rexDir, (model) => {
    const index = indexTree(model.tree);
    const found = index.resolve(ref);
    const entry = found && index.entries.find((e) => e.node === found);
    if (!entry) throw new CLIError(`Item "${ref}" not found.`, "Check the ID with 'rex status' and try again.");
    if (entry.root !== "changes") {
      throw new CLIError(
        `${nodeLabel(entry.node)} is on the product layer, which remove does not touch.`,
        "A product node retires through an applied change with a removed amendment.",
      );
    }
    const nodes = subtreeNodes(entry.node);
    for (const n of nodes) {
      const reason = pruneKeepReason(n as unknown as PRDItem);
      if (reason) throw new CLIError(`Cannot remove "${n.title}" (${n.id}): ${reason}.`);
    }
    const gone = new Set(nodes.map((n) => n.id));
    const tree: V2Tree = { product: model.tree.product, changes: withoutNodes(model.tree.changes, gone) };
    return { tree, result: { node: entry.node, ids: [...gone] }, removed: gone };
  });

  const store = await resolveStore(rexDir);
  const detail = `Removed ${removed.node.type}: ${removed.node.title} (${count(removed.ids.length)})`;
  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: `${removed.node.type}_removed`,
    itemId: removed.node.id,
    detail,
  });
  if (flags.format === "json") {
    result(JSON.stringify({
      removed: { id: removed.node.id, title: removed.node.title, type: removed.node.type },
      deletedIds: removed.ids,
      deletedCount: removed.ids.length,
    }, null, 2));
  } else {
    result(detail);
  }
}
