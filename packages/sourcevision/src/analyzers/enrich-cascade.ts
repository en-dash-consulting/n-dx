/**
 * The cascade: deterministic facts, Jev judgments, generation only where a
 * judgment was uncertain, then verification of what was generated.
 *
 * This is the default enrichment path when a judgment route resolves. It
 * replaces "send every zone to a text model and filter the prose with
 * regexes" with:
 *
 * 1. Structural zones (build, assets, docs, config) are templated — as today.
 * 2. Source zones are named by selection and merged by judgment
 *    (zone-naming.ts); descriptions are templated from facts.
 * 3. One merged Jev request asks the two fragility Nouls per zone. Code bands
 *    the probabilities: at or above {@link ESCALATION_BAND}[1] a templated
 *    warning (enrich-judge.ts emits it); below [0] nothing; in between, the
 *    zone is *escalated* — the text model is asked to look at it.
 * 4. Escalated zones go through the existing per-zone prompt as a pass-2
 *    call, so the chosen names are preserved and the model adds only
 *    insights and findings. Those findings are then judged like any other
 *    (support, anchors, severity) before assembleFindings.
 *
 * Without a judgment route this module is never entered; `zones.ts` takes the
 * generative path, so the no-key pipeline is unchanged.
 *
 * @module sourcevision/analyzers/enrich-cascade
 */

import type {
  Finding,
  Imports,
  Inventory,
  ProjectProfile,
  Zone,
  ZoneCrossing,
  Zones,
} from "../schema/index.js";
import type { EnrichResult } from "./enrich-parsing.js";
import { isStructuralZone, applyStructuralTemplate } from "./enrich.js";
import { narrateZones } from "./enrich-multiplex.js";
import { assessZoneFragility, fragilityFindings } from "./enrich-judge.js";
import { nameZonesBySelection, describeZoneFromFacts, algorithmicZoneName } from "./zone-naming.js";
import { emptyAnalyzeTokenUsage } from "./token-usage.js";
import type { AnalyzeTokenUsage } from "../schema/index.js";
import { routeLayoutFor } from "./route-convention.js";

/**
 * Fragility probabilities inside this band are neither a finding nor a
 * clean bill: the zone is handed to the text model with its file headers.
 * Above it enrich-judge.ts already emits the templated finding.
 *
 * Measured 2026-09-22 over two fragility Nouls per zone on this repository
 * (27 zones), medium-app (7) and toy-app (3): three quarters of answers sit
 * below 0.3, and the 0.3–0.4 sliver held zones that were almost certainly
 * fine. `[0.3, 0.7)` escalated 10 / 4 / 1 zones; `[0.4, 0.6)` escalates
 * 7 / 1 / 1.
 */
export const ESCALATION_BAND: [number, number] = [0.4, 0.6];

/**
 * At most this many zones are narrated per run, the ones with the higher
 * fragility probability first — closest to being a real finding. Each
 * narration is a text-model call of 20–30 s; the band alone let 13 through
 * on this repository before it was narrowed.
 */
export const ESCALATION_MAX_ZONES = 6;

/** The cascade is one judged pass; it does not iterate. */
const CASCADE_PASS = 1;

/**
 * Minimum two-way file overlap for a zone to inherit a previous run's name.
 * Mirrors zones.ts `ZONE_OVERLAP_THRESHOLD`, which identity preservation
 * applies after enrichment; naming is skipped here for the same zones so the
 * selection is not made only to be overwritten.
 */
const PREVIOUS_NAME_OVERLAP = 0.66;

export interface CascadeOptions {
  /**
   * Leave the escalated zones un-narrated and report them in
   * `deferredZoneIds`, so `analyze` can return and narrate in a detached
   * child. Zones carried from a previous run keep their insights either way.
   */
  deferNarration?: boolean;
}

export interface CascadeResult extends EnrichResult {
  /** Fragility was judged here; the zones.ts hook must not ask again. */
  fragilityJudged: true;
  /** Zones the text model was asked to look at. */
  escalatedZoneIds: Set<string>;
  /** Escalated zones left for `sv narrate` (only with `deferNarration`). */
  deferredZoneIds: Set<string>;
  /** Zones whose generated names were left for `sv narrate` (only with `deferNarration`). */
  deferredNameZoneIds: Set<string>;
  /**
   * Findings produced by judgments (fragility, undecided merges). They carry
   * their own probability and are not prose, so they bypass the support and
   * paraphrase judgments the narrated findings go through.
   */
  prejudgedFindings: Finding[];
}

/**
 * An escalated zone whose previous match overlaps at least this much and
 * already has insights is not narrated again. Structure hashes cannot carry
 * this decision: the cascade sees zones before pins move files, the
 * previous run stored them after, so the hashes never agree.
 */
const UNCHANGED_ESCALATION_OVERLAP = 0.9;

