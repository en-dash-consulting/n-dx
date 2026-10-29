/**
 * The change-set card (story 11): what a `propose_prd_change` call proposes,
 * read against the PRD before the card is raised, and the write an approval
 * makes.
 *
 * Before the card: {@link reviewChangeSet} resolves each item's type and
 * parent, flags an item that matches an existing one (rex's duplicate rule)
 * and, on v2, names where the change lands: on the capability or constraint
 * the proposal targets, or in the Inbox awaiting placement. A proposal it
 * cannot read is refused without a card.
 *
 * On approval: {@link writeChangeSet} writes the card's items, with the
 * operator's edits, in one transaction under the PRD lock, through the rules
 * the dashboard's own add and placement routes use (`routes-rex/items.ts`,
 * `routes-rex/placement.ts`). On v1 each item is added as `add_item` adds
 * it; on v2 the card writes one change with its tasks and places it when the
 * card names a target. A change is never applied from a card.
 *
 * Design: local-design-workshop/docs/analysis/sidecar/README.md §12 (story 11).
 */

import { randomUUID } from "node:crypto";
import {
  addChangeNode,
  findDuplicateItem,
  findItem,
  indexTree,
  insertChild,
  isPriority,
  loadPrdModel,
  prdLayout,
  recordPlacement,
  resolveStore,
  walkTree,
  withPrdModelTransaction,
  type PRDItem,
} from "../rex-gateway.js";
import { refreshPRDCache } from "../prd-io.js";
import { appendLog } from "../routes-rex/rex-route-helpers.js";
import type { ServerContext } from "../types.js";
import type { WebSocketBroadcaster } from "../websocket.js";
import {
  childTypeOf,
  isItemType,
  isValidParentType,
  itemTypeOf,
  levelOf,
  parentTypesOf,
  type SidecarChangeSet,
  type SidecarChangeSetEdit,
  type SidecarChangeSetItem,
} from "../../shared/index.js";

/** The most items one card proposes. */
export const CHANGE_SET_MAX_ITEMS = 50;

/** Said on a card, and in its tool result, when a v2 change has no target. */
export const INBOX_NOTE = "It lands in the Inbox awaiting placement; placing it from Sidecar comes with the Place lens (batch L2).";

type Raw = Record<string, unknown>;

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

/** One proposed item's own fields, or why they cannot be read. */
function readItem(raw: unknown, n: number): (Omit<SidecarChangeSetItem, "type" | "duplicate"> & { type?: string }) | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return `item ${n} is not an object`;
  const r = raw as Raw;
  if (typeof r.title !== "string" || !r.title.trim()) return `item ${n} has no title`;
  for (const key of ["type", "description", "priority", "parentId"] as const) {
    if (r[key] !== undefined && typeof r[key] !== "string") return `item ${n}: ${key} must be a string`;
  }
  if (r.acceptanceCriteria !== undefined && !isStrings(r.acceptanceCriteria)) return `item ${n}: acceptanceCriteria must be a list of strings`;
  if (r.parent !== undefined && !(Number.isInteger(r.parent) && (r.parent as number) >= 0 && (r.parent as number) < n - 1)) {
    return `item ${n}: parent must be the index of an earlier item`;
  }
  if (r.parent !== undefined && r.parentId !== undefined) return `item ${n} names both parent and parentId`;
  if (typeof r.priority === "string" && !isPriority(r.priority)) return `item ${n}: unknown priority "${String(r.priority)}"`;
  const description = typeof r.description === "string" && r.description.trim() ? r.description : undefined;
  const criteria = isStrings(r.acceptanceCriteria) ? r.acceptanceCriteria.filter((c) => c.trim()) : [];
  return {
    title: r.title.trim(),
    ...(typeof r.type === "string" && { type: r.type }),
    ...(description && { description }),
    ...(criteria.length > 0 && { acceptanceCriteria: criteria }),
    ...(typeof r.priority === "string" && { priority: r.priority }),
    ...(typeof r.parentId === "string" && { parentId: r.parentId }),
    ...(r.parent !== undefined && { parent: r.parent as number }),
  };
}

