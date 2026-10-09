/**
 * `rex change place <change>` and `rex change apply <change>`: the change
 * layer of a v2 PRD.
 *
 * `place` without `--target` prints the placement rules' shortlist; with it,
 * records the placement (`core/change-place.ts`). An amendment's capability
 * criteria are edited with `--capability-criterion`, never `--criterion`,
 * which is a work item's acceptance criteria. `apply` applies the change's
 * amendments to the product layer as a steward (`core/apply-amendments.ts`).
 */

import { applyAmendments, ApplyAmendmentsError, NOTHING_TO_MODIFY } from "../../core/apply-amendments.js";
import { recordPlacement, suggestPlacement } from "../../core/change-place.js";
import { indexTree, type RuleNode } from "../../schema/v2-rules.js";
import type { Criterion } from "../../schema/v2.js";
import { resolveRexPaths, resolveStore } from "../../store/index.js";
import { loadPrdModel } from "../../store/prd-model-reader.js";
import { withPrdModelTransaction } from "../../store/prd-model-transaction.js";
import { CLIError } from "../errors.js";
import { result } from "../output.js";
import {
  CAPABILITY_CRITERION_FLAG,
  REMOVE_CAPABILITY_CRITERION_FLAG,
  capabilityCriteriaDelta,
  formatPlacementSuggestion,
  nodeLabel,
  parseCapabilityCriteria,
  parseRemovedCapabilityCriteria,
  requireV2,
} from "./v2-cli.js";

export const CHANGE_SUBCOMMANDS = ["place", "apply"] as const;

const RELATIONS = new Set(["touches", "amends"]);

export async function cmdChange(
  dir: string,
  sub: string | undefined,
  ref: string | undefined,
  flags: Record<string, string>,
  multiFlags: Record<string, string[]> = {},
): Promise<void> {
  if (sub !== "place" && sub !== "apply") {
    throw new CLIError(
      sub ? `Unknown change subcommand: ${sub}` : "Missing change subcommand.",
      `Usage: rex change <${CHANGE_SUBCOMMANDS.join("|")}> <change> … (see 'rex change --help')`,
    );
  }
  const rexDir = resolveRexPaths(dir).rexDir;
  await requireV2(rexDir, `change ${sub}`);
  if (!ref) throw new CLIError("Missing the change id.", `Usage: rex change ${sub} <change> [options] [dir]`);
  return sub === "place" ? placeChange(rexDir, ref, flags, multiFlags) : applyChange(rexDir, ref, flags);
}