/** The previous zone this one continues, if their files overlap enough both ways. */
function previousMatch(zone: Zone, previous: Zone[] | undefined): { zone: Zone; overlap: number } | undefined {
  if (!previous) return undefined;
  const files = new Set(zone.files);
  let best: { zone: Zone; overlap: number } | undefined;
  for (const prev of previous) {
    let intersection = 0;
    for (const f of prev.files) if (files.has(f)) intersection++;
    const overlap = Math.min(
      prev.files.length > 0 ? intersection / prev.files.length : 0,
      files.size > 0 ? intersection / files.size : 0,
    );
    if (overlap >= PREVIOUS_NAME_OVERLAP && (!best || overlap > best.overlap)) best = { zone: prev, overlap };
  }
  return best;
}

/**
 * A selected or templated name can coincide across zones ("Tests" for three
 * test directories, the package name for a two-file remainder of a package).
 * The largest zone keeps the name; the others fall back to the algorithmic
 * name, which is unique by construction.
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
  return zones.map((z) => (fallback.has(z.id) ? { ...z, name: algorithmicZoneName(z.id) } : z));
}

function addUsage(total: AnalyzeTokenUsage, calls: number, usage?: { input: number; output: number }): void {
  total.calls += calls;
  total.inputTokens += usage?.input ?? 0;
  total.outputTokens += usage?.output ?? 0;
}

/**
 * Run the cascade over the algorithmic zones.
 *
 * @param zones - Louvain zones, algorithmic ids and names.
 * @param crossings - Pre-enrichment crossings, keyed by the algorithmic ids.
 */
