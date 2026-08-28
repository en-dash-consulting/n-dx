import { describe, it, expect } from "vitest";
import {
  buildIsoModel,
  assignLayers,
  scaleHeight,
  ISO_KINDS,
} from "../../../src/export/iso-model.js";
import type {
  Classifications,
  Components,
  Imports,
  Inventory,
  Manifest,
  Zones,
} from "../../../src/schema/index.js";

// ── Fixture helpers ─────────────────────────────────────────────────────────

function makeManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    schemaVersion: "1.0.0",
    toolVersion: "0.0.0-test",
    analyzedAt: "2026-01-01T00:00:00.000Z",
    targetPath: "/tmp/project",
    modules: {},
    ...overrides,
  };
}

function makeInventory(files: Array<{ path: string; lineCount: number }>): Inventory {
  return {
    files: files.map((f) => ({
      path: f.path,
      size: f.lineCount * 30,
      language: "TypeScript",
      lineCount: f.lineCount,
      hash: "h",
      role: "source" as const,
      category: "core",
    })),
    summary: {
      totalFiles: files.length,
      totalLines: files.reduce((sum, f) => sum + f.lineCount, 0),
      byLanguage: { TypeScript: files.length },
      byRole: { source: files.length },
      byCategory: { core: files.length },
    },
  };
}

function makeImports(external: Imports["external"] = []): Imports {
  return {
    edges: [],
    external,
    summary: {
      totalEdges: 0,
      totalExternal: external.length,
      circularCount: 0,
      circulars: [],
      mostImported: [],
      avgImportsPerFile: 0,
    },
  };
}

/** Three zones in a straight chain: api → core → db. */
function makeChainZones(): Zones {
  return {
    zones: [
      {
        id: "api",
        name: "Api",
        description: "HTTP surface",
        files: ["src/api/a.ts", "src/api/b.ts"],
        entryPoints: ["src/api/a.ts"],
        cohesion: 0.8,
        coupling: 0.2,
      },
      {
        id: "core",
        name: "Core",
        description: "Business logic",
        files: ["src/core/c.ts", "src/core/d.ts", "src/core/e.ts"],
        entryPoints: ["src/core/c.ts"],
        cohesion: 0.7,
        coupling: 0.3,
      },
      {
        id: "db",
        name: "Db",
        description: "Persistence",
        files: ["src/db/f.ts"],
        entryPoints: ["src/db/f.ts"],
        cohesion: 0.9,
        coupling: 0.1,
      },
    ],
    crossings: [
      { from: "src/api/a.ts", to: "src/core/c.ts", fromZone: "api", toZone: "core" },
      { from: "src/api/b.ts", to: "src/core/d.ts", fromZone: "api", toZone: "core" },
      { from: "src/core/c.ts", to: "src/db/f.ts", fromZone: "core", toZone: "db" },
    ],
    unzoned: [],
  };
}

function makeChainInput() {
  return {
    manifest: makeManifest(),
    zones: makeChainZones(),
    inventory: makeInventory([
      { path: "src/api/a.ts", lineCount: 100 },
      { path: "src/api/b.ts", lineCount: 50 },
      { path: "src/core/c.ts", lineCount: 400 },
      { path: "src/core/d.ts", lineCount: 300 },
      { path: "src/core/e.ts", lineCount: 200 },
      { path: "src/db/f.ts", lineCount: 20 },
    ]),
    imports: makeImports(),
    projectName: "chain",
  };
}

// ── assignLayers ────────────────────────────────────────────────────────────

describe("assignLayers", () => {
  it("puts a linear chain on successive layers", () => {
    const layers = assignLayers(
      ["a", "b", "c"],
      [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    );
    expect(layers.get("a")).toBe(0);
    expect(layers.get("b")).toBe(1);
    expect(layers.get("c")).toBe(2);
  });

  it("uses the longest path, not the shortest", () => {
    // a→b→c→d plus a shortcut a→d: d must sit past c, not next to b.
    const layers = assignLayers(
      ["a", "b", "c", "d"],
      [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "d" },
        { from: "a", to: "d" },
      ],
    );
    expect(layers.get("d")).toBe(3);
  });

  it("terminates on a cycle and keeps the layer count bounded", () => {
    const layers = assignLayers(
      ["a", "b", "c"],
      [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "a" },
      ],
    );
    const values = [...layers.values()];
    expect(values).toHaveLength(3);
    expect(Math.max(...values)).toBeLessThan(3);
  });

  it("handles a self-loop without inflating depth", () => {
    const layers = assignLayers(["a"], [{ from: "a", to: "a" }]);
    expect(layers.get("a")).toBe(0);
  });

  it("ignores edges naming unknown nodes", () => {
    const layers = assignLayers(["a"], [{ from: "ghost", to: "a" }]);
    expect(layers.get("a")).toBe(0);
  });

  it("is deterministic across repeated runs", () => {
    const edges = [
      { from: "a", to: "c" },
      { from: "b", to: "c" },
      { from: "c", to: "d" },
    ];
    const first = assignLayers(["a", "b", "c", "d"], edges);
    const second = assignLayers(["d", "c", "b", "a"], edges);
    expect([...first.entries()].sort()).toEqual([...second.entries()].sort());
  });
});

