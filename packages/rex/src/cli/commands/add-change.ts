/**
 * `rex add` on a v2 PRD (product/ and changes/): every add creates a node on
 * the change layer, never a level-based item. A v1 tree never reaches here.
 *
 * - **Manual** (`--title`): a change (default), or a task or subtask under
 *   `--parent`, through `core/change-add.ts`. `--criterion` is the item's
 *   acceptance criteria, as on v1.
 * - **Descriptions** (positional, `--description`, `--file`, stdin): each one
 *   becomes a change. No LLM decomposition: a change is one intent, and its
 *   tasks are written when it is picked up.
 *
 * A new change lands in the Inbox with `needsPlacement`; the output names it
 * and the placement rules' shortlist, and `rex change place` records one.
 */

import { readFile } from "node:fs/promises";
import { addChangeNode, type AddChangeNodeInput } from "../../core/change-add.js";
import { suggestPlacement, type PlacementSuggestion } from "../../core/change-place.js";
import type { Priority } from "../../schema/index.js";
import type { ChangeNodeType } from "../../schema/v2.js";
import { indexTree, type RuleNode, type V2Tree } from "../../schema/v2-rules.js";
import { resolveRexPaths, resolveStore } from "../../store/index.js";
import { loadPrdModel } from "../../store/prd-model-reader.js";
import { withPrdModelTransaction } from "../../store/prd-model-transaction.js";
import { CLIError } from "../errors.js";
import { info, result } from "../output.js";
import { parseCsvList } from "../parse-utils.js";
import { CAPABILITY_CRITERION_FLAG, REMOVE_CAPABILITY_CRITERION_FLAG, formatPlacementSuggestion, nodeLabel } from "./v2-cli.js";

export const CHANGE_NODE_TYPES: readonly ChangeNodeType[] = ["change", "task", "subtask"];

/** The positional or `--type` that `rex add` on a v2 tree takes. */
export function isChangeNodeType(value: string | undefined): value is ChangeNodeType {
  return CHANGE_NODE_TYPES.includes(value as ChangeNodeType);
}

interface Added {
  node: RuleNode;
  /** Rules' shortlist for a new change still in the Inbox. */
  suggestion?: PlacementSuggestion;
  /** Shortlisted targets by id. */
  targets?: Record<string, Pick<RuleNode, "id" | "displayId" | "title">>;
}

/** `rex add [change|task|subtask] --title="..."` on a v2 tree. */
export async function cmdAddChange(
  dir: string,
  typeArg: string | undefined,
  flags: Record<string, string>,
  multiFlags: Record<string, string[]> = {},
): Promise<void> {
  refuseCapabilityCriteria(multiFlags);
  if (flags.level !== undefined || (typeArg !== undefined && !isChangeNodeType(typeArg))) {
    throw new CLIError(
      `This PRD uses the v2 layout, where items have a type, not a level ("${flags.level ?? typeArg}").`,
      `Pass ${CHANGE_NODE_TYPES.join(", ")} (default change): rex add [change|task|subtask] --title="...".`,
    );
  }
  if (flags.status !== undefined) throw new CLIError("--status is not set on add in a v2 PRD: a new change, task or subtask starts pending.");
  const type = typeArg ?? (flags.type as ChangeNodeType | undefined) ?? "change";
  if (!isChangeNodeType(type)) throw new CLIError(`Invalid --type "${type}".`, `Use ${CHANGE_NODE_TYPES.join(", ")}.`);
  const title = flags.title?.trim();
  if (!title) throw new CLIError("Missing required flag: --title", 'Usage: rex add [change|task|subtask] --title="..."');

  const criteria = (multiFlags.criterion ?? []).map((c) => c.trim()).filter(Boolean);
  const input: AddChangeNodeInput = {
    type,
    title,
    ...(flags.parent ? { parentId: flags.parent } : {}),
    ...(flags.description ? { description: flags.description } : {}),
    ...(criteria.length ? { acceptanceCriteria: criteria } : {}),
    ...(flags.source ? { source: flags.source } : {}),
    ...(flags.priority ? { priority: flags.priority as Priority } : {}),
    ...(flags.blockedBy ? { blockedBy: parseCsvList(flags.blockedBy) } : {}),
  };
  const [added] = await addChanges(dir, [input]);
  report([added], flags.format === "json");
}

