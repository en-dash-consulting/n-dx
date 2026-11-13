/**
 * Dashboard units and their explicit-run eligibility. Rex owns change shape,
 * closure and the indexed Inbox hold (including the empty-product exception).
 * This is not autonomous selection: deferred tasks and explicit dependency
 * overrides still use the existing launch/status gates.
 */

import { awaitsPlacement, changeWorkShape, indexTree, isAppliedChange, isOpenChange } from "./rex-gateway.js";
import type { PRDItem, RuleNode, TreeIndex, V2Tree } from "./rex-gateway.js";
import { isWorkItemType, itemTypeOf } from "../shared/index.js";

/** Shape only, also used to describe historical runs of a task-less change. */
export function runsAsOneTask(item: PRDItem): boolean {
  return itemTypeOf(item) === "change" && changeWorkShape(item) === "unit";
}

interface UnitRefusal {
  message: string;
  /** Placement, reopening, or running the parent task is an actionable next step. */
  showInDetail?: true;
}

/** Build once per tree/read; parent lookups never rescan the tree per item. */
function indexedRefusal(index: TreeIndex): (id: string) => UnitRefusal | null {
  const parents = new Map(index.entries.map(({ node, parent }) => [node, parent]));
  return (id) => {
    const node = index.resolve(id);
    if (!node) return { message: `Item "${id}" is deleted or outside the live change layer and cannot run` };
    if (node.type === "subtask") {
      const message = `Subtask "${id}" runs through its parent task "${parents.get(node)?.id ?? "unknown"}"; start and save run settings on that task`;
      // An applied ancestor makes starting the parent task impossible too.
      for (let current = parents.get(node); current; current = parents.get(current)) {
        if (isAppliedChange(current)) return { message };
      }
      return { message, showInDetail: true };
    }
    if (node.type !== "task" && node.type !== "change") return { message: `Item "${id}" is not an independently runnable task or change` };
    for (let current: RuleNode | undefined = node; current; current = parents.get(current)) {
      if (current.type !== "change") continue;
      if (isAppliedChange(current)) return { message: `Change "${current.id}" is applied; it cannot accept more execution or run settings` };
      if (!isOpenChange(current) || current.status === "completed") {
        return { message: `Change "${current.id}" is closed (${current.status}); reopen the change before running or saving settings`, showInDetail: true };
      }
      if (awaitsPlacement(index, current)) {
        return { message: `Change "${current.id}" is in the Inbox and needs placement; place it before running or saving settings`, showInDetail: true };
      }
    }
    if (node.type === "change") {
      const shape = changeWorkShape(node);
      if (shape === "container") return { message: `Change "${id}" is a container; run its nested changes or tasks and save settings on those units` };
      if (shape === "tasks") return { message: `Change "${id}" does not run as one task; n-dx work runs its tasks, so save run settings on those tasks` };
    } else if (parents.get(node)?.type !== "change") {
      return { message: `Task "${id}" must belong to a change before it can run` };
    }
    return null;
  };
}

/** Full refusal for execution/settings guards, independent of detail visibility. */
export function indexedUnitRefusal(index: TreeIndex): (id: string) => string | null {
  const refusal = indexedRefusal(index);
  return (id) => refusal(id)?.message ?? null;
}

/** A served projection includes the product layer so awaitsPlacement can judge it. */
function refusalForItems(items: PRDItem[], product?: V2Tree["product"]): (item: PRDItem) => UnitRefusal | null {
  if (product !== undefined || items.some((item) => itemTypeOf(item) === "change")) {
    const refusal = indexedRefusal(indexTree({ product: product ?? [], changes: items as unknown as RuleNode[] }));
    return (item) => refusal(item.id);
  }
  return (item) => isWorkItemType(itemTypeOf(item)) ? null : { message: `Item "${item.id}" is not a task or subtask, so it cannot run or carry run settings` };
}

/** Full refusal for execution/settings guards, including ordinary containers. */
export function unitRefusal(items: PRDItem[], product?: V2Tree["product"]): (item: PRDItem) => string | null {
  const refusal = refusalForItems(items, product);
  return (item) => refusal(item)?.message ?? null;
}

/** Mark only a fresh served copy; none of these derived flags are persisted. */
export function markRunnableUnits(items: PRDItem[], product?: V2Tree["product"]): void {
  const refusalFor = refusalForItems(items, product);
  const visit = (nodes: PRDItem[]): void => {
    for (const item of nodes) {
      const refusal = refusalFor(item);
      const marked = item as PRDItem & { executionEligible?: boolean; executionRefusal?: string; runsAsOneTask?: boolean };
      marked.executionEligible = refusal === null;
      if (refusal?.showInDetail) marked.executionRefusal = refusal.message;
      else delete marked.executionRefusal;
      if (!refusal && runsAsOneTask(item)) marked.runsAsOneTask = true;
      else delete marked.runsAsOneTask;
      if (item.children?.length) visit(item.children);
    }
  };
  visit(items);
}