// ── scaleHeight ─────────────────────────────────────────────────────────────

describe("scaleHeight", () => {
  it("maps the largest zone taller than the smallest", () => {
    const low = scaleHeight(10, 10, 10000);
    const high = scaleHeight(10000, 10, 10000);
    expect(high).toBeGreaterThan(low);
  });

  it("returns a mid height when every zone is the same size", () => {
    const h = scaleHeight(500, 500, 500);
    expect(h).toBeGreaterThan(1.2);
    expect(h).toBeLessThan(6.5);
  });

  it("stays within the extrusion bounds for extreme inputs", () => {
    for (const lines of [0, 1, 1_000_000]) {
      const h = scaleHeight(lines, 10, 10000);
      expect(h).toBeGreaterThanOrEqual(1.2);
      expect(h).toBeLessThanOrEqual(6.5);
    }
  });
});

// ── buildIsoModel ───────────────────────────────────────────────────────────

describe("buildIsoModel", () => {
  it("creates one node per zone, layered by dependency depth", () => {
    const model = buildIsoModel(makeChainInput());
    expect(model.nodes.map((n) => n.id).sort()).toEqual(["api", "core", "db"]);

    const byId = new Map(model.nodes.map((n) => [n.id, n]));
    expect(byId.get("api")!.col).toBe(0);
    expect(byId.get("core")!.col).toBe(1);
    expect(byId.get("db")!.col).toBe(2);
  });

  it("aggregates crossings into weighted zone edges", () => {
    const model = buildIsoModel(makeChainInput());
    const apiToCore = model.edges.find((e) => e.from === "api" && e.to === "core");
    expect(apiToCore).toBeDefined();
    expect(apiToCore!.weight).toBe(2);
    expect(apiToCore!.back).toBe(false);
  });

  it("scales footprint from file count and height from line count", () => {
    const model = buildIsoModel(makeChainInput());
    const byId = new Map(model.nodes.map((n) => [n.id, n]));
    // core has the most files and the most lines of the three.
    expect(byId.get("core")!.w).toBeGreaterThanOrEqual(byId.get("db")!.w);
    expect(byId.get("core")!.h).toBeGreaterThan(byId.get("db")!.h);
  });

  it("never overlaps two boxes on the grid", () => {
    const model = buildIsoModel(makeChainInput());
    for (const a of model.nodes) {
      for (const b of model.nodes) {
        if (a.id === b.id) continue;
        const separated =
          a.u + a.w <= b.u || b.u + b.w <= a.u || a.v + a.d <= b.v || b.v + b.d <= a.v;
        expect(separated).toBe(true);
      }
    }
  });

  it("colours nodes by their dominant archetype", () => {
    const classifications: Classifications = {
      archetypes: [],
      files: [
        { path: "src/api/a.ts", archetype: "route-handler", confidence: 1, source: "algorithmic" },
        { path: "src/api/b.ts", archetype: "route-handler", confidence: 1, source: "algorithmic" },
        { path: "src/core/c.ts", archetype: "service", confidence: 1, source: "algorithmic" },
        { path: "src/core/d.ts", archetype: "service", confidence: 1, source: "algorithmic" },
        { path: "src/core/e.ts", archetype: "utility", confidence: 1, source: "algorithmic" },
        { path: "src/db/f.ts", archetype: "store", confidence: 1, source: "algorithmic" },
      ],
      summary: {
        totalClassified: 6,
        totalUnclassified: 0,
        byArchetype: {},
        bySource: {},
      },
    };
    const model = buildIsoModel({ ...makeChainInput(), classifications });
    const byId = new Map(model.nodes.map((n) => [n.id, n]));
    expect(byId.get("api")!.kind).toBe("entry");
    expect(byId.get("core")!.kind).toBe("logic");
    expect(byId.get("db")!.kind).toBe("data");
  });

  it("falls back to the support kind when classifications are absent", () => {
    const model = buildIsoModel(makeChainInput());
    expect(model.nodes.every((n) => n.kind === "support")).toBe(true);
    expect(model.meta.gaps.some((g) => g.includes("classifications.json"))).toBe(true);
  });

  it("records inbound and outbound links for the detail panel", () => {
    const model = buildIsoModel(makeChainInput());
    const core = model.nodes.find((n) => n.id === "core")!;
    expect(core.outbound.map((l) => l.id)).toContain("db");
    expect(core.inbound.map((l) => l.id)).toContain("api");
  });

  it("lists entry points first among key files", () => {
    const model = buildIsoModel(makeChainInput());
    const core = model.nodes.find((n) => n.id === "core")!;
    expect(core.keyFiles[0]).toBe("src/core/c.ts");
    expect(new Set(core.keyFiles).size).toBe(core.keyFiles.length);
  });

  it("routes a back edge below the scene instead of through it", () => {
    const zones = makeChainZones();
    zones.crossings.push({
      from: "src/db/f.ts",
      to: "src/api/a.ts",
      fromZone: "db",
      toZone: "api",
    });
    const model = buildIsoModel({ ...makeChainInput(), zones });
    const backEdge = model.edges.find((e) => e.from === "db" && e.to === "api")!;
    expect(backEdge.back).toBe(true);
    const laneV = Math.max(...backEdge.points.map((p) => p[1]));
    expect(laneV).toBeGreaterThan(model.bounds.vMax);
  });

  it("excludes detection artifacts from the scene", () => {
    const zones = makeChainZones();
    zones.zones.push({
      id: "noise",
      name: "Noise",
      description: "residual",
      files: ["src/x/y.ts"],
      entryPoints: [],
      cohesion: 0.1,
      coupling: 0.9,
      detectionQuality: "artifact",
    });
    const model = buildIsoModel({ ...makeChainInput(), zones });
    expect(model.nodes.map((n) => n.id)).not.toContain("noise");
  });

  it("caps the scene at maxNodes, keeping the largest zones", () => {
    const model = buildIsoModel(makeChainInput(), { maxNodes: 2 });
    expect(model.nodes).toHaveLength(2);
    expect(model.nodes.map((n) => n.id).sort()).toEqual(["api", "core"]);
    expect(model.meta.omittedZones).toEqual(["Db"]);
    expect(model.meta.shownZones).toBe(2);
    expect(model.meta.totalZones).toBe(3);
  });

  it("drops edges whose endpoints were cut by the cap", () => {
    const model = buildIsoModel(makeChainInput(), { maxNodes: 2 });
    expect(model.edges.every((e) => e.to !== "db" && e.from !== "db")).toBe(true);
  });

  it("adds shared external packages as a leading column", () => {
    const imports = makeImports([
      {
        package: "zod",
        importedBy: ["src/api/a.ts", "src/core/c.ts"],
        symbols: ["z"],
      },
      {
        package: "only-one-zone",
        importedBy: ["src/api/a.ts"],
        symbols: ["x"],
      },
    ]);
    const model = buildIsoModel({ ...makeChainInput(), imports });
    const ext = model.nodes.filter((n) => n.kind === "external");
    expect(ext).toHaveLength(1);
    expect(ext[0].name).toBe("zod");
    expect(ext[0].col).toBe(0);
    // Zones shift right to make room for the dependency column.
    expect(model.nodes.find((n) => n.id === "api")!.col).toBe(1);
    expect(model.layers[0]).toBe("Dependencies");
  });

  it("omits the external column when disabled", () => {
    const imports = makeImports([
      { package: "zod", importedBy: ["src/api/a.ts", "src/core/c.ts"], symbols: ["z"] },
    ]);
    const model = buildIsoModel(
      { ...makeChainInput(), imports },
      { includeExternals: false },
    );
    expect(model.nodes.some((n) => n.kind === "external")).toBe(false);
    expect(model.nodes.find((n) => n.id === "api")!.col).toBe(0);
  });

  it("counts server routes per zone as entry-point evidence", () => {
    const components = {
      components: [],
      usageEdges: [],
      routeModules: [],
      routeTree: [],
      serverRoutes: [
        {
          file: "src/api/a.ts",
          prefix: "/api/",
          handler: "handle",
          routes: [
            { file: "src/api/a.ts", method: "GET" as const, path: "/api/x" },
            { file: "src/api/a.ts", method: "POST" as const, path: "/api/y" },
          ],
        },
      ],
      summary: {
        totalComponents: 0,
        totalRouteModules: 0,
        totalUsageEdges: 0,
        totalServerRoutes: 2,
        routeConventions: {},
        mostUsedComponents: [],
      },
    } as unknown as Components;
    const model = buildIsoModel({ ...makeChainInput(), components });
    expect(model.nodes.find((n) => n.id === "api")!.metrics.routes).toBe(2);
    expect(model.meta.gaps.some((g) => g.includes("server routes"))).toBe(false);
  });

  it("always states that edges are imports rather than runtime flow", () => {
    const model = buildIsoModel(makeChainInput());
    expect(model.meta.gaps.some((g) => g.includes("runtime data flow"))).toBe(true);
  });

  it("produces identical output across repeated builds", () => {
    const a = buildIsoModel(makeChainInput());
    const b = buildIsoModel(makeChainInput());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("survives a project with no zones", () => {
    const model = buildIsoModel({
      ...makeChainInput(),
      zones: { zones: [], crossings: [], unzoned: [] },
    });
    expect(model.nodes).toEqual([]);
    expect(model.edges).toEqual([]);
    expect(model.bounds.uMax).toBeGreaterThan(0);
  });

  it("exposes a legend entry for every kind a node can take", () => {
    const kinds = new Set(ISO_KINDS.map((k) => k.id));
    const model = buildIsoModel(makeChainInput());
    for (const node of model.nodes) expect(kinds.has(node.kind)).toBe(true);
  });
});
