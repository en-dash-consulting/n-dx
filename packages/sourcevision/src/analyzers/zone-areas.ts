/**
 * Areas: the level above zones.
 *
 * Zones are the right grain for "which files belong together", and the wrong
 * grain for a first look at a project: n-site2 has 52, and a map of 52 blocks
 * with 217 edges is not a map. Areas group zones into 4–10 regions a person
 * can hold in their head, with the zones kept intact underneath.
 *
 * - Structure seeds the grouping: zones serving children of one route
 *   container (`app/routes/apps/*`) start together, and in a monorepo zones
 *   under one package root start together and never merge with another
 *   package's group.
 * - The rest is agglomerative on the zone graph: merge the pair of groups
 *   with the most crossing weight relative to the smaller group's size, until
 *   the target count is reached.
 * - Test zones are not clustered — a test suite imports everything it tests,
 *   which would glue unrelated areas. Each joins the area it mostly imports;
 *   one that spreads across areas (an e2e suite) goes to a `tests` area.
 *
 * Pure and deterministic; names are templated here and may be replaced by a
 * judged name by the caller.
 *
 * @module sourcevision/analyzers/zone-areas
 */

import { dirname } from "node:path";
import type { Zone, ZoneArea, ZoneCrossing } from "../schema/index.js";
import type { RouteLayout } from "./route-convention.js";
import { routeFeatureOf, routePathOf } from "./route-convention.js";
import { idFromName } from "./zone-identity.js";

/** Target area count for `n` production zones. */
export function targetAreaCount(n: number): number {
  return Math.max(MIN_AREAS, Math.min(MAX_AREAS, Math.round(1.3 * Math.sqrt(n))));
}
const MIN_AREAS = 4;
const MAX_AREAS = 10;

/** Below this many top-level zones areas add nothing. */
export const MIN_ZONES_FOR_AREAS = 8;

/** Largest share of production files one area may hold while another merge is available. */
const MAX_AREA_SHARE = 0.35;
/** A group below this share of files may join any area regardless of the size guard. */
const SLIVER_SHARE = 0.02;
/** Unconnected single zones below this share of files are gathered into one support area. */
const LONER_MAX_SHARE = 0.1;

/** Share of a test zone's outgoing weight one area must receive for the zone to join it. */
export const TEST_JOIN_SHARE = 0.5;

const MONOREPO_ROOTS = new Set(["packages", "apps", "libs", "services", "modules", "crates"]);
const GENERIC_DIRS = new Set(["src", "lib", "app", "internal", "pkg", "source", "packages", "apps", "libs"]);

export interface AreaInput {
  zones: Zone[];
  crossings: ZoneCrossing[];
  testFiles: ReadonlySet<string>;
  routeLayout?: RouteLayout;
}

interface Group {
  key: string;
  /** Gathered loose ends: named as support, not after its largest member. */
  support?: boolean;
  seed?: { kind: "route" | "package"; label: string };
  zones: Zone[];
  files: number;
}

/** True when most of a zone's files are tests. */
export function isTestZone(zone: Zone, testFiles: ReadonlySet<string>): boolean {
  if (zone.files.length === 0) return false;
  const tests = zone.files.filter((f) => testFiles.has(f)).length;
  return tests / zone.files.length >= 0.5;
}

