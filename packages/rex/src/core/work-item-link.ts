/**
 * PRD-to-work-item linkage model operations.
 *
 * The linkage model (`WorkItemLink`, see `schema/v1.ts`) is the common,
 * system-agnostic surface every work-tracking integration (Notion, Jira,
 * GitHub Projects, Asana, …) uses to record the relationship between a PRD
 * item and its downstream work item. A PRD item may carry several links, one
 * per remote system; each link's identity is the (`system`, `workItemId`) pair.
 *
 * All operations here are pure: they return a new `PRDItem` and never mutate
 * the input, mirroring the immutable helpers in `core/sync.ts`. Links persist
 * automatically through the folder-tree serializer (object-array frontmatter),
 * so no adapter-specific storage code is required.
 */

import type { PRDItem, WorkItemLink } from "../schema/index.js";

/** Fields patchable on an existing link to reflect the latest known remote state. */
export type WorkItemLinkSyncPatch = Pick<
  WorkItemLink,
  "syncState" | "remoteStatus" | "lastSyncedAt" | "url" | "title" | "error"
>;

/** True when `link` has the given (system, workItemId) identity. */
function hasIdentity(link: WorkItemLink, system: string, workItemId: string): boolean {
  return link.system === system && link.workItemId === workItemId;
}

/** Return the item's links, or an empty array when it has none. */
export function getLinks(item: PRDItem): WorkItemLink[] {
  return item.links ?? [];
}

/** Find a link by its (system, workItemId) identity, or `undefined`. */
export function findLink(
  item: PRDItem,
  system: string,
  workItemId: string,
): WorkItemLink | undefined {
  return getLinks(item).find((l) => hasIdentity(l, system, workItemId));
}

/**
 * Add `link`, or replace an existing link with the same identity in place.
 * Preserves the order of other links. Returns a new item (input untouched).
 */
export function upsertLink(item: PRDItem, link: WorkItemLink): PRDItem {
  const links = getLinks(item);
  const idx = links.findIndex((l) => hasIdentity(l, link.system, link.workItemId));
  const nextLinks =
    idx === -1
      ? [...links, link]
      : links.map((l, i) => (i === idx ? link : l));
  return { ...item, links: nextLinks };
}

/**
 * Remove the link with the given identity. No-op (still returns a new item)
 * when no link matches. Drops the `links` field entirely once the last link
 * is removed, keeping serialized items free of empty arrays.
 */
export function removeLink(item: PRDItem, system: string, workItemId: string): PRDItem {
  const links = getLinks(item);
  const nextLinks = links.filter((l) => !hasIdentity(l, system, workItemId));
  if (nextLinks.length === 0) {
    const { links: _drop, ...rest } = item;
    return rest as PRDItem;
  }
  return { ...item, links: nextLinks };
}

/**
 * Patch the sync-tracking fields of the link with the given identity so the
 * PRD linkage reflects the latest known state of the remote work item. No-op
 * (still returns a new item) when no link matches. Returns a new item.
 */
export function updateLinkSyncState(
  item: PRDItem,
  system: string,
  workItemId: string,
  patch: WorkItemLinkSyncPatch,
): PRDItem {
  const links = getLinks(item);
  const nextLinks = links.map((l) =>
    hasIdentity(l, system, workItemId) ? { ...l, ...patch } : l,
  );
  return { ...item, links: nextLinks };
}