/**
 * Read a `propose_prd_change` call against the PRD: the change set its card
 * shows and approval writes, or why the proposal cannot be written.
 */
export async function reviewChangeSet(rexDir: string, input: Raw): Promise<SidecarChangeSet | string> {
  const rawItems = input.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) return "items must be a non-empty list";
  if (rawItems.length > CHANGE_SET_MAX_ITEMS) return `a card proposes at most ${CHANGE_SET_MAX_ITEMS} items`;
  if (input.target !== undefined && (typeof input.target !== "string" || !input.target.trim())) return "target must be a capability or constraint id";
  const read = rawItems.map((raw, i) => readItem(raw, i + 1));
  const bad = read.find((r): r is string => typeof r === "string");
  if (bad) return bad;
  const proposed = read as Array<Exclude<(typeof read)[number], string>>;

  const layout = await prdLayout(rexDir);
  const doc = await (await resolveStore(rexDir)).loadDocument();
  const resolved = layout === "v2"
    ? await resolveV2(rexDir, proposed, input.target as string | undefined)
    : resolveV1(doc.items, proposed, input.target);
  if (typeof resolved === "string") return resolved;

  // Each item is compared with the existing items of its own type, as smart add compares levels.
  const existing = [...walkTree(doc.items)].map((entry) => entry.item);
  // The scan is synchronous and costs ~190 ms per item on a large PRD, so the
  // loop yields between items: other requests, the websocket and Live are
  // served while it runs. The matcher is unchanged.
  const flagged: SidecarChangeSetItem[] = [];
  for (const item of resolved.items) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    const match = findDuplicateItem(item, existing.filter((e) => itemTypeOf(e) === item.type));
    flagged.push(match
      ? { ...item, duplicate: { id: match.item.id, title: match.item.title, type: itemTypeOf(match.item), status: match.item.status } }
      : item);
  }
  resolved.items = flagged;
  return resolved;
}

type Proposed = Omit<SidecarChangeSetItem, "type" | "duplicate"> & { type?: string };

function resolveV1(items: PRDItem[], proposed: Proposed[], target: unknown): SidecarChangeSet | string {
  if (target !== undefined) return "this PRD uses the v1 layout, which has no capability or constraint to target; omit target";
  const out: SidecarChangeSetItem[] = [];
  for (const [i, item] of proposed.entries()) {
    const n = i + 1;
    let parentType: string | undefined;
    if (item.parentId !== undefined) {
      const entry = findItem(items, item.parentId);
      if (!entry) return `item ${n}: parent "${item.parentId}" not found`;
      parentType = itemTypeOf(entry.item);
    } else if (item.parent !== undefined) {
      parentType = out[item.parent].type;
    }
    // As the add route: the type asked for, else the parent's child type, else the root type.
    const type = item.type ?? (parentType ? childTypeOf(parentType) : "epic");
    if (!type || !isItemType(type)) return `item ${n}: ${type ? `unknown type "${type}"` : `a ${parentType} takes no child`}`;
    if (!isValidParentType(type, parentType ?? null)) {
      const allowed = parentTypesOf(type);
      const goes = allowed.length > 0 ? `goes under a ${allowed.join(" or ")}` : "goes at the root";
      return `item ${n}: a ${type} ${goes}, not ${parentType ? `under a ${parentType}` : "at the root"}`;
    }
    if (!levelOf(type, parentType)) return `item ${n}: a ${type} cannot be added to a v1 PRD`;
    out.push({ ...item, type });
  }
  return { layout: "v1", items: out };
}

