/**
 * `rex product show [<node>]` and `rex product edit <node>`: the product
 * layer of a v2 PRD.
 *
 * `show` prints the areas, capabilities and constraints with computed status
 * and health, or one capability or constraint in detail. `edit` changes a
 * node's statement or capability criteria directly, which is how a steward
 * says the requirement is now different: a met node is revised and gets a
 * drafted change in the Inbox, unless `--editorial` says only the wording
 * moved (`core/product-edit.ts`).
 */

import { capabilityReport, productReport, type ProductReportNode } from "../../core/product-report.js";
import { handleProductEdit, type ProductEditResult } from "../../core/product-edit.js";
import { indexTree, type RuleNode } from "../../schema/v2-rules.js";
import type { Criterion } from "../../schema/v2.js";
import { resolveRexPaths, resolveStore } from "../../store/index.js";
import { loadPrdModel } from "../../store/prd-model-reader.js";
import { withPrdModelTransaction } from "../../store/prd-model-transaction.js";
import { CLIError } from "../errors.js";
import { info, result } from "../output.js";
import { applyCriteriaDelta } from "../../core/apply-amendments.js";
import {
  CAPABILITY_CRITERION_FLAG,
  REMOVE_CAPABILITY_CRITERION_FLAG,
  capabilityCriteriaDelta,
  nodeLabel,
  parseCapabilityCriteria,
  parseRemovedCapabilityCriteria,
  requireV2,
} from "./v2-cli.js";

export const PRODUCT_SUBCOMMANDS = ["show", "edit"] as const;

export async function cmdProduct(
  dir: string,
  sub: string | undefined,
  ref: string | undefined,
  flags: Record<string, string>,
  multiFlags: Record<string, string[]> = {},
): Promise<void> {
  const rexDir = resolveRexPaths(dir).rexDir;
  if (sub === "show") {
    await requireV2(rexDir, "product show");
    return showProduct(rexDir, ref, flags);
  }
  if (sub === "edit") {
    await requireV2(rexDir, "product edit");
    if (!ref) throw new CLIError("Missing the capability or constraint to edit.", "Usage: rex product edit <node> [--statement=\"...\"] [--capability-criterion=\"<id>: <text>\"]");
    return editProduct(rexDir, ref, flags, multiFlags);
  }
  throw new CLIError(
    sub ? `Unknown product subcommand: ${sub}` : "Missing product subcommand.",
    `Usage: rex product <${PRODUCT_SUBCOMMANDS.join("|")}> … (see 'rex product --help')`,
  );
}

async function showProduct(rexDir: string, ref: string | undefined, flags: Record<string, string>): Promise<void> {
  const model = await loadPrdModel(rexDir);
  if (ref) {
    const report = capabilityReport(model.tree, ref);
    if (flags.format === "json") return result(JSON.stringify(report, null, 2));
    const node = report.node as RuleNode & { statement?: string; criteria?: Criterion[] };
    const lines = [
      `${nodeLabel(node)} ${node.title} (${node.type}) — ${report.status.status}, ${report.status.health}`,
      ...(report.parentChain.length ? [`  Under: ${report.parentChain.map((p) => `${nodeLabel(p)} ${p.title}`).join(" › ")}`] : []),
      ...(node.statement ? [`  Statement: ${node.statement}`] : []),
    ];
    if (node.type === "capability") {
      lines.push(node.criteria?.length ? "  Capability criteria:" : "  Capability criteria: none");
      for (const c of node.criteria ?? []) lines.push(`    ${c.id}: ${c.text}`);
    }
    if (report.boundBy.length) lines.push(`  Bound by: ${report.boundBy.map((b) => `${nodeLabel(b)} ${b.title}`).join(", ")}`);
    lines.push(report.changes.length ? "  Changes:" : "  Changes: none");
    for (const c of report.changes) {
      lines.push(`    ${nodeLabel(c)} ${c.title} (${c.relation}, ${c.applied ? "applied" : c.status})`);
    }
    return result(lines.join("\n"));
  }
  const areas = productReport(model.tree);
  if (flags.format === "json") return result(JSON.stringify({ title: model.title, areas }, null, 2));
  if (!areas.length) return result(`${model.title}: the product layer is empty.`);
  const lines = [model.title];
  const visit = (node: ProductReportNode, depth: number): void => {
    const state = node.status ? ` — ${node.status}${node.health === "defective" ? ", defective" : ""}` : "";
    lines.push(`${"  ".repeat(depth)}${nodeLabel(node)} ${node.title} (${node.type})${state}`);
    for (const child of node.children ?? []) visit(child, depth + 1);
  };
  for (const area of areas) visit(area, 1);
  result(lines.join("\n"));
}

