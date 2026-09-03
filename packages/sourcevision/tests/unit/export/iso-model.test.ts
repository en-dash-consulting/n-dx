import { describe, it, expect } from "vitest";
import {
  buildIsoModel,
  assignLayers,
  routeEdge,
  scaleHeight,
  resolveZoneKind,
  asKind,
  ISO_KINDS,
} from "../../../src/export/iso-model.js";
import type {
  IsoFileInput,
  IsoKind,
  IsoModelInput,
  IsoNode,
} from "../../../src/export/iso-model.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

function file(lineCount: number, kind: IsoKind = "support", label?: string): IsoFileInput {
  return { lineCount, kind, label };
}

/** Three zones in a straight chain: api → core → db. */
function chainInput(overrides: Partial<IsoModelInput> = {}): IsoModelInput {
  return {
    zones: [
      {
        id: "api", name: "Api", description: "HTTP surface",
        files: ["src/api/a.ts", "src/api/b.ts"], entryPoints: ["src/api/a.ts"],
        cohesion: 0.8, coupling: 0.2,
      },
      {
        id: "core", name: "Core", description: "Business logic",
        files: ["src/core/c.ts", "src/core/d.ts", "src/core/e.ts"],
        entryPoints: ["src/core/c.ts"], cohesion: 0.7, coupling: 0.3,
      },
      {
        id: "db", name: "Db", description: "Persistence",
        files: ["src/db/f.ts"], entryPoints: ["src/db/f.ts"],
        cohesion: 0.9, coupling: 0.1,
      },
    ],
    crossings: [
      { fromZone: "api", toZone: "core" },
      { fromZone: "api", toZone: "core" },
      { fromZone: "core", toZone: "db" },
    ],
    files: new Map<string, IsoFileInput>([
      ["src/api/a.ts", file(100, "entry")],
      ["src/api/b.ts", file(50, "entry")],
      ["src/core/c.ts", file(400, "logic")],
      ["src/core/d.ts", file(300, "logic")],
      ["src/core/e.ts", file(200, "support")],
      ["src/db/f.ts", file(20, "data")],
    ]),
    external: [],
    findings: [],
    meta: {
      project: "chain", analyzedAt: "2026-01-01T00:00:00.000Z",
      origin: "sourcevision", totalFiles: 6, totalLines: 1070,
    },
    ...overrides,
  };
}

const byId = (nodes: IsoNode[]) => new Map(nodes.map((n) => [n.id, n]));

// ── assignLayers ────────────────────────────────────────────────────────────

