import { inward, nodesOf, out, type Node, type Reader } from "./graph.js";

/**
 * n-dx's own zone governance, read off the projection: a production zone with
 * cohesion below 0.5 AND coupling above 0.5 is a dual-fragility zone that
 * needs active governance (CLAUDE.md, "Monorepo-wide zone fragility").
 */
export const FRAGILE_COHESION = 0.5;
export const FRAGILE_COUPLING = 0.5;

export function isFragile(zone: Node): boolean {
  return Number(zone.cohesion) < FRAGILE_COHESION && Number(zone.coupling) > FRAGILE_COUPLING;
}

export function fragileZones(store: Reader): readonly Node[] {
  return nodesOf(store, "zone")
    .filter(isFragile)
    .sort((a, b) => Number(b.coupling) - Number(b.cohesion) - (Number(a.coupling) - Number(a.cohesion)));
}

/** Top-level zones only: those inside no other zone. */
export function topZones(store: Reader): readonly Node[] {
  return nodesOf(store, "zone").filter((z) => out(store, z.id, "under").length === 0);
}

export interface Coverage {
  readonly capabilities: readonly Node[];
  readonly zones: readonly Node[];
  /** capability id → zone ids it is realized in. */
  readonly realized: ReadonlyMap<string, ReadonlySet<string>>;
  /** Capabilities no commit has realized anywhere. */
  readonly unrealized: readonly Node[];
}

export function coverage(store: Reader): Coverage {
  const capabilities = nodesOf(store, "capability");
  const realized = new Map<string, Set<string>>();
  const zoneIds = new Set<string>();
  for (const capability of capabilities) {
    const zones = out(store, capability.id, "realizedIn");
    realized.set(capability.id, new Set(zones.map((z) => z.id)));
    for (const z of zones) zoneIds.add(z.id);
  }
  const zones = nodesOf(store, "zone").filter((z) => zoneIds.has(z.id));
  return {
    capabilities,
    zones,
    realized,
    unrealized: capabilities.filter((c) => (realized.get(c.id)?.size ?? 0) === 0),
  };
}

/** Where a zone's imports go and come from, for the zone page's two lists. */
export function crossings(store: Reader, zoneId: string): { imports: readonly Node[]; importedBy: readonly Node[] } {
  return { imports: out(store, zoneId, "crosses"), importedBy: inward(store, zoneId, "crosses") };
}
