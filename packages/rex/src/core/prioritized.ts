/**
 * The prioritized flag: a large piece of work marked to lead the Inbox and the
 * Open changes list, ahead of every unflagged item whatever its priority level.
 *
 * Only a change carries it on a v2 tree (projected as an epic or feature), and
 * only an epic on a v1 tree. It is written as `true` and cleared by removing
 * the key, so an unflagged item never stores `false`. It orders lists; task
 * selection (`get_next_task`) does not read it.
 *
 * @module rex/core/prioritized
 */

import type { PRDItem } from "../schema/index.js";
import { changeLayerType } from "./layer-projection.js";

/** Whether `item` can carry the flag: a v2 change, or a v1 epic. */
export function canBePrioritized(item: PRDItem): boolean {
  const type = changeLayerType(item);
  return type ? type === "change" : item.level === "epic";
}

/** Why `item` cannot carry the flag, or null when it can. */
export function prioritizedRefusal(item: PRDItem): string | null {
  if (canBePrioritized(item)) return null;
  const kind = changeLayerType(item) ?? item.level;
  return `Only a change (an epic on a v1 PRD) can be prioritized; "${item.title}" is a ${kind}.`;
}

/** The stored value for a requested flag: `true`, or `undefined` to remove the key. */
export function storedPrioritized(on: boolean): true | undefined {
  return on ? true : undefined;
}
