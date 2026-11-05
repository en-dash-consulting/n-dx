/**
 * A rex item's link to a tracker work item, as the server reads and writes it.
 *
 * A link is one work ref: a tracker key (`WM-2054`) or an http(s) URL, the
 * same two shapes rex's `isWorkRef` accepts. On a v2 tree it is an entry of
 * the item's `issues`; on a v1 tree it is a `links[]` entry
 * (`{ system, workItemId, url? }`), whose ref is its url, else its
 * `workItemId`. Pure, and the one place that reads either shape: the viewer
 * is sent the refs (`GET /api/rex/items/:id/links`, the Live task snapshot)
 * and never reads the item's fields itself.
 */

const TRACKER_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;

/** The system a link this module writes names; rex's v1 model needs one. */
export const TRACKER_LINK_SYSTEM = "tracker";

/** `value` as a work ref, trimmed, or null when it is neither a tracker key nor an http(s) URL. */
export function normalizeWorkRef(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ref = value.trim();
  if (TRACKER_KEY.test(ref)) return ref;
  return /^https?:\/\/[^\s/?#]+/.test(ref) && URL.canParse(ref) ? ref : null;
}

/** The fields of an item a link lives in; either may be absent or, on a hand-edited tree, malformed. */
export interface LinkFields {
  issues?: unknown;
  links?: unknown;
}

interface V1Link {
  system?: unknown;
  workItemId?: unknown;
  url?: unknown;
}

const isV1Link = (value: unknown): value is V1Link => typeof value === "object" && value !== null;

/** The work ref a v1 link stands for, or null for an id no ref can hold. */
function refOfLink(link: unknown): string | null {
  if (!isV1Link(link)) return null;
  return normalizeWorkRef(link.url) ?? normalizeWorkRef(link.workItemId);
}

function issuesOf(item: LinkFields): string[] {
  return Array.isArray(item.issues) ? item.issues.filter((v): v is string => typeof v === "string") : [];
}

/** Every ref an item links to, v2 `issues` first, then v1 `links`, without repeats. */
export function itemLinkRefs(item: LinkFields): string[] {
  const links = Array.isArray(item.links) ? item.links.map(refOfLink).filter((r): r is string => r !== null) : [];
  return [...new Set([...issuesOf(item), ...links])];
}

/**
 * The field values that add `ref` to an item: `issues` on a v2 tree, `links`
 * on a v1 tree. Null when the item already links to it.
 */
export function linkPatch(item: LinkFields, ref: string, v2: boolean): LinkFields | null {
  if (itemLinkRefs(item).includes(ref)) return null;
  if (v2) return { issues: [...issuesOf(item), ref] };
  const links = Array.isArray(item.links) ? item.links : [];
  const url = ref.startsWith("http") ? { url: ref } : {};
  return { links: [...links, { system: TRACKER_LINK_SYSTEM, workItemId: ref, ...url }] };
}

/**
 * The field values that remove `ref` from an item, from whichever field holds
 * it; an emptied field is `undefined` so the writer drops it. Null when the
 * item does not link to it.
 */
export function unlinkPatch(item: LinkFields, ref: string): LinkFields | null {
  if (!itemLinkRefs(item).includes(ref)) return null;
  const patch: LinkFields = {};
  if (issuesOf(item).includes(ref)) {
    const rest = issuesOf(item).filter((r) => r !== ref);
    patch.issues = rest.length > 0 ? rest : undefined;
  }
  if (Array.isArray(item.links) && item.links.some((l) => refOfLink(l) === ref)) {
    const rest = item.links.filter((l) => refOfLink(l) !== ref);
    patch.links = rest.length > 0 ? rest : undefined;
  }
  return patch;
}