async function editProduct(rexDir: string, ref: string, flags: Record<string, string>, multiFlags: Record<string, string[]>): Promise<void> {
  if (multiFlags.criterion?.length || flags.criterion !== undefined) {
    throw new CLIError(
      "--criterion sets a work item's acceptance criteria; a capability's criteria are capability criteria.",
      `Use --${CAPABILITY_CRITERION_FLAG}="<id>: <text>" (and --${REMOVE_CAPABILITY_CRITERION_FLAG}=<id>) on rex product edit.`,
    );
  }
  const set = parseCapabilityCriteria(multiFlags[CAPABILITY_CRITERION_FLAG]);
  const remove = parseRemovedCapabilityCriteria(multiFlags[REMOVE_CAPABILITY_CRITERION_FLAG]);
  const statement = flags.statement;
  if (statement === undefined && !set.length && !remove.length) {
    throw new CLIError(
      "Nothing to edit.",
      `Pass --statement="..." or --${CAPABILITY_CRITERION_FLAG}="<id>: <text>" / --${REMOVE_CAPABILITY_CRITERION_FLAG}=<id>.`,
    );
  }
  if (statement !== undefined && !statement.trim()) throw new CLIError("--statement is empty.");

  let now!: Date;
  const { result: out } = await withPrdModelTransaction(rexDir, (model) => {
    now = new Date();
    const tree = structuredClone(model.tree);
    const node = indexTree(tree).resolve(ref) as (RuleNode & { statement?: string; criteria?: Criterion[] }) | undefined;
    if (!node || (node.type !== "capability" && node.type !== "constraint")) {
      throw new CLIError(`"${ref}" is not a live capability or constraint.`, "See 'rex product show' for the product layer.");
    }
    if (node.type === "constraint" && (set.length || remove.length)) {
      throw new CLIError(`${nodeLabel(node)} is a constraint, which has a statement and no capability criteria.`);
    }
    const before = { statement: node.statement, criteria: node.criteria };
    if (statement !== undefined) node.statement = statement.trim();
    const delta = capabilityCriteriaDelta(node.criteria ?? [], set, remove);
    if (delta) {
      const { criteria, problems } = applyCriteriaDelta(node.criteria ?? [], delta);
      if (problems.length) throw new CLIError(`Cannot edit the capability criteria of ${nodeLabel(node)}: ${problems.join("; ")}.`);
      node.criteria = criteria;
    }
    const handled = handleProductEdit(tree, node.id, before, {
      editorial: flags.editorial === "true",
      summary: flags.summary,
      now,
    });
    return { tree: handled.tree, result: { handled, node: { id: node.id, displayId: node.displayId, title: node.title } } };
  });

  const { handled, node } = out;
  const store = await resolveStore(rexDir);
  await store.appendLog({ timestamp: now.toISOString(), event: "product_edited", itemId: node.id, detail: handled.outcome });
  report(handled, node, flags.format === "json");
}

function report(handled: ProductEditResult, node: { id: string; displayId?: string; title: string }, json: boolean): void {
  const drafts = handled.drafts.map((d) => ({ id: d.id, ...(d.displayId ? { displayId: d.displayId } : {}), title: d.title, status: d.status ?? "pending" }));
  const stale = handled.stale.map((d) => ({ id: d.id, title: d.title }));
  if (json) return result(JSON.stringify({ node: node.id, outcome: handled.outcome, drafts, stale }, null, 2));
  const label = `${nodeLabel(node)} ${node.title}`;
  const lines: string[] = [];
  switch (handled.outcome) {
    case "editorial":
      lines.push(`Edited ${label} (editorial): it stays met; a History line records the edit.`);
      break;
    case "revised":
      lines.push(`Edited ${label}: it now reads revised.`);
      for (const d of drafts) lines.push(`  Drafted change: ${nodeLabel(d)} ${d.title} (Inbox, needs placement)`);
      break;
    case "reverted":
      lines.push(`Edited ${label}: it is back at its met spec.`);
      for (const d of drafts) lines.push(`  Withdrew from change: ${nodeLabel(d)} ${d.title} (${d.status})`);
      break;
    case "proposed":
      lines.push(`Edited ${label}: it was never met, so no change is drafted.`);
      break;
    case "unchanged":
      lines.push(`${label} is unchanged.`);
      break;
  }
  result(lines.join("\n"));
  for (const s of stale) info(`  Completed, unapplied draft left for the steward: ${s.title} (${s.id})`);
}
