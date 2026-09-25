/**
 * Names for areas whose templated name ("Utils & OAuth & Admin Operations")
 * is a placeholder: the same selection-then-generation path zones use, run on
 * an area-shaped zone. Package, route and single-member names are already
 * specific and are left alone. A name judged or generated on a previous run
 * for the same set of zones is carried forward, so re-runs ask nothing.
 *
 * @module sourcevision/analyzers/area-naming
 */

import type { Zone, ZoneArea } from "../schema/index.js";
import { getJudgmentRoute } from "./claude-client.js";
import { areaAsZone } from "./zone-areas.js";
import { nameZonesBySelection } from "./zone-naming.js";
import type { RouteLayout } from "./route-convention.js";
import { idFromName } from "./zone-identity.js";

export interface AreaNamingOptions {
  projectDir?: string;
  fileArchetypes?: Map<string, string | null>;
  routeLayout?: RouteLayout;
  /** Areas from the previous run, for carrying names forward. */
  previous?: ZoneArea[];
  /** Leave generated names for `sv narrate` instead of calling the text model now. */
  defer?: boolean;
}

const sameZones = (a: ZoneArea, b: ZoneArea) =>
  a.zones.length === b.zones.length && a.zones.every((z, i) => z === b.zones[i]);

/** Re-derive an area's id from its (new) name, unique among `areas`. */
function withIdFromName(area: ZoneArea, used: Set<string>): ZoneArea {
  const base = idFromName(area.name, 3) || area.id;
  let id = base;
  for (let n = 2; used.has(id) && id !== area.id; n++) id = `${base}-${n}`;
  used.add(id);
  return { ...area, id };
}

/**
 * Judge (and where needed, generate or defer) names for templated areas.
 * Returns the areas and the `area:<id>` ids left for background generation.
 */
export async function nameAreas(
  areas: ZoneArea[],
  zones: Zone[],
  opts: AreaNamingOptions = {},
): Promise<{ areas: ZoneArea[]; pending: string[] }> {
  // Carry a previous judged/generated name for an identical zone set.
  let out = areas.map((a) => {
    const prev = opts.previous?.find((p) => sameZones(p, a) && (p.nameSource === "judged" || p.nameSource === "generated"));
    return prev ? { ...a, id: prev.id, name: prev.name, nameSource: prev.nameSource } : a;
  });

  const targets = out.filter((a) => a.nameSource === "template");
  if (targets.length === 0 || getJudgmentRoute("zone.judge") !== "typesafe") return { areas: out, pending: [] };

  const naming = await nameZonesBySelection(targets.map((a) => areaAsZone(a, zones)), {
    projectDir: opts.projectDir,
    fileArchetypes: opts.fileArchetypes,
    crossings: [],
    routeLayout: opts.routeLayout,
    noMerges: true,
    deferGeneratedNames: opts.defer,
  });
  const chosen = new Map(naming.zones.map((z) => [z.id, z.name]));
  const fallback = new Set(naming.fallbackZoneIds);

  const used = new Set(out.filter((a) => a.nameSource !== "template").map((a) => a.id));
  const pending: string[] = [];
  out = out.map((a) => {
    if (a.nameSource !== "template") return a;
    const key = `area:${a.id}`;
    const name = chosen.get(key);
    if (name && name !== a.name) return withIdFromName({ ...a, name, nameSource: fallback.has(key) ? "generated" : "judged" }, used);
    used.add(a.id);
    if (fallback.has(key) && opts.defer) pending.push(key);
    return a;
  });
  return { areas: out, pending };
}

/**
 * Apply names generated for `area:<id>` pseudo-zones (by `sv narrate`) to the
 * stored areas. Pure.
 */
export function applyGeneratedAreaNames(areas: ZoneArea[], named: Zone[]): { areas: ZoneArea[]; renamed: string[] } {
  const byKey = new Map(named.filter((z) => z.id.startsWith("area:")).map((z) => [z.id, z.name]));
  const used = new Set(areas.map((a) => a.id));
  const renamed: string[] = [];
  const out = areas.map((a) => {
    const name = byKey.get(`area:${a.id}`);
    if (!name || name === a.name) return a;
    renamed.push(a.id);
    used.delete(a.id);
    return withIdFromName({ ...a, name, nameSource: "generated" }, used);
  });
  return { areas: out, renamed };
}
