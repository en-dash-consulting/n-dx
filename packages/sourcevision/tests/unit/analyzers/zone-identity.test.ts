import { describe, it, expect } from "vitest";
import {
  deepestDistinguishingSegment,
  findZoneById,
  idFromStems,
  idsFollowNames,
  isAlgorithmicName,
  reprefixSubZones,
  stemWords,
} from "../../../src/analyzers/zone-identity.js";
import {
  analyzeZones,
  applyZonePins,
  computeZoneStability,
  deriveZoneName,
  preservePreviousZoneIdentity,
  reapplyCascadeLabels,
} from "../../../src/analyzers/zones.js";
import { makeEdge, makeFileEntry, makeImports, makeInventory, makeZone } from "./zones-helpers.js";

describe("isAlgorithmicName", () => {
  it("recognises placeholders from this id or an earlier numbered one", () => {
    expect(isAlgorithmicName("Routes 6", ["routes-6"])).toBe(true);
    expect(isAlgorithmicName("Routes 8", ["routes-6"])).toBe(true);
    expect(isAlgorithmicName("Routes", ["routes-6"])).toBe(true);
    expect(isAlgorithmicName("Routes  Marketing", ["routes-marketing"])).toBe(true);
    expect(isAlgorithmicName("Scrapbook Application", ["routes-11"])).toBe(false);
  });
});

describe("deriveZoneName", () => {
  it("never emits consecutive spaces", () => {
    expect(deriveZoneName("routes--marketing")).toBe("Routes Marketing");
  });
});

describe("reapplyCascadeLabels", () => {
  it("replaces a stale placeholder from an earlier numbered id with the cascade's name", () => {
    const preserved = [makeZone("routes-6", ["a.ts", "b.ts"], { name: "Routes 8" })];
    const cascade = [makeZone("routes", ["a.ts", "b.ts"], { name: "Timer" })];
    expect(reapplyCascadeLabels(preserved, cascade)[0].name).toBe("Timer");
  });

  it("keeps a chosen name", () => {
    const preserved = [makeZone("routes-6", ["a.ts", "b.ts"], { name: "Timer App" })];
    const cascade = [makeZone("routes", ["a.ts", "b.ts"], { name: "Timer" })];
    expect(reapplyCascadeLabels(preserved, cascade)[0].name).toBe("Timer App");
  });
});

describe("idsFollowNames", () => {
  it("gives a numbered zone with a chosen name an id from the name and records the old one", () => {
    const { zones, renamed } = idsFollowNames([makeZone("routes-11", ["a.ts"], { name: "Scrapbook Application" })]);
    expect(zones[0].id).toBe("scrapbook-application");
    expect(zones[0].previousIds).toEqual(["routes-11"]);
    expect(renamed.get("routes-11")).toBe("scrapbook-application");
  });

  it("leaves ids without a numeric suffix and zones with placeholder names alone", () => {
    const { zones, renamed } = idsFollowNames([
      makeZone("timer", ["a.ts"], { name: "Stopwatch" }),
      makeZone("routes-3", ["b.ts"], { name: "Routes 3" }),
    ]);
    expect(zones.map((z) => z.id)).toEqual(["timer", "routes-3"]);
    expect(renamed.size).toBe(0);
  });

  it("re-prefixes sub-zones of a renamed zone", () => {
    const parent = makeZone("routes-11", ["a.ts", "b.ts"], {
      name: "Scrapbook",
      subZones: [makeZone("routes-11/pages", ["a.ts"]), makeZone("routes-11/lib", ["b.ts"])],
      subCrossings: [{ from: "a.ts", to: "b.ts", fromZone: "routes-11/pages", toZone: "routes-11/lib" }],
    });
    const [renamed] = idsFollowNames([parent]).zones;
    expect(renamed.subZones!.map((z) => z.id)).toEqual(["scrapbook/pages", "scrapbook/lib"]);
    expect(renamed.subCrossings![0]).toMatchObject({ fromZone: "scrapbook/pages", toZone: "scrapbook/lib" });
  });
});

describe("previous ids as aliases", () => {
  it("resolve a zone and a pin target", () => {
    const zones = [
      makeZone("scrapbook-application", ["a.ts"], { previousIds: ["routes-11"] }),
      makeZone("other", ["b.ts"]),
    ];
    expect(findZoneById(zones, "routes-11")?.id).toBe("scrapbook-application");
    const pinned = applyZonePins(zones, { "b.ts": "routes-11" });
    expect(pinned.find((z) => z.id === "scrapbook-application")!.files).toContain("b.ts");
  });
});

