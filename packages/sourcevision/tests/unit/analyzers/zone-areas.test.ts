import { describe, it, expect } from "vitest";
import { computeAreas, targetAreaCount, isTestZone } from "../../../src/analyzers/zone-areas.js";
import { routeLayoutFor } from "../../../src/analyzers/route-convention.js";
import { validateModule } from "../../../src/schema/index.js";
import { sortZonesData } from "../../../src/util/sort.js";
import type { ZoneCrossing, Zone } from "../../../src/schema/index.js";
import { makeZone } from "./zones-helpers.js";

const files = (dir: string, n: number, ext = "ts") => Array.from({ length: n }, (_, i) => `${dir}/f${i}.${ext}`);
function cross(from: Zone, to: Zone, n: number): ZoneCrossing[] {
  return Array.from({ length: n }, (_, i) => ({ from: from.files[i % from.files.length], to: to.files[i % to.files.length], fromZone: from.id, toZone: to.id }));
}

describe("targetAreaCount", () => {
  it("is clamped to 4..10", () => {
    expect(targetAreaCount(4)).toBe(4);
    expect(targetAreaCount(29)).toBe(7);
    expect(targetAreaCount(200)).toBe(10);
  });
});

describe("computeAreas", () => {
  it("returns nothing below the zone threshold", () => {
    const zones = Array.from({ length: 5 }, (_, i) => makeZone(`z${i}`, files(`src/z${i}`, 3)));
    expect(computeAreas({ zones, crossings: [], testFiles: new Set() })).toEqual([]);
  });

  it("seeds route container children together and puts every zone in exactly one area", () => {
    const apps = ["timer", "scrapbook", "digest"].map((a) => makeZone(a, files(`app/routes/apps/${a}`, 5)));
    const others = Array.from({ length: 8 }, (_, i) => makeZone(`lib${i}`, files(`app/lib${i}`, 6)));
    const zones = [...apps, ...others];
    const crossings = others.slice(1).flatMap((z, i) => cross(z, others[i], 3));
    const layout = routeLayoutFor(zones.flatMap((z) => z.files).concat(["react-router.config.ts", "app/routes/apps/x/_index.tsx"]));
    const areas = computeAreas({ zones, crossings, testFiles: new Set(), routeLayout: layout });
    const appsArea = areas.find((a) => a.zones.includes("timer"))!;
    expect(appsArea.zones).toEqual(expect.arrayContaining(["timer", "scrapbook", "digest"]));
    expect(appsArea.nameSource).toBe("route");
    const all = areas.flatMap((a) => a.zones);
    expect(all.sort()).toEqual(zones.map((z) => z.id).sort());
    expect(new Set(all).size).toBe(all.length);
  });

  it("keeps monorepo packages apart", () => {
    const zones = ["rex", "hench", "web"].flatMap((p) => [0, 1, 2].map((i) => makeZone(`${p}-${i}`, files(`packages/${p}/src/m${i}`, 4))));
    const crossings = cross(zones[0], zones[3], 20);
    const areas = computeAreas({ zones, crossings, testFiles: new Set() });
    expect(areas.map((a) => a.name).sort()).toEqual(["Hench", "Rex", "Web"]);
    expect(areas.every((a) => a.nameSource === "package")).toBe(true);
  });

  it("sends a test zone to the area it mostly imports, and a spread one to a tests area", () => {
    const prod = Array.from({ length: 8 }, (_, i) => makeZone(`p${i}`, files(`src/p${i}`, 5)));
    const focused = makeZone("tests-p0", files("src/p0/__tests__", 3, "test.ts"));
    const spread = makeZone("tests-e2e", files("e2e", 4, "test.ts"));
    const testFiles = new Set([...focused.files, ...spread.files]);
    // Four production clusters (pairs), so there are four areas to spread over.
    const crossings = [
      ...[0, 2, 4, 6].flatMap((i) => cross(prod[i], prod[i + 1], 8)),
      ...cross(focused, prod[0], 6),
      ...[0, 2, 4, 6].flatMap((i) => cross(spread, prod[i], 2)),
    ];
    const areas = computeAreas({ zones: [...prod, focused, spread], crossings, testFiles });
    const home = areas.find((a) => a.zones.includes("tests-p0"))!;
    expect(home.zones).toContain("p0");
    expect(areas.find((a) => a.zones.includes("tests-e2e"))!.name).toBe("Tests");
    expect(isTestZone(focused, testFiles)).toBe(true);
  });

  it("does not snowball one area over most of the project", () => {
    // A chain of 16 zones each linked to the next.
    const zones = Array.from({ length: 16 }, (_, i) => makeZone(`c${i}`, files(`src/c${i}`, 10)));
    const crossings = zones.slice(1).flatMap((z, i) => cross(z, zones[i], 5));
    const areas = computeAreas({ zones, crossings, testFiles: new Set() });
    const largest = Math.max(...areas.map((a) => a.files));
    expect(largest / 160).toBeLessThanOrEqual(0.4);
  });

  it("round-trips through validation and sorting", () => {
    const zones = Array.from({ length: 9 }, (_, i) => makeZone(`z${i}`, files(`src/z${i}`, 3)));
    const crossings = zones.slice(1).flatMap((z, i) => cross(z, zones[i], 2));
    const areas = computeAreas({ zones, crossings, testFiles: new Set() });
    const data = sortZonesData({ zones, crossings, unzoned: [], areas });
    expect(data.areas).toEqual(areas);
    expect(validateModule("zones", data).ok).toBe(true);
  });
});