function majority<T>(items: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const i of items) counts.set(i, (counts.get(i) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= items.length * 0.5 ? best[0] : undefined;
}

function seedOf(zone: Zone, layout: RouteLayout | undefined): Group["seed"] & { key: string } | undefined {
  // Monorepo package root: packages/<name>/…
  const pkg = majority(zone.files.map((f) => {
    const parts = f.split("/");
    return parts.length > 2 && MONOREPO_ROOTS.has(parts[0]) ? `${parts[0]}/${parts[1]}` : "";
  }));
  if (pkg) return { kind: "package", label: pkg.split("/")[1], key: `pkg:${pkg}` };
  // Children of one route container: app/routes/apps/<name>
  if (layout && layout.containers.size > 0) {
    const container = majority(zone.files.map((f) => {
      const feature = routeFeatureOf(f, layout);
      return feature && layout.containers.has(dirname(feature)) ? dirname(feature) : "";
    }));
    if (container) return { kind: "route", label: routePathOf(container, layout), key: `route:${container}` };
  }
  return undefined;
}

function titleCase(s: string): string {
  return s.split(/[-_/\s]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function dominantDirectory(zones: Zone[], skip: ReadonlySet<string>): string | undefined {
  const segs: string[] = [];
  for (const z of zones) {
    for (const f of z.files) {
      const seg = f.split("/").slice(0, -1).find((p) => !GENERIC_DIRS.has(p.toLowerCase()) && !skip.has(p.toLowerCase()));
      if (seg) segs.push(seg.replace(/^[_$.]+/, ""));
    }
  }
  const counts = new Map<string, number>();
  for (const s of segs) counts.set(s, (counts.get(s) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}

function areaName(group: Group, skip: ReadonlySet<string>): { name: string; source: NonNullable<ZoneArea["nameSource"]> } {
  if (group.support) return { name: "Project Support", source: "support" };
  if (group.seed?.kind === "package") return { name: titleCase(group.seed.label), source: "package" };
  if (group.seed?.kind === "route" && group.zones.length > 1) {
    return { name: titleCase(group.seed.label.split("/").filter(Boolean).pop() ?? "routes"), source: "route" };
  }
  // Name after the production zone that makes up most of it; tests ride along.
  const members = group.zones.filter((z) => !/^tests(-|$)/.test(z.id));
  const ranked = [...(members.length > 0 ? members : group.zones)].sort((a, b) => b.files.length - a.files.length || a.id.localeCompare(b.id));
  const files = ranked.reduce((n, z) => n + z.files.length, 0);
  const [first, second] = ranked;
  if (first && first.files.length >= files * 0.5) return { name: first.name, source: "member" };
  // A placeholder until judged: the two largest members, or the directory.
  if (first && second) return { name: `${first.name} & ${second.name}`, source: "template" };
  return { name: titleCase(dominantDirectory(group.zones, skip) ?? first?.name ?? group.key), source: "template" };
}

/** An area as a zone-shaped value, for the naming judgment and generation. */
export function areaAsZone(area: ZoneArea, zones: Zone[]): Zone {
  const ids = new Set(area.zones);
  const members = zones.filter((z) => ids.has(z.id));
  return {
    id: `area:${area.id}`,
    name: area.name,
    description: `Area of ${members.length} zones: ${members.map((z) => z.name).join(", ")}.`,
    files: members.flatMap((z) => z.files),
    entryPoints: members.flatMap((z) => z.entryPoints).slice(0, 20),
    cohesion: 0,
    coupling: 0,
  };
}

/**
 * Group top-level zones into areas. Returns [] when there are too few zones
 * for a second level to help.
 */
export function computeAreas(input: AreaInput): ZoneArea[] {
  const { zones, crossings, testFiles, routeLayout } = input;
  if (zones.length < MIN_ZONES_FOR_AREAS) return [];

  const testZones = zones.filter((z) => isTestZone(z, testFiles));
  const prodZones = zones.filter((z) => !isTestZone(z, testFiles));
  if (prodZones.length === 0) return [];

  // ── Seed groups ──
  const groups = new Map<string, Group>();
  const groupOfZone = new Map<string, string>();
  for (const z of prodZones) {
    const seed = seedOf(z, routeLayout);
    const key = seed?.key ?? `zone:${z.id}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, ...(seed ? { seed: { kind: seed.kind, label: seed.label } } : {}), zones: [], files: 0 }));
    g.zones.push(z);
    g.files += z.files.length;
    groupOfZone.set(z.id, key);
  }

  // ── Zone-level weights (production only) ──
  const zoneWeight = new Map<string, number>();
  const pairKey = (a: string, b: string) => (a < b ? `${a}\u0001${b}` : `${b}\u0001${a}`);
  for (const c of crossings) {
    if (!groupOfZone.has(c.fromZone) || !groupOfZone.has(c.toZone) || c.fromZone === c.toZone) continue;
    const k = pairKey(c.fromZone, c.toZone);
    zoneWeight.set(k, (zoneWeight.get(k) ?? 0) + 1);
  }

  // ── Loose ends ──
  // Small zones with no crossings to any other production zone (config,
  // scripts, a schema directory) would each end up an area of their own;
  // gather them into one support area before agglomerating the rest.
  const touched = new Set<string>();
  for (const k of zoneWeight.keys()) for (const id of k.split("\u0001")) touched.add(id);
  const prodFilesAll = prodZones.reduce((n, z) => n + z.files.length, 0);
  const loners = [...groups.values()]
    .filter((g) => !g.seed && g.zones.length === 1 && !touched.has(g.zones[0].id) && g.files < prodFilesAll * LONER_MAX_SHARE);
  if (loners.length > 1) {
    const support: Group = { key: "support", support: true, zones: [], files: 0 };
    for (const g of loners) {
      for (const z of g.zones) groupOfZone.set(z.id, support.key);
      support.zones.push(...g.zones);
      support.files += g.files;
      groups.delete(g.key);
    }
    groups.set(support.key, support);
  }

  // ── Agglomerate ──
  const target = targetAreaCount(prodZones.length);
  const prodFiles = prodZones.reduce((n, z) => n + z.files.length, 0);
  const largestSeed = Math.max(...[...groups.values()].map((g) => g.files));
  // No area may pass this share while another merge is available — without
  // it one group snowballs (every merge makes it the best-connected).
  const maxAreaFiles = Math.max(largestSeed, Math.ceil(prodFiles * MAX_AREA_SHARE));
  while (groups.size > target) {
    const groupWeight = new Map<string, number>();
    for (const [k, w] of zoneWeight) {
      const [a, b] = k.split("\u0001");
      const ga = groupOfZone.get(a)!, gb = groupOfZone.get(b)!;
      if (ga === gb) continue;
      const gk = pairKey(ga, gb);
      groupWeight.set(gk, (groupWeight.get(gk) ?? 0) + w);
    }
    let best: { a: string; b: string; score: number; oversized: boolean } | undefined;
    for (const [gk, w] of groupWeight) {
      const [a, b] = gk.split("\u0001");
      const A = groups.get(a)!, B = groups.get(b)!;
      // Two packages stay two areas: a package boundary is declared structure.
      if (A.seed?.kind === "package" && B.seed?.kind === "package") continue;
      if (A.support || B.support) continue;
      const score = w / Math.sqrt(Math.max(1, A.files) * Math.max(1, B.files));
      // A sliver joining a big area is not what the guard is for.
      const oversized = A.files + B.files > maxAreaFiles && Math.min(A.files, B.files) > prodFiles * SLIVER_SHARE;
      const better = !best
        || (best.oversized && !oversized)
        || (best.oversized === oversized && (score > best.score || (score === best.score && gk < `${best.a}\u0001${best.b}`)));
      if (better) best = { a, b, score, oversized };
    }
    // Only oversized merges left: stop short of the target rather than build
    // one area that is most of the project — unless there are still too many.
    if (best?.oversized && groups.size <= MAX_AREAS) break;
    if (!best) {
      // Nothing connected is mergeable: fold the smallest unseeded group into
      // the next smallest, or stop when only seeded groups remain.
      const loose = [...groups.values()].filter((g) => !g.seed && !g.support).sort((x, y) => x.files - y.files || x.key.localeCompare(y.key));
      if (loose.length === 0) break;
      const others = [...groups.values()].filter((g) => g !== loose[0] && !g.support).sort((x, y) => x.files - y.files || x.key.localeCompare(y.key));
      if (others.length === 0) break;
      best = { a: loose[0].key, b: others[0].key, score: 0, oversized: false };
    }
    const A = groups.get(best.a)!, B = groups.get(best.b)!;
    // The seeded or larger group absorbs the other and keeps its identity.
    const [into, from] = (B.seed && !A.seed) || (!A.seed === !B.seed && B.files > A.files) ? [B, A] : [A, B];
    for (const z of from.zones) groupOfZone.set(z.id, into.key);
    into.zones.push(...from.zones);
    into.files += from.files;
    groups.delete(from.key);
  }

  // ── Tests join the area they test ──
  const zoneOfFile = new Map<string, string>();
  for (const z of zones) for (const f of z.files) zoneOfFile.set(f, z.id);
  let testsGroup: Group | undefined;
  for (const t of testZones) {
    const toGroup = new Map<string, number>();
    let total = 0;
    for (const c of crossings) {
      if (c.fromZone !== t.id) continue;
      const g = groupOfZone.get(c.toZone);
      if (!g) continue;
      toGroup.set(g, (toGroup.get(g) ?? 0) + 1);
      total++;
    }
    const top = [...toGroup.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    let key: string;
    if (top && total > 0 && top[1] / total >= TEST_JOIN_SHARE) {
      key = top[0];
    } else {
      testsGroup ??= { key: "tests", zones: [], files: 0 };
      if (!groups.has("tests")) groups.set("tests", testsGroup);
      key = "tests";
    }
    const g = groups.get(key)!;
    g.zones.push(t);
    g.files += t.files.length;
    groupOfZone.set(t.id, key);
  }

  // ── Slivers ──
  // A group below the sliver share is not an area; fold it into the group it
  // is most connected to (any crossing direction, tests included).
  const total = [...groups.values()].reduce((n, g) => n + g.files, 0);
  for (const g of [...groups.values()].sort((a, b) => a.files - b.files || a.key.localeCompare(b.key))) {
    if (!groups.has(g.key) || g.support || g.seed?.kind === "package" || g.files >= total * SLIVER_SHARE) continue;
    const ids = new Set(g.zones.map((z) => z.id));
    const toGroup = new Map<string, number>();
    for (const c of crossings) {
      const other = ids.has(c.fromZone) ? c.toZone : ids.has(c.toZone) ? c.fromZone : undefined;
      if (!other || ids.has(other)) continue;
      const og = groupOfZone.get(other);
      if (og && og !== g.key) toGroup.set(og, (toGroup.get(og) ?? 0) + 1);
    }
    // Production code never folds into the tests area.
    const hasProd = g.zones.some((z) => !isTestZone(z, testFiles));
    const top = [...toGroup.entries()]
      .filter(([k]) => !(hasProd && k === "tests"))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (!top) continue;
    const into = groups.get(top[0])!;
    for (const z of g.zones) groupOfZone.set(z.id, into.key);
    into.zones.push(...g.zones);
    into.files += g.files;
    groups.delete(g.key);
  }

  // ── Name and emit ──
  const skip = routeLayout?.genericSegments ?? new Set<string>();
  const used = new Set<string>();
  const areas: ZoneArea[] = [];
  for (const g of [...groups.values()].sort((a, b) => b.files - a.files || a.key.localeCompare(b.key))) {
    const { name, source } = g.key === "tests" ? { name: "Tests", source: "tests" as const } : areaName(g, skip);
    const base = idFromName(name, 3) || "area";
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    areas.push({
      id,
      name,
      zones: g.zones.map((z) => z.id).sort(),
      files: g.files,
      nameSource: source,
    });
  }
  return areas;
}
