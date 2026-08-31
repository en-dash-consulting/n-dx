/**
 * The `sourcevision://zones` MCP resource returned the whole of zones.json,
 * pretty-printed — roughly 80K tokens in a single tool result on a large
 * project. Two costs stacked: indentation, which is billed like any other
 * character, and every zone's full file list, which is per-zone detail rather
 * than the cross-zone map this resource exists to provide.
 *
 * These tests pin both the shrink and what must survive it: a resource that
 * dropped the metrics or the crossings would be small and useless.
 */

import { describe, it, expect } from "vitest";
import { summarizeZonesResource } from "../../../src/cli/mcp.js";
import type { Zones } from "../../../src/schema/v1.js";

function makeZones(zoneCount: number, filesPerZone: number): Zones {
  return {
    zones: Array.from({ length: zoneCount }, (_, z) => ({
      id: `zone-${z}`,
      name: `Zone ${z}`,
      description: `Description of zone ${z}`,
      files: Array.from({ length: filesPerZone }, (_, f) => `src/zone-${z}/file-${f}.ts`),
      entryPoints: [`src/zone-${z}/index.ts`],
      cohesion: 0.8,
      coupling: 0.2,
      insights: ["an insight that is long enough to matter when repeated per zone"],
    })),
    crossings: [{ from: "zone-0", to: "zone-1", count: 3, files: [] }],
    unzoned: ["src/stray.ts", "src/other-stray.ts"],
    insights: ["a cross-zone insight"],
  } as unknown as Zones;
}

describe("summarizeZonesResource", () => {
  it("keeps zone identity and the metrics that make the map useful", () => {
    const summary = summarizeZonesResource(makeZones(2, 3));

    expect(summary.zones).toHaveLength(2);
    expect(summary.zones[0]).toMatchObject({
      id: "zone-0",
      name: "Zone 0",
      cohesion: 0.8,
      coupling: 0.2,
      fileCount: 3,
    });
    expect(summary.zones[0].description).toContain("zone 0");
  });

  it("replaces file lists with a count", () => {
    const summary = summarizeZonesResource(makeZones(1, 50));

    expect(summary.zones[0].fileCount).toBe(50);
    expect(JSON.stringify(summary)).not.toContain("src/zone-0/file-0.ts");
  });

  it("keeps entry points — a handful per zone, and how a reader gets in", () => {
    const summary = summarizeZonesResource(makeZones(1, 50));
    expect(summary.zones[0].entryPoints).toEqual(["src/zone-0/index.ts"]);
  });

  it("keeps crossings, which are the cross-zone relationships", () => {
    const summary = summarizeZonesResource(makeZones(2, 3));
    expect(summary.crossings).toHaveLength(1);
    expect(summary.crossings[0]).toMatchObject({ from: "zone-0", to: "zone-1" });
  });

  it("reduces unzoned files to a count", () => {
    const summary = summarizeZonesResource(makeZones(1, 1));
    expect(summary.unzonedCount).toBe(2);
    expect(JSON.stringify(summary)).not.toContain("src/stray.ts");
  });

  it("names get_zone so a consumer knows where the detail went", () => {
    const summary = summarizeZonesResource(makeZones(1, 1));
    expect(summary.note).toContain("get_zone");
  });

  it("is dramatically smaller than the pretty-printed original", () => {
    const zones = makeZones(30, 200);
    const before = JSON.stringify(zones, null, 2).length;
    const after = JSON.stringify(summarizeZonesResource(zones)).length;

    expect(after).toBeLessThan(before / 10);
  });

  it("emits no pretty-print indentation", () => {
    const serialized = JSON.stringify(summarizeZonesResource(makeZones(3, 5)));
    expect(serialized).not.toContain("\n");
    expect(serialized).not.toContain("  ");
  });

  it("handles absent zone data without throwing", () => {
    for (const input of [null, undefined]) {
      const summary = summarizeZonesResource(input);
      expect(summary.zones).toEqual([]);
      expect(summary.unzonedCount).toBe(0);
    }
  });
});
