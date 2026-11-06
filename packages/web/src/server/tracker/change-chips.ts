/**
 * What a change's tracker chip says (Plan's Open changes rows and the change
 * detail): the work refs the change links to, and the tracker state sync last
 * put it in. Pure: the route reads the PRD and the activity log and passes them in.
 *
 * The state is the profile's status for the last event whose call made it
 * (`ok` or `duplicate`); null when sync has made no call for the change.
 */

import type { PRDItem } from "../rex-gateway.js";
import { walkTree } from "../rex-gateway.js";
import type { TrackerActivityEntry } from "./activity-log.js";
import { itemLinkRefs, type LinkFields } from "./link-refs.js";
import type { TrackerMapping } from "./server-profiles.js";

export interface TrackerChip {
  refs: string[];
  state: string | null;
}

/** The tracker status sync last set for `rexId`, or null. */
export function trackerStateOf(entries: readonly TrackerActivityEntry[], rexId: string, mapping: TrackerMapping): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.rexId === rexId && (entry.result === "ok" || entry.result === "duplicate")) return mapping.statusMap[entry.event] ?? null;
  }
  return null;
}

/**
 * A chip for each change that links to a work item, by change id, and for
 * each one sync created a work item for that is not linked yet (no refs, its
 * state set), so it is never offered "Create in tracker" twice. Other
 * changes have none.
 */
export function changeChips(items: PRDItem[], entries: readonly TrackerActivityEntry[], mapping: TrackerMapping): Record<string, TrackerChip> {
  const chips: Record<string, TrackerChip> = {};
  for (const { item } of walkTree(items)) {
    if (item.type !== "change") continue;
    const refs = itemLinkRefs(item as PRDItem & LinkFields);
    const state = trackerStateOf(entries, item.id, mapping);
    if (refs.length > 0 || state !== null) chips[item.id] = { refs, state };
  }
  return chips;
}
