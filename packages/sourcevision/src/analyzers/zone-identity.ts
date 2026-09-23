/**
 * Zone identity: when a name is a placeholder, how ids improve, and how an id
 * change propagates.
 *
 * Ids are derived from directories and fall back to `<base>-<n>` when two
 * communities derive the same one; names start as the title-cased id and are
 * replaced by a chosen one. Three things went wrong with that on n-site2:
 *
 * - A placeholder name from a *previous* id ("Routes 8" on what is now
 *   `routes-6`) no longer equals the title-cased current id, so it passed for
 *   a chosen name and was never renamed.
 * - A verified name ("Scrapbook Application") never reached the id, so
 *   `routes-11` is what findings, CONTEXT.md, pins and `get_zone` showed.
 * - Renaming a parent zone left its sub-zones under the old prefix.
 *
 * Kept free of `zones.ts` imports so both the pipeline and the cascade can
 * use it without a cycle.
 *
 * @module sourcevision/analyzers/zone-identity
 */

import type { Finding, Zone, ZoneCrossing } from "../schema/index.js";

/** Title-case an id's last path segment, dropping empty segments: "routes--marketing" → "Routes Marketing". */
export function titleFromId(id: string): string {
  const leaf = id.split("/").pop() ?? id;
  return leaf
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * True when `name` is a placeholder derived from any of `ids` rather than a
 * chosen name: the title-cased id, or the title-cased base of an id with a
 * numeric suffix followed by any number ("Routes 8" for `routes-6`).
 */
export function isAlgorithmicName(name: string, ids: Iterable<string>): boolean {
  const n = normalizeName(name);
  if (!n) return true;
  for (const id of ids) {
    if (!id) continue;
    if (n === normalizeName(titleFromId(id))) return true;
    // Older sub-zone placeholders were title-cased from the whole path.
    const fullTitle = id.split("-").filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    if (n === normalizeName(fullTitle)) return true;
    const base = (id.split("/").pop() ?? id).replace(/-\d+$/, "");
    const baseTitle = normalizeName(titleFromId(base));
    if (baseTitle && (n === baseTitle || new RegExp(`^${escapeRegExp(baseTitle)} \\d+$`).test(n))) return true;
  }
  return false;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Every id a zone has answered to, current first. */
export function zoneIdsOf(zone: Pick<Zone, "id" | "previousIds">): string[] {
  return [zone.id, ...(zone.previousIds ?? [])];
}

/** kebab-case an id from a name, at most `maxWords` words. */
export function idFromName(name: string, maxWords = 4): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .join("-");
}

// ── Id propagation ───────────────────────────────────────────────────────────

/** Re-prefix every sub-zone id (and sub-crossing endpoint) under `zone` from `oldId` to `zone.id`. */
export function reprefixSubZones(zone: Zone, oldId: string): Zone {
  if (oldId === zone.id || !zone.subZones?.length) return zone;
  const swap = (id: string) => (id === oldId ? zone.id : id.startsWith(`${oldId}/`) ? zone.id + id.slice(oldId.length) : id);
  const walk = (z: Zone): Zone => ({
    ...z,
    id: swap(z.id),
    ...(z.subZones ? { subZones: z.subZones.map(walk) } : {}),
    ...(z.subCrossings ? { subCrossings: z.subCrossings.map((c) => ({ ...c, fromZone: swap(c.fromZone), toZone: swap(c.toZone) })) } : {}),
  });
  return {
    ...zone,
    subZones: zone.subZones.map(walk),
    ...(zone.subCrossings ? { subCrossings: zone.subCrossings.map((c) => ({ ...c, fromZone: swap(c.fromZone), toZone: swap(c.toZone) })) } : {}),
  };
}

export interface IdRename {
  zones: Zone[];
  /** old id → new id */
  renamed: Map<string, string>;
}

/**
 * A top-level zone whose id carries a numeric suffix and whose name is a
 * chosen one takes its id from the name (`routes-11` "Scrapbook Application"
 * → `scrapbook-application`), recording the old id in `previousIds`. Ids
 * without a numeric suffix are never renamed: people already refer to them.
 */
export function idsFollowNames(zones: Zone[]): IdRename {
  const used = new Set(zones.map((z) => z.id));
  const renamed = new Map<string, string>();
  const out = zones.map((zone) => {
    if (!/-\d+$/.test(zone.id) || isAlgorithmicName(zone.name, zoneIdsOf(zone))) return zone;
    const base = idFromName(zone.name);
    if (!base) return zone;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    if (/-\d+$/.test(id) && id !== base) return zone; // would only trade one number for another
    used.delete(zone.id);
    used.add(id);
    renamed.set(zone.id, id);
    const next: Zone = {
      ...zone,
      id,
      previousIds: [...new Set([zone.id, ...(zone.previousIds ?? [])])],
    };
    return reprefixSubZones(next, zone.id);
  });
  return { zones: out, renamed };
}

/** Apply an id rename to finding scopes and crossing endpoints. */
export function renameZoneRefs<T extends Pick<Finding, "scope">>(items: T[], renamed: Map<string, string>): T[] {
  if (renamed.size === 0) return items;
  return items.map((f) => (renamed.has(f.scope) ? { ...f, scope: renamed.get(f.scope)! } : f));
}

export function renameCrossings(crossings: ZoneCrossing[], renamed: Map<string, string>): ZoneCrossing[] {
  if (renamed.size === 0) return crossings;
  return crossings.map((c) => ({
    ...c,
    fromZone: renamed.get(c.fromZone) ?? c.fromZone,
    toZone: renamed.get(c.toZone) ?? c.toZone,
  }));
}

/** Resolve a zone by current or previous id. */
export function findZoneById<T extends Pick<Zone, "id" | "previousIds">>(zones: T[], id: string): T | undefined {
  return zones.find((z) => z.id === id) ?? zones.find((z) => z.previousIds?.includes(id));
}

// ── Deeper disambiguation ────────────────────────────────────────────────────

/** Segments that describe a role inside a module, never the module. */
const ROLE_SEGMENTS = new Set([
  "lib", "components", "component", "utils", "util", "hooks", "helpers", "data", "config",
  "types", "models", "services", "styles", "ui", "internal", "src", "app", "pkg",
  "__tests__", "__mocks__", "tests", "test", "spec", "specs",
]);

/**
 * The most specific directory segment that names these files: walk the
 * directory prefix shared by at least half of them from deepest to shallowest
 * and take the first segment that is not a role, not skipped, and not already
 * used. `app/routes/apps/learn-agentcore/lib/*` → `learn-agentcore`.
 */
export function deepestDistinguishingSegment(
  files: string[],
  skip: ReadonlySet<string>,
  used: ReadonlySet<string>,
): string | undefined {
  const dirs = files.map((f) => f.split("/").slice(0, -1));
  if (dirs.length === 0) return undefined;
  const half = Math.ceil(dirs.length / 2);
  // Longest prefix shared by at least half the files.
  const prefix: string[] = [];
  for (let depth = 0; ; depth++) {
    const counts = new Map<string, number>();
    for (const d of dirs) {
      if (d.length <= depth || !prefix.every((p, i) => d[i] === p)) continue;
      counts.set(d[depth], (counts.get(d[depth]) ?? 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (!best || best[1] < half) break;
    prefix.push(best[0]);
  }
  for (let i = prefix.length - 1; i >= 0; i--) {
    const seg = prefix[i].toLowerCase().replace(/_/g, "-").replace(/^[-.$+]+|-+$/g, "");
    if (!seg || ROLE_SEGMENTS.has(seg) || skip.has(seg) || used.has(seg)) continue;
    return seg;
  }
  return undefined;
}

// ── Filename-derived ids ─────────────────────────────────────────────────────

const STEM_SKIP = new Set(["index", "test", "spec", "route", "page", "layout"]);

/**
 * Words of a filename stem: camelCase split, route syntax stripped
 * (`what.case-studies.$slug` → what, case, studies, slug; `_index` → nothing).
 */
export function stemWords(stem: string): string[] {
  return stem
    .replace(/\[|\]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STEM_SKIP.has(w));
}

/** An id from the words of up to `files` stems, capped at `maxWords`. */
export function idFromStems(stems: string[], maxWords = 4): string | null {
  const words: string[] = [];
  for (const stem of stems) {
    for (const w of stemWords(stem)) {
      if (!words.includes(w)) words.push(w);
      if (words.length >= maxWords) break;
    }
    if (words.length >= maxWords) break;
  }
  return words.length >= 2 ? words.join("-") : null;
}

/**
 * A selected or templated name can coincide across zones ("Tests" for three
 * test directories, the package name for a two-file remainder of a package).
 * The largest zone keeps the name; the others fall back to the title-cased
 * id, which is unique by construction.
 */
export function dedupeZoneNames(zones: Zone[]): Zone[] {
  const byName = new Map<string, Zone[]>();
  for (const z of zones) {
    const key = z.name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), z]);
  }
  const fallback = new Set<string>();
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const [, ...rest] = [...group].sort((a, b) => b.files.length - a.files.length);
    for (const z of rest) fallback.add(z.id);
  }
  if (fallback.size === 0) return zones;
  return zones.map((z) => (fallback.has(z.id) ? { ...z, name: z.id.split("-").filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") } : z));
}

/**
 * Lower-cased directory segments shared by at least half of `files`, from the
 * root down — the part of the path a zone's children all have in common.
 */
export function sharedPrefixSegments(files: string[]): Set<string> {
  const dirs = files.map((f) => f.split("/").slice(0, -1));
  const half = Math.ceil(dirs.length / 2);
  const prefix: string[] = [];
  for (let depth = 0; dirs.length > 0; depth++) {
    const counts = new Map<string, number>();
    for (const d of dirs) {
      if (d.length <= depth || !prefix.every((p, i) => d[i] === p)) continue;
      counts.set(d[depth], (counts.get(d[depth]) ?? 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (!best || best[1] < half) break;
    prefix.push(best[0]);
  }
  return new Set(prefix.map((p) => p.toLowerCase()));
}