describe("preservePreviousZoneIdentity", () => {
  it("re-prefixes sub-zones when a zone takes a previous id", () => {
    const current = [makeZone("routes-apps", ["a.ts", "b.ts"], {
      subZones: [makeZone("routes-apps/routes", ["a.ts"]), makeZone("routes-apps/routes/components", ["b.ts"])],
    })];
    const previous = [makeZone("core-application", ["a.ts", "b.ts"], { name: "Core" })];
    const [zone] = preservePreviousZoneIdentity(current, previous);
    expect(zone.id).toBe("core-application");
    expect(zone.subZones!.map((z) => z.id)).toEqual(["core-application/routes", "core-application/routes/components"]);
  });
});

describe("reprefixSubZones", () => {
  it("is a no-op when the id did not change", () => {
    const z = makeZone("a", ["x.ts"], { subZones: [makeZone("a/b", ["x.ts"])] });
    expect(reprefixSubZones(z, "a")).toBe(z);
  });
});

describe("deepestDistinguishingSegment", () => {
  it("walks below a taken container segment to the feature", () => {
    const files = ["app/routes/apps/learn-agentcore/lib/LabApp.tsx", "app/routes/apps/learn-agentcore/lib/chrome.tsx", "app/routes/apps/learn-agentcore/_index.tsx"];
    expect(deepestDistinguishingSegment(files, new Set(["routes"]), new Set(["apps"]))).toBe("learn-agentcore");
  });

  it("returns nothing when every segment is a role, skipped or used", () => {
    expect(deepestDistinguishingSegment(["src/lib/a.ts", "src/lib/b.ts"], new Set(), new Set())).toBeUndefined();
  });
});

describe("filename-derived ids", () => {
  it("split camelCase and strip route syntax", () => {
    expect(stemWords("what.case-studies.$slug")).toEqual(["what", "case", "studies", "slug"]);
    expect(stemWords("_index")).toEqual([]);
    expect(idFromStems(["CosmicCallout", "DashboardGrid"])).toBe("cosmic-callout-dashboard-grid");
    const id = idFromStems(["sandbox._index", "what.case-studies.$slug"])!;
    expect(id).not.toMatch(/[.$_]/);
    expect(id.split("-").length).toBeLessThanOrEqual(4);
  });
});

describe("analyzeZones identity across runs", () => {
  it("keeps a renamed id on the next run over unchanged input", async () => {
    const files = ["src/a/x.ts", "src/a/y.ts", "src/a/z.ts", "src/b/p.ts", "src/b/q.ts", "src/b/r.ts"];
    const inventory = makeInventory(files.map((p) => makeFileEntry(p)));
    const imports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"), makeEdge("src/a/y.ts", "src/a/z.ts"), makeEdge("src/a/x.ts", "src/a/z.ts"),
      makeEdge("src/b/p.ts", "src/b/q.ts"), makeEdge("src/b/q.ts", "src/b/r.ts"), makeEdge("src/b/p.ts", "src/b/r.ts"),
    ]);
    const { zones: first } = await analyzeZones(inventory, imports, { enrich: false });
    const renamed = { ...first, zones: first.zones.map((z) => (z.files.includes("src/a/x.ts") ? { ...z, id: "alpha-app", name: "Alpha App", previousIds: [z.id] } : z)) };
    const { zones: second } = await analyzeZones(inventory, imports, { enrich: false, previousZones: renamed });
    const { zones: third } = await analyzeZones(inventory, imports, { enrich: false, previousZones: second });
    expect(second.zones.find((z) => z.files.includes("src/a/x.ts"))!.id).toBe("alpha-app");
    expect(third.zones.find((z) => z.files.includes("src/a/x.ts"))!.id).toBe("alpha-app");
  });

  it("does not count an id rename as a removed and a new zone in stability", () => {
    const previous = [makeZone("utils-2", ["a.ts", "b.ts"]), makeZone("web", ["c.ts"])];
    const current = [makeZone("core-app", ["a.ts", "b.ts"], { previousIds: ["utils-2"] }), makeZone("web", ["c.ts"])];
    const stability = computeZoneStability(current, previous);
    expect(stability).toMatchObject({ fileRetention: 1, persistedZones: 2, newZones: 0, removedZones: 0 });
    expect(stability.reassignedFiles).toEqual([]);
  });
});