async function resolveV2(rexDir: string, proposed: Proposed[], target: string | undefined): Promise<SidecarChangeSet | string> {
  const [change, ...tasks] = proposed;
  if (change.type !== undefined && change.type !== "change") {
    return `on a v2 PRD a card proposes one change with its tasks: item 1 is the change, not a ${change.type}`;
  }
  if (change.parentId !== undefined || change.parent !== undefined) return "item 1 is the change, which takes no parent";
  const items: SidecarChangeSetItem[] = [{ ...change, type: "change" }];
  for (const [i, task] of tasks.entries()) {
    const n = i + 2;
    if (task.type !== undefined && task.type !== "task") return `item ${n}: every item after the change is one of its tasks, not a ${task.type}`;
    if (task.parentId !== undefined || (task.parent !== undefined && task.parent !== 0)) return `item ${n}: a task goes under the card's change`;
    items.push({ ...task, type: "task", parent: 0 });
  }
  if (target === undefined) return { layout: "v2", items, placement: { inbox: true } };
  const { tree } = await loadPrdModel(rexDir);
  const node = indexTree(tree).resolve(target.trim());
  if (!node || (node.type !== "capability" && node.type !== "constraint")) {
    return `"${target}" is not a live capability or constraint; omit target to leave the change in the Inbox`;
  }
  return { layout: "v2", items, placement: { target: node.id, title: node.title } };
}

/** The change set with the operator's edits applied, or why an edit is refused. */
export function applyChangeSetEdits(changeSet: SidecarChangeSet, edits: unknown): SidecarChangeSet | string {
  if (!Array.isArray(edits)) return "edits must be a list";
  const items = changeSet.items.map((item) => ({ ...item }));
  for (const edit of edits as Array<Partial<SidecarChangeSetEdit>>) {
    if (!edit || typeof edit !== "object" || !Number.isInteger(edit.index) || edit.index! < 0 || edit.index! >= items.length) {
      return "each edit names the index of an item on the card";
    }
    const item = items[edit.index!];
    if (edit.title !== undefined) {
      if (typeof edit.title !== "string" || !edit.title.trim()) return `item ${edit.index! + 1}: title must be a non-empty string`;
      item.title = edit.title.trim();
    }
    if (edit.description !== undefined) {
      if (typeof edit.description !== "string") return `item ${edit.index! + 1}: description must be a string`;
      if (edit.description.trim()) item.description = edit.description;
      else delete item.description;
    }
    if (edit.acceptanceCriteria !== undefined) {
      if (!isStrings(edit.acceptanceCriteria)) return `item ${edit.index! + 1}: acceptanceCriteria must be a list of strings`;
      const criteria = edit.acceptanceCriteria.filter((c) => c.trim());
      if (criteria.length > 0) item.acceptanceCriteria = criteria;
      else delete item.acceptanceCriteria;
    }
  }
  return { ...changeSet, items };
}

/** What a change-set write wrote. */
export interface ChangeSetWritten {
  /** The new items' ids, in the card's order. */
  ids: string[];
  text: string;
}

/**
 * Write the change set in one transaction under the PRD lock. Throws, having
 * written nothing, when the PRD refuses it (a parent gone, a layout changed,
 * a target no longer live, the lock held).
 */
export async function writeChangeSet(
  ctx: ServerContext,
  changeSet: SidecarChangeSet,
  broadcast?: WebSocketBroadcaster,
): Promise<ChangeSetWritten> {
  const layout = await prdLayout(ctx.rexDir);
  if (layout !== changeSet.layout) {
    throw new Error(`the PRD now uses the ${layout} layout, not the ${changeSet.layout} layout the card was read against`);
  }
  const written = layout === "v2" ? await writeV2(ctx, changeSet) : await writeV1(ctx, changeSet);
  refreshPRDCache(ctx.rexDir, await (await resolveStore(ctx.rexDir)).loadDocument());
  const timestamp = new Date().toISOString();
  changeSet.items.forEach((item, i) => {
    appendLog(ctx, { timestamp, event: "item_added", itemId: written.ids[i], detail: `Added ${item.type}: ${item.title} (via Sidecar)` });
  });
  if (changeSet.placement && "target" in changeSet.placement) {
    appendLog(ctx, { timestamp, event: "change_placed", itemId: written.ids[0], detail: `touches ${changeSet.placement.target} (via Sidecar)` });
  }
  broadcast?.({ type: "rex:prd-changed", timestamp });
  return written;
}