describe("assignLayers", () => {
  it("puts a linear chain on successive layers", () => {
    const layers = assignLayers(["a", "b", "c"], [
      { from: "a", to: "b" }, { from: "b", to: "c" },
    ]);
    expect([layers.get("a"), layers.get("b"), layers.get("c")]).toEqual([0, 1, 2]);
  });

  it("uses the longest path, not the shortest", () => {
    const layers = assignLayers(["a", "b", "c", "d"], [
      { from: "a", to: "b" }, { from: "b", to: "c" },
      { from: "c", to: "d" }, { from: "a", to: "d" },
    ]);
    expect(layers.get("d")).toBe(3);
  });

  it("terminates on a cycle and keeps the layer count bounded", () => {
    const layers = assignLayers(["a", "b", "c"], [
      { from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a" },
    ]);
    expect([...layers.values()]).toHaveLength(3);
    expect(Math.max(...layers.values())).toBeLessThan(3);
  });

  it("handles a self-loop without inflating depth", () => {
    expect(assignLayers(["a"], [{ from: "a", to: "a" }]).get("a")).toBe(0);
  });

  it("ignores edges naming unknown nodes", () => {
    expect(assignLayers(["a"], [{ from: "ghost", to: "a" }]).get("a")).toBe(0);
  });

  it("is deterministic regardless of input order", () => {
    const edges = [{ from: "a", to: "c" }, { from: "b", to: "c" }, { from: "c", to: "d" }];
    const first = assignLayers(["a", "b", "c", "d"], edges);
    const second = assignLayers(["d", "c", "b", "a"], edges);
    expect([...first.entries()].sort()).toEqual([...second.entries()].sort());
  });
});

// ── resolveZoneKind ─────────────────────────────────────────────────────────

describe("resolveZoneKind", () => {
  it("counts kinds after mapping, not the single most common label", () => {
    // 20 support vs 12+10 = 22 logic: the zone is mostly business logic even
    // though "support" is the largest single bucket.
    const counts = new Map<IsoKind, number>([["support", 20], ["logic", 22]]);
    expect(resolveZoneKind(counts, 42)).toBe("logic");
  });

  it("lets a test majority win outright", () => {
    const counts = new Map<IsoKind, number>([["tests", 6], ["logic", 4]]);
    expect(resolveZoneKind(counts, 10)).toBe("tests");
  });

  it("does not call a zone tests on a minority of test files", () => {
    const counts = new Map<IsoKind, number>([["tests", 4], ["logic", 6]]);
    expect(resolveZoneKind(counts, 10)).toBe("logic");
  });

  it("falls back to support with no signal", () => {
    expect(resolveZoneKind(new Map(), 0)).toBe("support");
  });

  it("resolves ties deterministically by palette order", () => {
    const counts = new Map<IsoKind, number>([["ui", 3], ["entry", 3]]);
    expect(resolveZoneKind(counts, 6)).toBe("entry");
  });
});

describe("asKind", () => {
  it("passes through known kinds and defaults the rest", () => {
    expect(asKind("logic")).toBe("logic");
    expect(asKind("nonsense")).toBe("support");
    expect(asKind(undefined)).toBe("support");
  });
});

// ── scaleHeight ─────────────────────────────────────────────────────────────

describe("scaleHeight", () => {
  it("maps the largest zone taller than the smallest", () => {
    expect(scaleHeight(10000, 10, 10000)).toBeGreaterThan(scaleHeight(10, 10, 10000));
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

// ── routeEdge ───────────────────────────────────────────────────────────────

describe("routeEdge", () => {
  const node = (over: Partial<IsoNode>): IsoNode => ({
    id: "n", name: "N", kind: "support", col: 0, row: 0, u: 0, v: 0,
    w: 4, d: 4, h: 2, stage: "", sub: "", body: "",
    metrics: { files: 1, lines: 1, cohesion: 0, coupling: 0, riskLevel: "unscored", routes: 0 },
    mix: [], keyFiles: [], insights: [], findings: [], inbound: [], outbound: [],
    ...over,
  });
  const bounds = { uMin: 0, uMax: 40, vMin: 0, vMax: 20 };

  it("crosses the empty gap directly between adjacent layers", () => {
    const a = node({ col: 0, u: 0, v: 0 });
    const b = node({ col: 1, u: 9, v: 0 });
    const points = routeEdge(a, b, bounds, [-1, 5], 0);
    // Same row and adjacent columns: a straight hop, no detour.
    expect(points).toEqual([[4, 2], [9, 2]]);
  });

  it("detours a multi-layer edge into a corridor between rows", () => {
    const a = node({ col: 0, u: 0, v: 0 });
    const b = node({ col: 3, u: 27, v: 6, row: 1 });
    const lane = 5;
    const points = routeEdge(a, b, bounds, [-1, lane], 0);
    // The long horizontal leg must sit in the corridor, not at either box's
    // own v, or it would cut through whatever occupies the middle columns.
    const longLeg = points.find((p, i) => i > 0 && i < points.length - 1 && p[1] === lane);
    expect(longLeg).toBeDefined();
    expect(points[0]).toEqual([4, 2]);
    expect(points[points.length - 1]).toEqual([27, 8]);
  });

  it("sends a back edge below the scene", () => {
    const a = node({ col: 3, u: 27, v: 0 });
    const b = node({ col: 1, u: 9, v: 0 });
    const points = routeEdge(a, b, bounds, [], 0);
    expect(Math.max(...points.map((p) => p[1]))).toBeGreaterThan(bounds.vMax);
  });
});

// ── buildIsoModel ───────────────────────────────────────────────────────────

describe("buildIsoModel", () => {
  it("creates one node per zone, layered by dependency depth", () => {
    const model = buildIsoModel(chainInput());
    const nodes = byId(model.nodes);
    expect([...nodes.keys()].sort()).toEqual(["api", "core", "db"]);
    expect(nodes.get("api")!.col).toBe(0);
    expect(nodes.get("core")!.col).toBe(1);
    expect(nodes.get("db")!.col).toBe(2);
  });

  it("aggregates crossings into weighted zone edges", () => {
    const model = buildIsoModel(chainInput());
    const edge = model.edges.find((e) => e.from === "api" && e.to === "core")!;
    expect(edge.weight).toBe(2);
    expect(edge.back).toBe(false);
    expect(edge.calls).toBe(0);
  });

  it("scales footprint from file count and height from line count", () => {
    const nodes = byId(buildIsoModel(chainInput()).nodes);
    expect(nodes.get("core")!.w).toBeGreaterThanOrEqual(nodes.get("db")!.w);
    expect(nodes.get("core")!.h).toBeGreaterThan(nodes.get("db")!.h);
  });

  it("never overlaps two boxes on the grid", () => {
    const model = buildIsoModel(chainInput());
    for (const a of model.nodes) {
      for (const b of model.nodes) {
        if (a.id === b.id) continue;
        const separated =
          a.u + a.w <= b.u || b.u + b.w <= a.u || a.v + a.d <= b.v || b.v + b.d <= a.v;
        expect(separated).toBe(true);
      }
    }
  });

  it("colours a zone from what its files mostly do", () => {
    const nodes = byId(buildIsoModel(chainInput()).nodes);
    expect(nodes.get("api")!.kind).toBe("entry");
    expect(nodes.get("core")!.kind).toBe("logic");
    expect(nodes.get("db")!.kind).toBe("data");
  });

  it("records inbound and outbound links for the detail panel", () => {
    const core = buildIsoModel(chainInput()).nodes.find((n) => n.id === "core")!;
    expect(core.outbound.map((l) => l.id)).toContain("db");
    expect(core.inbound.map((l) => l.id)).toContain("api");
  });

  it("lists entry points first among key files", () => {
    const core = buildIsoModel(chainInput()).nodes.find((n) => n.id === "core")!;
    expect(core.keyFiles[0].path).toBe("src/core/c.ts");
    expect(new Set(core.keyFiles.map((f) => f.path)).size).toBe(core.keyFiles.length);
    expect(core.keyFiles[0].url).toBeUndefined();
  });

  it("links key files to source when a link base is supplied", () => {
    const model = buildIsoModel(chainInput({ linkBase: "https://example.com/repo/blob/abc/" }));
    const core = model.nodes.find((n) => n.id === "core")!;
    expect(core.keyFiles[0].url).toBe("https://example.com/repo/blob/abc/src/core/c.ts");
  });

  it("routes a back edge below the scene instead of through it", () => {
    const input = chainInput();
    input.crossings.push({ fromZone: "db", toZone: "api" });
    const model = buildIsoModel(input);
    const backEdge = model.edges.find((e) => e.from === "db" && e.to === "api")!;
    expect(backEdge.back).toBe(true);
    expect(Math.max(...backEdge.points.map((p) => p[1]))).toBeGreaterThan(model.bounds.vMax);
  });

  it("caps the scene at maxNodes, keeping the largest zones", () => {
    const model = buildIsoModel(chainInput(), { maxNodes: 2 });
    expect(model.nodes.map((n) => n.id).sort()).toEqual(["api", "core"]);
    expect(model.meta.omittedZones).toEqual(["Db"]);
    expect(model.meta.shownZones).toBe(2);
    expect(model.meta.totalZones).toBe(3);
  });

  it("drops edges whose endpoints were cut by the cap", () => {
    const model = buildIsoModel(chainInput(), { maxNodes: 2 });
    expect(model.edges.every((e) => e.to !== "db" && e.from !== "db")).toBe(true);
  });

  it("adds shared external packages as a leading column", () => {
    const model = buildIsoModel(chainInput({
      external: [
        { package: "zod", importedBy: ["src/api/a.ts", "src/core/c.ts"] },
        { package: "only-one-zone", importedBy: ["src/api/a.ts"] },
      ],
    }));
    const ext = model.nodes.filter((n) => n.kind === "external");
    expect(ext.map((e) => e.name)).toEqual(["zod"]);
    expect(ext[0].col).toBe(0);
    expect(byId(model.nodes).get("api")!.col).toBe(1);
    expect(model.layers[0]).toBe("Dependencies");
  });

  it("omits the external column when disabled", () => {
    const model = buildIsoModel(
      chainInput({ external: [{ package: "zod", importedBy: ["src/api/a.ts", "src/core/c.ts"] }] }),
      { includeExternals: false },
    );
    expect(model.nodes.some((n) => n.kind === "external")).toBe(false);
    expect(byId(model.nodes).get("api")!.col).toBe(0);
  });

  it("counts server routes per zone as entry-point evidence", () => {
    const input = chainInput();
    input.files.set("src/api/a.ts", { lineCount: 100, kind: "entry", routes: 2 });
    const model = buildIsoModel(input);
    expect(byId(model.nodes).get("api")!.metrics.routes).toBe(2);
  });

  // ── call graph overlay ────────────────────────────────────────────────────

  it("attaches call counts to the matching import edge", () => {
    const model = buildIsoModel(chainInput({
      callEdges: [{ fromZone: "api", toZone: "core", weight: 40 }],
    }));
    const edge = model.edges.find((e) => e.from === "api" && e.to === "core")!;
    expect(edge.weight).toBe(2);
    expect(edge.calls).toBe(40);
    expect(model.meta.hasCalls).toBe(true);
  });

  it("surfaces a call-only edge that no import explains", () => {
    // The signature of an injected seam: calls cross the boundary, imports do not.
    const model = buildIsoModel(chainInput({
      callEdges: [{ fromZone: "db", toZone: "api", weight: 12 }],
    }));
    const edge = model.edges.find((e) => e.from === "db" && e.to === "api")!;
    expect(edge.weight).toBe(0);
    expect(edge.calls).toBe(12);
  });

  it("ignores call edges pointing at omitted zones", () => {
    const model = buildIsoModel(
      chainInput({ callEdges: [{ fromZone: "api", toZone: "db", weight: 5 }] }),
      { maxNodes: 2 },
    );
    expect(model.edges.every((e) => e.from !== "db" && e.to !== "db")).toBe(true);
  });

  it("says edges are imports only when there is no call graph", () => {
    const withoutCalls = buildIsoModel(chainInput());
    expect(withoutCalls.meta.hasCalls).toBe(false);
    expect(withoutCalls.meta.gaps.some((g) => g.includes("not runtime data flow"))).toBe(true);

    const withCalls = buildIsoModel(chainInput({
      callEdges: [{ fromZone: "api", toZone: "core", weight: 3 }],
    }));
    expect(withCalls.meta.gaps.some((g) => g.includes("runtime call counts"))).toBe(true);
  });

  it("carries source-specific caveats into the gap list", () => {
    const input = chainInput();
    input.meta.extraGaps = ["Zones were inferred from directory structure"];
    expect(buildIsoModel(input).meta.gaps[0]).toContain("directory structure");
  });

  // ── general invariants ────────────────────────────────────────────────────

  it("produces identical output across repeated builds", () => {
    expect(JSON.stringify(buildIsoModel(chainInput())))
      .toBe(JSON.stringify(buildIsoModel(chainInput())));
  });

  it("survives a project with no zones", () => {
    const model = buildIsoModel(chainInput({ zones: [], crossings: [] }));
    expect(model.nodes).toEqual([]);
    expect(model.edges).toEqual([]);
    expect(model.bounds.uMax).toBeGreaterThan(0);
  });

  it("exposes a legend entry, with a glyph, for every kind a node can take", () => {
    const kinds = new Set(ISO_KINDS.map((k) => k.id));
    for (const meta of ISO_KINDS) expect(meta.glyph.length).toBeGreaterThan(0);
    for (const node of buildIsoModel(chainInput()).nodes) expect(kinds.has(node.kind)).toBe(true);
  });
});
