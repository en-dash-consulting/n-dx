/**
 * Which PRD items `ndx work` runs as a unit.
 *
 * A task or subtask always; a v2 change only when rex's selection reads its
 * work shape as `unit` (no live tasks and no nested change). A change with
 * tasks is worked through them, and one holding a change is a container. The
 * viewer cannot ask rex, so the server marks a unit change `runsAsOneTask` on
 * the PRD it serves. A v1 tree has no `change` items and is left as it is.
 */

import { changeWorkShape } from "./rex-gateway.js";
import type { PRDItem } from "./rex-gateway.js";
import { isWorkItemType, itemTypeOf } from "../shared/index.js";

/** Whether `item` is a change `ndx work` runs as one task. */
export function runsAsOneTask(item: PRDItem): boolean {
  return itemTypeOf(item) === "change" && changeWorkShape(item) === "unit";
}

/** Whether `ndx work` can run `item`: a task, a subtask or a change that runs as one task. */
export function isRunnableUnit(item: PRDItem): boolean {
  return isWorkItemType(itemTypeOf(item)) || runsAsOneTask(item);
}

/**
 * Mark each change that runs as one task with `runsAsOneTask: true`, in place.
 * `items` must be a fresh parse the caller owns (the served copy), never the
 * store's document: the flag is derived and is not written back.
 */
export function markRunnableUnits(items: PRDItem[]): void {
  for (const item of items) {
    if (runsAsOneTask(item)) (item as PRDItem & { runsAsOneTask?: boolean }).runsAsOneTask = true;
    if (item.children?.length) markRunnableUnits(item.children);
  }
}