export async function cascadeEnrichment(
  zones: Zone[],
  crossings: ZoneCrossing[],
  inventory: Inventory,
  imports: Imports,
  previousZones?: Zones,
  fileArchetypes?: Map<string, string | null>,
  hints?: string,
  projectProfile?: ProjectProfile,
  options: CascadeOptions = {},
): Promise<CascadeResult> {
  const tokenUsage = emptyAnalyzeTokenUsage();
  const newFindings: Finding[] = [];

  // 1. Structural zones are templated; nothing to judge.
  const inventoryByPath = new Map(inventory.files.map((f) => [f.path, f]));
  const templated: Zone[] = [];
  const candidates: Zone[] = [];
  for (const zone of zones) {
    (isStructuralZone(zone, inventoryByPath) ? templated : candidates).push(
      isStructuralZone(zone, inventoryByPath) ? applyStructuralTemplate(zone, inventoryByPath) : zone,
    );
  }
  if (templated.length > 0) {
    console.log(`  [cascade] ${templated.length} structural zone(s) templated without LLM`);
  }

  // 2. Names by selection, merges by judgment, descriptions from facts.
  //    A zone that continues a previous zone with a chosen (non-algorithmic)
  //    name keeps it — identity preservation would restore it anyway — so
  //    selection runs only for zones that are new or still carry a default.
  const prejudgedFindings: Finding[] = [];
  const inherited = new Map<string, string>();
  const toName: Zone[] = [];
  // A zone still carrying its algorithmic name on exactly the same files as
  // last run already had its generated-name fallback tried; asking the text
  // model again would spend the same calls for the same answer.
  const skipGeneratedNames = new Set<string>();
  for (const zone of candidates) {
    const prev = previousMatch(zone, previousZones?.zones);
    if (prev && prev.zone.name && prev.zone.name !== algorithmicZoneName(prev.zone.id)) {
      inherited.set(zone.id, prev.zone.name);
    } else {
      toName.push(zone);
      if (prev && prev.overlap === 1) skipGeneratedNames.add(zone.id);
    }
  }
  const naming = await nameZonesBySelection(toName, {
    projectDir: projectProfile?.projectDir,
    fileArchetypes,
    crossings,
    skipGeneratedNames,
    deferGeneratedNames: options.deferNarration === true,
    routeLayout: routeLayoutFor(inventory.files.map((f) => f.path)),
  });
  const deferredNameZoneIds = new Set(options.deferNarration ? naming.fallbackZoneIds : []);
  addUsage(tokenUsage, naming.calls, naming.tokenUsage);
  prejudgedFindings.push(...naming.findings);
  if (inherited.size > 0) {
    console.log(`  [cascade] ${inherited.size} zone(s) keep the name chosen in a previous run`);
  }
  const namedZones = [
    ...naming.zones,
    ...candidates.filter((z) => inherited.has(z.id)).map((z) => ({ ...z, name: inherited.get(z.id)! })),
  ];
  // Crossings still carry the algorithmic ids; a merge keeps the lead
  // member's id, so remap the absorbed ids onto it before describing.
  const idMap = new Map<string, string>();
  for (const named of namedZones) {
    for (const original of candidates) {
      if (original.files.some((f) => named.files.includes(f))) idMap.set(original.id, named.id);
    }
  }
  const remapped = crossings.map((c) => ({
    ...c,
    fromZone: idMap.get(c.fromZone) ?? c.fromZone,
    toZone: idMap.get(c.toZone) ?? c.toZone,
  })).filter((c) => c.fromZone !== c.toZone);
  const zonesById = new Map([...namedZones, ...templated].map((z) => [z.id, z]));
  const named: Zone[] = namedZones.map((z) => ({
    ...z,
    description: describeZoneFromFacts(z, { fileArchetypes, crossings: remapped }, zonesById),
  }));

  // 3. Fragility judged once; bands decide what happens next.
  const assessment = await assessZoneFragility(named, remapped);
  addUsage(tokenUsage, assessment.calls, assessment.tokenUsage);
  const fragility = fragilityFindings(named, assessment, CASCADE_PASS);
  prejudgedFindings.push(...fragility);
  const inBand = named
    .map((z) => {
      const probs = assessment.probabilities.get(z.id);
      const ps = probs ? Object.values(probs).filter((p): p is number => p !== undefined) : [];
      const inside = ps.filter((p) => p >= ESCALATION_BAND[0] && p < ESCALATION_BAND[1]);
      return { zone: z, top: inside.length > 0 ? Math.max(...inside) : -1 };
    })
    .filter((e) => e.top >= 0)
    .sort((a, b) => b.top - a.top);
  const escalated = inBand.slice(0, ESCALATION_MAX_ZONES).map((e) => e.zone);
  if (assessment.calls > 0) {
    console.log(
      `  [cascade] fragility: ${named.length} zone(s) judged — ${fragility.length} finding(s), ` +
        `${inBand.length} in the ${ESCALATION_BAND[0]}–${ESCALATION_BAND[1]} band, ${escalated.length} escalated to the text model ` +
        `(${assessment.tokenUsage?.input ?? 0} in / ${assessment.tokenUsage?.output ?? 0} out)`,
    );
  }

  // 4. Escalated zones: the per-zone prompt as a pass-2 call, so names are
  //    preserved and the model adds only insights and findings. Previous
  //    structure hashes and insights ride along so an unchanged escalated
  //    zone is not regenerated.
  const newZoneInsights = new Map<string, string[]>();
  let finalNamed = named;
  const escalatedZoneIds = new Set(escalated.map((z) => z.id));
  // Escalated zones the previous run already narrated on (nearly) the same
  // files keep that narration; only the rest are sent to the text model.
  const carried = new Map<string, Zone>();
  const toNarrate: Zone[] = [];
  for (const z of escalated) {
    const prev = previousMatch(z, previousZones?.zones);
    if (prev && prev.overlap >= UNCHANGED_ESCALATION_OVERLAP && prev.zone.insights && prev.zone.insights.length > 0) {
      carried.set(z.id, prev.zone);
    } else {
      toNarrate.push(z);
    }
  }
  if (carried.size > 0) {
    console.log(`  [cascade] ${carried.size} escalated zone(s) unchanged since the previous run — insights carried forward`);
    finalNamed = finalNamed.map((z) => {
      const prev = carried.get(z.id);
      return prev ? { ...z, insights: prev.insights, structureHash: prev.structureHash, tokenUsage: prev.tokenUsage } : z;
    });
  }
  const deferredZoneIds = new Set<string>();
  if (toNarrate.length > 0 && options.deferNarration) {
    for (const z of toNarrate) deferredZoneIds.add(z.id);
    console.log(`  [cascade] ${toNarrate.length} zone(s) left for background narration`);
  } else if (toNarrate.length > 0) {
    // One call for all of them (enrich-multiplex.ts); the escalated zones are
    // judged together and the CLI spawn floor is paid once.
    const narrated = await narrateZones(toNarrate, {
      allZones: [...named, ...templated],
      crossings: remapped,
      fileArchetypes,
      hints,
      projectProfile,
    });
    addUsage(tokenUsage, narrated.tokenUsage.calls, narrated.tokenUsage);
    newFindings.push(...narrated.newFindings);
    for (const [id, insights] of narrated.newZoneInsights) newZoneInsights.set(id, insights);
    const narratedById = new Map(narrated.zones.map((z) => [z.id, z]));
    finalNamed = finalNamed.map((z) => {
      const n = narratedById.get(z.id);
      // Keep the cascade's name and description; take the narrated insights.
      return n ? { ...z, insights: n.insights, structureHash: n.structureHash } : z;
    });
  }

  return {
    zones: dedupeZoneNames([...finalNamed, ...templated]),
    newZoneInsights,
    newGlobalInsights: [],
    newFindings,
    pass: CASCADE_PASS,
    tokenUsage,
    enrichedZoneIds: new Set(finalNamed.map((z) => z.id)),
    fragilityJudged: true,
    escalatedZoneIds,
    deferredZoneIds,
    deferredNameZoneIds,
    prejudgedFindings,
  };
}