async function placeChange(rexDir: string, ref: string, flags: Record<string, string>, multiFlags: Record<string, string[]>): Promise<void> {
  if (multiFlags.criterion?.length || flags.criterion !== undefined) {
    throw new CLIError(
      "--criterion sets a work item's acceptance criteria, which placement does not edit.",
      `An amendment edits its target's capability criteria with --${CAPABILITY_CRITERION_FLAG}="<id>: <text>" and --${REMOVE_CAPABILITY_CRITERION_FLAG}=<id>.`,
    );
  }
  const relation = flags.relation;
  if (relation !== undefined && !RELATIONS.has(relation)) throw new CLIError(`Invalid --relation "${relation}".`, "Use touches or amends.");
  const set = parseCapabilityCriteria(multiFlags[CAPABILITY_CRITERION_FLAG]);
  const remove = parseRemovedCapabilityCriteria(multiFlags[REMOVE_CAPABILITY_CRITERION_FLAG]);
  const content = flags.proposed !== undefined || set.length > 0 || remove.length > 0;
  const target = flags.target;

  if (target === undefined) {
    if (relation !== undefined || flags.summary !== undefined || content) {
      throw new CLIError("--relation, --summary, --proposed and capability criteria record a placement: pass --target with them.", "Leave them all out to see the shortlist.");
    }
    const { tree } = await loadPrdModel(rexDir);
    const suggestion = suggestPlacement(tree, ref);
    if (flags.format === "json") return result(JSON.stringify(suggestion, null, 2));
    const index = indexTree(tree);
    const change = index.resolve(suggestion.change)!;
    return result([`${nodeLabel(change)} ${change.title}`, ...formatPlacementSuggestion(suggestion, nodeLabel(change), index.resolve)].join("\n"));
  }
  if (content && relation !== "amends") {
    throw new CLIError("--proposed and capability criteria describe an amendment: pass --relation=amends with them.");
  }

  let now!: Date;
  const { result: placed } = await withPrdModelTransaction(rexDir, (model) => {
    now = new Date();
    const node = indexTree(model.tree).resolve(target) as (RuleNode & { criteria?: Criterion[] }) | undefined;
    const criteria = capabilityCriteriaDelta(node?.criteria ?? [], set, remove);
    const out = recordPlacement(
      model.tree,
      ref,
      {
        target,
        ...(relation ? { relation: relation as "touches" | "amends" } : {}),
        ...(flags.summary !== undefined ? { summary: flags.summary } : {}),
        ...(flags.proposed !== undefined ? { proposed: flags.proposed } : {}),
        ...(criteria ? { criteria } : {}),
      },
      now,
    );
    const index = indexTree(out.tree);
    return { tree: out.tree, result: { ...out, changeNode: index.resolve(out.change)!, targetNode: index.resolve(out.placement.target)! } };
  });

  const store = await resolveStore(rexDir);
  await store.appendLog({
    timestamp: now.toISOString(),
    event: "change_placed",
    itemId: placed.change,
    detail: `${placed.placement.relation} ${placed.placement.target}`,
  });
  if (flags.format === "json") return result(JSON.stringify({ change: placed.change, ...placed.placement }, null, 2));
  result(`Placed ${nodeLabel(placed.changeNode)} ${placed.changeNode.title}: ${placed.placement.relation} ${describe(placed.targetNode)}`);
}

async function applyChange(rexDir: string, ref: string, flags: Record<string, string>): Promise<void> {
  let appliedAt!: string;
  const { result: out } = await withPrdModelTransaction(rexDir, (model) => {
    const now = new Date();
    appliedAt = now.toISOString();
    const applied = applyOrExplain(() => applyAmendments(model.tree, ref, { appliedAt, now, force: flags.force === "true" }));
    // Logged by id: ref may be a display id, which can later name another change.
    const change = indexTree(applied.tree).resolve(ref)!;
    return { tree: applied.tree, result: { change, applied: applied.applied, tree: applied.tree } };
  });
  const { change, applied } = out;
  const store = await resolveStore(rexDir);
  await store.appendLog({
    timestamp: appliedAt,
    event: "change_applied",
    itemId: change.id,
    detail: applied.length ? applied.map((a) => `${a.delta} ${a.nodeId}`).join(", ") : "no amendments",
  });
  if (flags.format === "json") return result(JSON.stringify({ change: change.id, appliedAt, applied }, null, 2));
  const index = indexTree(out.tree, { includeTombstones: true });
  result([
    `Applied ${nodeLabel(change)} ${change.title}.`,
    ...(applied.length ? applied.map((a) => `  ${a.delta} ${describe(index.resolve(a.nodeId))}`) : ["  It carried no amendments."]),
  ].join("\n"));
}

/** Run apply, naming the placement flags that supply a modified amendment's content when it has none. */
function applyOrExplain<T>(apply: () => T): T {
  try {
    return apply();
  } catch (err) {
    if (err instanceof ApplyAmendmentsError && err.problems.some((p) => p.endsWith(NOTHING_TO_MODIFY))) {
      throw new CLIError(
        err.message,
        `A modified amendment's content comes from rex change place --relation=amends with --proposed="..." or --${CAPABILITY_CRITERION_FLAG}="<id>: <text>".`,
      );
    }
    throw err;
  }
}

function describe(node: RuleNode | undefined): string {
  return node ? `${nodeLabel(node)} ${node.title}` : "(unknown node)";
}
