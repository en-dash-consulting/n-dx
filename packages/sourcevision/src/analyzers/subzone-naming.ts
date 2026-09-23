/**
 * Names for sub-zones at every depth.
 *
 * Top-level zones go through the cascade's naming; sub-zones were left with
 * their derived ids as names ("Utils 2", "Marketing Components Components"),
 * which is what a reader sees as soon as the map expands a zone. This runs the
 * same selection-then-generation path over every sub-zone still carrying a
 * placeholder, never asks merge questions (sub-zones are a partition of their
 * parent), and gives numbered sub-zone ids the id of their chosen name.
 *
 * A name chosen in a previous run for the same set of files is carried
 * forward first, so a re-run asks only about sub-zones that changed.
 *
 * @module sourcevision/analyzers/subzone-naming
 */

import type { Zone } from "../schema/index.js";
import { getJudgmentRoute } from "./claude-client.js";
import { nameZonesBySelection } from "./zone-naming.js";
import type { RouteLayout } from "./route-convention.js";
import { idFromName, isAlgorithmicName, reprefixSubZones, sharedPrefixSegments, zoneIdsOf } from "./zone-identity.js";

export interface SubZoneNamingOptions {
  projectDir?: string;
  fileArchetypes?: Map<string, string | null>;
  routeLayout?: RouteLayout;
  /** Top-level zones of the previous run, for carrying sub-zone names forward. */
  previous?: Zone[];
  /** Leave generated names for `sv narrate`. */
  defer?: boolean;
}

/** Every sub-zone below `zones`, depth-first. */
export function flattenSubZones(zones: Zone[]): Zone[] {
  const out: Zone[] = [];
  const walk = (z: Zone) => { for (const s of z.subZones ?? []) { out.push(s); walk(s); } };
  zones.forEach(walk);
  return out;
}

const filesKey = (z: Zone) => [...z.files].sort().join("\n");

/** Rebuild the tree with `rename(zone)` applied to every sub-zone (not the roots). */
function mapSubZones(zones: Zone[], rename: (z: Zone, siblings: Zone[]) => Zone): Zone[] {
  const walk = (z: Zone): Zone => {
    if (!z.subZones?.length) return z;
    const kids = z.subZones.map((k) => rename(k, z.subZones!));
    return { ...z, subZones: kids.map(walk) };
  };
  return zones.map(walk);
}

/**
 * A numbered sub-zone (`parent/utils-2`) with a chosen name takes its leaf id
 * from the name (`parent/oauth-sessions`), unique among its siblings, and
 * records the old id; its own sub-zones are re-prefixed.
 */
export function subZoneIdsFollowNames(zones: Zone[]): Zone[] {
  const walk = (parent: Zone): Zone => {
    if (!parent.subZones?.length) return parent;
    const used = new Set(parent.subZones.map((k) => k.id));
    const kids = parent.subZones.map((k) => {
      const leaf = k.id.slice(k.id.lastIndexOf("/") + 1);
      if (!/-\d+$/.test(leaf) || isAlgorithmicName(k.name, zoneIdsOf(k))) return k;
      const prefix = k.id.slice(0, k.id.lastIndexOf("/") + 1);
      const base = idFromName(k.name, 3);
      if (!base) return k;
      const id = `${prefix}${base}`;
      if (used.has(id)) return k;
      used.delete(k.id);
      used.add(id);
      return reprefixSubZones({ ...k, id, previousIds: [...new Set([k.id, ...(k.previousIds ?? [])])] }, k.id);
    });
    return { ...parent, subZones: kids.map(walk) };
  };
  return zones.map(walk);
}

/** Apply `id → name` to sub-zones anywhere in the tree. Pure. */
export function applySubZoneNames(zones: Zone[], names: Map<string, string>): { zones: Zone[]; renamed: string[] } {
  const renamed: string[] = [];
  const out = mapSubZones(zones, (k) => {
    const name = names.get(k.id);
    if (!name || name === k.name) return k;
    renamed.push(k.id);
    return { ...k, name };
  });
  return { zones: out, renamed };
}

/**
 * Carry, judge, and (unless deferred) generate names for sub-zones with
 * placeholder names; then let numbered ids follow. Returns the zones and the
 * sub-zone ids left for background generation.
 */