/** `rex add "<description>" …` on a v2 tree: one change per description or file. */
export async function cmdAddChangesFromDescriptions(
  dir: string,
  descriptions: string[],
  flags: Record<string, string>,
  multiFlags: Record<string, string[]> = {},
): Promise<void> {
  refuseCapabilityCriteria(multiFlags);
  const files = multiFlags.file ?? (flags.file ? [flags.file] : []);
  const texts = [...descriptions, ...(await Promise.all(files.map((f) => readFile(f, "utf-8"))))]
    .map((t) => t.trim())
    .filter(Boolean);
  if (!texts.length) throw new CLIError("Missing description or --file flag.", 'Usage: rex add "<description>" or rex add --file=<path>');
  const inputs = texts.map((text): AddChangeNodeInput => {
    const title = titleFrom(text);
    return {
      type: "change",
      title,
      ...(text !== title ? { description: text } : {}),
      ...(flags.parent ? { parentId: flags.parent } : {}),
      ...(flags.priority ? { priority: flags.priority as Priority } : {}),
    };
  });
  // `--format=json` without `--accept` is smart-add's preview contract (the
  // dashboard's Quick Add relies on it): report what would be created, write nothing.
  if (flags.format === "json" && flags.accept !== "true") {
    const { tree } = await loadPrdModel(resolveRexPaths(dir).rexDir);
    const rows = jsonRows(planChanges(tree, inputs, new Date()).added);
    // `proposals` and `qualityIssues` keep smart-add's preview keys, so a v1-shaped reader sees an empty preview, not a parse error.
    return result(JSON.stringify({ preview: true, changes: rows, proposals: [], qualityIssues: [] }, null, 2));
  }
  report(await addChanges(dir, inputs), flags.format === "json");
}

/** `inputs` added to `tree` in memory, with the placement shortlist for each new change still in the Inbox. */
function planChanges(start: V2Tree, inputs: AddChangeNodeInput[], now: Date): { tree: V2Tree; added: Added[] } {
  let tree = start;
  const ids: string[] = [];
  for (const input of inputs) {
    const out = addChangeNode(tree, input, { now });
    tree = out.tree;
    ids.push(out.node.id);
  }
  const index = indexTree(tree);
  const added = ids.map((id): Added => {
    const node = index.resolve(id)!;
    if (node.type !== "change" || !node.needsPlacement) return { node };
    const suggestion = suggestPlacement(tree, id);
    const targets = suggestion.shortlist.map((c) => index.resolve(c.target)!);
    return { node, suggestion, targets: Object.fromEntries(targets.map((t) => [t.id, { id: t.id, displayId: t.displayId, title: t.title }])) };
  });
  return { tree, added };
}

/** Add every input in one transaction, logging each, and rank placement for each new change. */
async function addChanges(dir: string, inputs: AddChangeNodeInput[]): Promise<Added[]> {
  const rexDir = resolveRexPaths(dir).rexDir;
  let now!: Date;
  const { result: added } = await withPrdModelTransaction(rexDir, (model) => {
    now = new Date();
    const planned = planChanges(model.tree, inputs, now);
    return { tree: planned.tree, result: planned.added };
  });
  const store = await resolveStore(rexDir);
  for (const { node } of added) {
    await store.appendLog({ timestamp: now.toISOString(), event: "item_added", itemId: node.id, detail: `Added ${node.type}: ${node.title}` });
  }
  return added;
}

function jsonRows(added: Added[]) {
  return added.map(({ node, suggestion }) => ({
    id: node.id,
    type: node.type,
    title: node.title,
    ...(node.needsPlacement ? { needsPlacement: true } : {}),
    ...(suggestion ? { placement: { relation: suggestion.relation, shortlist: suggestion.shortlist } } : {}),
  }));
}

function report(added: Added[], json: boolean): void {
  if (json) {
    const rows = jsonRows(added);
    return result(JSON.stringify(rows.length === 1 ? rows[0] : rows, null, 2));
  }
  for (const { node, suggestion, targets } of added) {
    result(`Created ${node.type}: ${node.title}`);
    result(`  ID: ${nodeLabel(node)}`);
    if (suggestion) {
      for (const line of formatPlacementSuggestion(suggestion, nodeLabel(node), (id) => targets?.[id])) result(line);
    }
  }
  if (added.some((a) => a.suggestion)) info("  See 'rex product show' for the capabilities and constraints a change can be placed on.");
}

function refuseCapabilityCriteria(multiFlags: Record<string, string[]>): void {
  if (multiFlags[CAPABILITY_CRITERION_FLAG]?.length || multiFlags[REMOVE_CAPABILITY_CRITERION_FLAG]?.length) {
    throw new CLIError(
      `--${CAPABILITY_CRITERION_FLAG} edits a capability's capability criteria, which rex add does not.`,
      "Use --criterion for this item's acceptance criteria; amend a capability with rex change place --relation=amends or rex product edit.",
    );
  }
}

const MAX_TITLE = 80;

/** A change title from a description: its first line, without Markdown heading or list marks, cut at a word near 80 characters. */
export function titleFrom(text: string): string {
  const first = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  const line = first.replace(/^(#+|[-*]|\d+[.)])\s+/, "").trim();
  if (line.length <= MAX_TITLE) return line;
  const cut = line.slice(0, MAX_TITLE);
  const space = cut.lastIndexOf(" ");
  return `${(space > MAX_TITLE / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
