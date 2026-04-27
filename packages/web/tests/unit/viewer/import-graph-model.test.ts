import { describe, it, expect } from "vitest";
import type { Imports, Zones } from "../../../src/viewer/external.js";
import {
  aggregateDirectedZoneFlows,
  buildFileDegrees,
  collectFilePaths,
  defaultFocusPath,
  defaultFocusPathInZone,
  expandNeighborhood,
  filterEdgesInBall,
  filesInCycles,
  partitionNeighbors,
  restrictBallToZone,
} from "../../../src/viewer/views/import-graph/model.js";

function makeImports(partial: Partial<Imports> & Pick<Imports, "edges">): Imports {
  return {
    external: [],
    summary: {
      totalEdges: partial.edges.length,
      totalExternal: 0,
      circularCount: 0,
      circulars: [],
      mostImported: [],
      avgImportsPerFile: 0,
    },
    ...partial,
  };
}

describe("import-graph model", () => {
  it("defaultFocusPath prefers mostImported hub", () => {
    const imports = makeImports({
      edges: [{ from: "a.ts", to: "b.ts", type: "static", symbols: [] }],
      summary: {
        totalEdges: 1,
        totalExternal: 0,
        circularCount: 0,
        circulars: [],
        mostImported: [{ path: "hub.ts", count: 9 }],
        avgImportsPerFile: 1,
      },
    });
    expect(defaultFocusPath(imports)).toBe("hub.ts");
  });

  it("defaultFocusPath falls back to first cycle member", () => {
    const imports = makeImports({
      edges: [{ from: "x.ts", to: "y.ts", type: "static", symbols: [] }],
      summary: {
        totalEdges: 1,
        totalExternal: 0,
        circularCount: 1,
        circulars: [{ cycle: ["loop.ts", "x.ts"] }],
        mostImported: [],
        avgImportsPerFile: 1,
      },
    });
    expect(defaultFocusPath(imports)).toBe("loop.ts");
  });

  it("expandNeighborhood grows by undirected hops", () => {
    const imports = makeImports({
      edges: [
        { from: "a.ts", to: "b.ts", type: "static", symbols: [] },
        { from: "b.ts", to: "c.ts", type: "static", symbols: [] },
      ],
    });
    expect(expandNeighborhood("b.ts", imports, 0)).toEqual(new Set(["b.ts"]));
    expect(expandNeighborhood("b.ts", imports, 1)).toEqual(new Set(["a.ts", "b.ts", "c.ts"]));
  });

  it("restrictBallToZone keeps center even outside zone", () => {
    const zones: Zones = {
      zones: [
        {
          id: "z1",
          name: "Z1",
          description: "",
          files: ["a.ts"],
          entryPoints: [],
          cohesion: 1,
          coupling: 0,
        },
      ],
      crossings: [],
      unzoned: [],
    };
    const ball = new Set(["center.ts", "a.ts", "far.ts"]);
    const next = restrictBallToZone(ball, "center.ts", "z1", zones);
    expect(next.has("center.ts")).toBe(true);
    expect(next.has("a.ts")).toBe(true);
    expect(next.has("far.ts")).toBe(false);
  });

  it("filterEdgesInBall respects crossZoneOnly and cyclesOnly", () => {
    const zones: Zones = {
      zones: [
        {
          id: "A",
          name: "A",
          description: "",
          files: ["a.ts"],
          entryPoints: [],
          cohesion: 1,
          coupling: 0,
        },
        {
          id: "B",
          name: "B",
          description: "",
          files: ["b.ts", "c.ts"],
          entryPoints: [],
          cohesion: 1,
          coupling: 0,
        },
      ],
      crossings: [],
      unzoned: [],
    };
    const imports = makeImports({
      edges: [
        { from: "a.ts", to: "b.ts", type: "static", symbols: [] },
        { from: "b.ts", to: "c.ts", type: "static", symbols: [] },
      ],
      summary: {
        totalEdges: 2,
        totalExternal: 0,
        circularCount: 1,
        circulars: [{ cycle: ["b.ts", "c.ts"] }],
        mostImported: [],
        avgImportsPerFile: 1,
      },
    });
    const ball = new Set(["a.ts", "b.ts", "c.ts"]);
    const crossOnly = filterEdgesInBall(ball, imports, {
      importTypes: null,
      crossZoneOnly: true,
      cyclesOnly: false,
      zones,
    });
    expect(crossOnly).toHaveLength(1);
    expect(crossOnly[0].from).toBe("a.ts");

    const cycleFiles = filesInCycles(imports);
    expect(cycleFiles.has("b.ts")).toBe(true);

    const cycleOnly = filterEdgesInBall(ball, imports, {
      importTypes: null,
      crossZoneOnly: false,
      cyclesOnly: true,
      zones,
    });
    expect(cycleOnly).toHaveLength(1);
    expect(cycleOnly[0].from).toBe("b.ts");
  });

  it("partitionNeighbors splits predecessors and successors", () => {
    const imports = makeImports({
      edges: [
        { from: "a.ts", to: "mid.ts", type: "static", symbols: [] },
        { from: "mid.ts", to: "b.ts", type: "static", symbols: [] },
      ],
    });
    const ball = new Set(["a.ts", "mid.ts", "b.ts"]);
    const edges = filterEdgesInBall(ball, imports, {
      importTypes: null,
      crossZoneOnly: false,
      cyclesOnly: false,
      zones: null,
    });
    const { predecessors, successors } = partitionNeighbors("mid.ts", ball, edges);
    expect(predecessors).toEqual(["a.ts"]);
    expect(successors).toEqual(["b.ts"]);
  });

  it("collectFilePaths unions edges and inventory", () => {
    const imports = makeImports({
      edges: [{ from: "x.ts", to: "y.ts", type: "static", symbols: [] }],
    });
    const inventory = {
      files: [
        {
          path: "z.ts",
          size: 1,
          language: "TypeScript",
          lineCount: 1,
          hash: "h",
          role: "source" as const,
          category: "c",
        },
      ],
      summary: {
        totalFiles: 1,
        totalLines: 1,
        byLanguage: {},
        byRole: {},
        byCategory: {},
      },
    };
    const paths = collectFilePaths(imports, inventory);
    expect(paths).toContain("x.ts");
    expect(paths).toContain("y.ts");
    expect(paths).toContain("z.ts");
  });

  it("buildFileDegrees counts in and out edges", () => {
    const imports = makeImports({
      edges: [
        { from: "a.ts", to: "b.ts", type: "static", symbols: [] },
        { from: "b.ts", to: "c.ts", type: "static", symbols: [] },
      ],
    });
    const { inDegree, outDegree } = buildFileDegrees(imports);
    expect(outDegree.get("b.ts")).toBe(1);
    expect(inDegree.get("b.ts")).toBe(1);
    expect(outDegree.get("a.ts")).toBe(1);
    expect(inDegree.get("c.ts")).toBe(1);
  });

  it("aggregateDirectedZoneFlows tallies cross-zone imports", () => {
    const zones: Zones = {
      zones: [
        {
          id: "z1",
          name: "Z1",
          description: "",
          files: ["a.ts"],
          entryPoints: [],
          cohesion: 1,
          coupling: 0,
        },
        {
          id: "z2",
          name: "Z2",
          description: "",
          files: ["b.ts", "c.ts"],
          entryPoints: [],
          cohesion: 1,
          coupling: 0,
        },
      ],
      crossings: [],
      unzoned: [],
    };
    const imports = makeImports({
      edges: [
        { from: "a.ts", to: "b.ts", type: "static", symbols: [] },
        { from: "b.ts", to: "c.ts", type: "static", symbols: [] },
      ],
    });
    const flows = aggregateDirectedZoneFlows(imports, zones);
    const z1toz2 = flows.find((f) => f.fromZone === "z1" && f.toZone === "z2");
    expect(z1toz2?.count).toBe(1);
  });

  it("defaultFocusPathInZone prefers hub in zone", () => {
    const zones: Zones = {
      zones: [
        {
          id: "z1",
          name: "Z1",
          description: "",
          files: ["hub.ts", "leaf.ts"],
          entryPoints: [],
          cohesion: 1,
          coupling: 0,
        },
      ],
      crossings: [],
      unzoned: [],
    };
    const imports = makeImports({
      edges: [],
      summary: {
        totalEdges: 0,
        totalExternal: 0,
        circularCount: 0,
        circulars: [],
        mostImported: [{ path: "hub.ts", count: 5 }],
        avgImportsPerFile: 0,
      },
    });
    expect(defaultFocusPathInZone(imports, "z1", zones)).toBe("hub.ts");
  });
});