export async function nameSubZones(zones: Zone[], opts: SubZoneNamingOptions = {}): Promise<{ zones: Zone[]; pending: string[] }> {
  // Carry chosen names from the previous run by identical file set.
  const prevNames = new Map<string, string>();
  for (const p of flattenSubZones(opts.previous ?? [])) {
    if (!isAlgorithmicName(p.name, zoneIdsOf(p))) prevNames.set(filesKey(p), p.name);
  }
  let out = mapSubZones(zones, (k) => {
    if (!isAlgorithmicName(k.name, zoneIdsOf(k))) return k;
    const carried = prevNames.get(filesKey(k));
    return carried ? { ...k, name: carried } : k;
  });
  // A carried name can be an echo from an earlier run: same rule as a new one.
  out = revertEchoedNames(out, new Set(flattenSubZones(out).map((k) => k.id)));

  const targets = flattenSubZones(out).filter((k) => isAlgorithmicName(k.name, zoneIdsOf(k)));
  const pending: string[] = [];
  if (targets.length > 0 && getJudgmentRoute("zone.judge") === "typesafe") {
    const naming = await nameZonesBySelection(targets, subZoneNamingContext(out, opts, true));
    const names = new Map(naming.zones.map((z) => [z.id, z.name]));
    out = revertEchoedNames(applySubZoneNames(out, names).zones, new Set(targets.map((t) => t.id)));
    if (opts.defer) {
      pending.push(...flattenSubZones(out).filter((k) => isAlgorithmicName(k.name, zoneIdsOf(k))).map((k) => k.id));
    }
  }
  return { zones: subZoneIdsFollowNames(out), pending };
}

/** Parent of each sub-zone, by id. */
function parentsOf(zones: Zone[]): Map<string, Zone> {
  const map = new Map<string, Zone>();
  const walk = (z: Zone) => { for (const k of z.subZones ?? []) { map.set(k.id, z); walk(k); } };
  zones.forEach(walk);
  return map;
}

/**
 * Naming context for sub-zones: no merge questions, and each sub-zone's
 * candidates skip its parent's shared directories, so the siblings under
 * `app/components/park/` are offered `engine` and `worldgen`, not "Park".
 */
export function subZoneNamingContext(zones: Zone[], opts: SubZoneNamingOptions, defer = false) {
  const parents = parentsOf(zones);
  const skipCache = new Map<string, ReadonlySet<string>>();
  return {
    projectDir: opts.projectDir,
    fileArchetypes: opts.fileArchetypes,
    crossings: [],
    routeLayout: opts.routeLayout,
    noMerges: true,
    deferGeneratedNames: defer && opts.defer,
    skipSegmentsFor: (z: Zone) => {
      const parent = parents.get(z.id);
      if (!parent) return new Set<string>();
      let skip = skipCache.get(parent.id);
      if (!skip) skipCache.set(parent.id, (skip = sharedPrefixSegments(parent.files)));
      return skip;
    },
  };
}

/**
 * A just-chosen name that repeats the parent's or a sibling's name says
 * nothing about the sub-zone: the largest sibling keeps it, the others go back
 * to their placeholder (and so to generation).
 */
export function revertEchoedNames(zones: Zone[], chosenNow: Set<string>): Zone[] {
  const placeholder = (k: Zone) => k.id.slice(k.id.lastIndexOf("/") + 1).split("-").filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  const walk = (parent: Zone): Zone => {
    if (!parent.subZones?.length) return parent;
    const seen = new Set<string>([parent.name.trim().toLowerCase()]);
    const bySize = [...parent.subZones].sort((a, b) => b.files.length - a.files.length);
    const revert = new Set<string>();
    for (const k of bySize) {
      const key = k.name.trim().toLowerCase();
      if (seen.has(key) && chosenNow.has(k.id)) revert.add(k.id);
      seen.add(key);
    }
    const kids = parent.subZones.map((k) => (revert.has(k.id) ? { ...k, name: placeholder(k) } : k));
    return { ...parent, subZones: kids.map(walk) };
  };
  return zones.map(walk);
}
