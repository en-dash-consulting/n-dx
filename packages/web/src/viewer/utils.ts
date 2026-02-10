import type { Zones } from "../schema/v1.js";
import { ZONE_COLORS } from "./components/constants.js";

/** Get the display color for a zone by its index in the zones array. */
export function getZoneColor(zones: Zones, zoneId: string): string {
  const idx = zones.zones.findIndex((z) => z.id === zoneId);
  return idx >= 0 ? ZONE_COLORS[idx % ZONE_COLORS.length] : "#555";
}

/** Build a map from file path to zone info (id, name, color). */
export function buildFileToZoneMap(
  zones: Zones | null
): Map<string, { id: string; name: string; color: string }> {
  const map = new Map<string, { id: string; name: string; color: string }>();
  if (zones) {
    zones.zones.forEach((z, i) => {
      const color = ZONE_COLORS[i % ZONE_COLORS.length];
      for (const f of z.files) {
        map.set(f, { id: z.id, name: z.name, color });
      }
    });
  }
  return map;
}

/** Classify a 0–1 metric value as good/mid/bad for meter display. */
export function meterClass(value: number, invert: boolean = false): string {
  const v = invert ? 1 - value : value;
  if (v >= 0.7) return "good";
  if (v >= 0.4) return "mid";
  return "bad";
}

/** Build aggregated flow edges from zone crossings for FlowDiagram. */
export function buildFlowEdges(
  crossings: Zones["crossings"]
): Array<{ from: string; to: string; weight: number }> {
  const pairCounts = new Map<string, number>();
  for (const c of crossings) {
    const key = `${c.fromZone}->${c.toZone}`;
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
  }
  return [...pairCounts.entries()].map(([key, weight]) => {
    const [from, to] = key.split("->");
    return { from, to, weight };
  });
}

/** Build flow nodes for FlowDiagram from zones. */
export function buildFlowNodes(
  zones: Zones
): Array<{ id: string; label: string; color: string }> {
  return zones.zones.map((z, i) => ({
    id: z.id,
    label: z.name,
    color: ZONE_COLORS[i % ZONE_COLORS.length],
  }));
}