function listed(changeSet: SidecarChangeSet, ids: string[]): string {
  return changeSet.items.map((item, i) => `- ${item.type} ${ids[i]}: ${item.title}`).join("\n");
}

async function writeV1(ctx: ServerContext, changeSet: SidecarChangeSet): Promise<ChangeSetWritten> {
  const ids = changeSet.items.map(() => randomUUID());
  const store = await resolveStore(ctx.rexDir);
  await store.withTransaction(async (doc) => {
    changeSet.items.forEach((item, i) => {
      const parentId = item.parentId ?? (item.parent !== undefined ? ids[item.parent] : undefined);
      const parent = parentId ? findItem(doc.items, parentId)?.item : undefined;
      if (parentId && !parent) throw new Error(`parent "${parentId}" of "${item.title}" is no longer in the PRD`);
      const level = levelOf(item.type, parent ? itemTypeOf(parent) : undefined);
      if (!level) throw new Error(`a ${item.type} cannot be added to a v1 PRD`);
      const node: PRDItem = { id: ids[i], title: item.title, status: "pending", level };
      if (item.description) node.description = item.description;
      if (item.priority && isPriority(item.priority)) node.priority = item.priority;
      if (item.acceptanceCriteria) node.acceptanceCriteria = item.acceptanceCriteria;
      if (!parentId) doc.items.push(node);
      else if (!insertChild(doc.items, parentId, node)) throw new Error(`a ${item.type} cannot go under "${parentId}"`);
    });
  });
  return { ids, text: `Wrote ${ids.length} ${ids.length === 1 ? "item" : "items"}:\n${listed(changeSet, ids)}` };
}

async function writeV2(ctx: ServerContext, changeSet: SidecarChangeSet): Promise<ChangeSetWritten> {
  const [change, ...tasks] = changeSet.items;
  const { placement } = changeSet;
  const now = new Date();
  const { result } = await withPrdModelTransaction(ctx.rexDir, (model) => {
    const fields = (item: SidecarChangeSetItem) => ({
      title: item.title,
      description: item.description,
      acceptanceCriteria: item.acceptanceCriteria,
      priority: item.priority && isPriority(item.priority) ? item.priority : undefined,
    });
    const added = addChangeNode(model.tree, { type: "change", ...fields(change) }, { now });
    let tree = added.tree;
    const ids = [added.node.id];
    const warnings = [...added.warnings];
    for (const task of tasks) {
      const next = addChangeNode(tree, { type: "task", parentId: added.node.id, ...fields(task) }, { now });
      tree = next.tree;
      ids.push(next.node.id);
      warnings.push(...next.warnings);
    }
    if (placement && "target" in placement) {
      // Touches, as the add route's `touches`: an amendment needs a delta, which a card does not carry.
      const placed = recordPlacement(tree, added.node.id, { target: placement.target, relation: "touches" }, now);
      tree = placed.tree;
      warnings.push(...placed.warnings);
    }
    return { tree, result: { ids, warnings } };
  });
  const where = placement && "target" in placement
    ? `It touches ${placement.title} (${placement.target}).`
    : INBOX_NOTE;
  const warned = result.warnings.length > 0 ? `\nWarnings:\n${result.warnings.map((w) => `- ${w}`).join("\n")}` : "";
  return { ids: result.ids, text: `Wrote one change with ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}:\n${listed(changeSet, result.ids)}\n${where}${warned}` };
}
