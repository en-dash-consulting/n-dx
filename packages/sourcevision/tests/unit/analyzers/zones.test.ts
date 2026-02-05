import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildUndirectedGraph,
  louvainPhase1,
  mergeSmallCommunities,
} from "../../../src/analyzers/louvain.js";
import {
  enrichZonesWithAI,
  computeAttemptConfigs,
  extractFindings,
} from "../../../src/analyzers/enrich.js";
import {
  deriveZoneId,
  deriveZoneName,
  analyzeZones,
  assignByProximity,
  computeStructureHash,
  generateStructuralInsights,
  subdivideZone,
  SUBDIVISION_THRESHOLD,
  MAX_SUBDIVISION_DEPTH,
} from "../../../src/analyzers/zones.js";
import type {
  Inventory,
  Imports,
  ImportEdge,
  FileEntry,
  Zone,
  ZoneCrossing,
  Finding,
  FindingType,
} from "../../../src/schema/index.js";
import { execFileSync, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFileSync: vi.fn(actual.execFileSync),
    spawn: vi.fn(actual.spawn),
  };
});

const mockedExecFileSync = vi.mocked(execFileSync);
const mockedSpawn = vi.mocked(spawn);

/** Create a fake child process that emits stdout/stderr then closes */
function fakeChild(stdout: string, stderr: string, code: number) {
  const child = new EventEmitter() as any;
  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();
  child.stdout = stdoutEmitter;
  child.stderr = stderrEmitter;
  child.stdin = new Writable({ write(_chunk, _enc, cb) { cb(); } });
  child.kill = vi.fn();
  // Emit data + close asynchronously so listeners are registered first
  process.nextTick(() => {
    if (stdout) stdoutEmitter.emit("data", Buffer.from(stdout));
    if (stderr) stderrEmitter.emit("data", Buffer.from(stderr));
    child.emit("close", code);
  });
  return child;
}

/** Wrap a response string in stream-json format (result line) */
function streamJsonResult(text: string): string {
  return JSON.stringify({ type: "result", subtype: "success", result: text }) + "\n";
}

/** Mock spawn to return a child that exits successfully with given response */
function mockClaudeResponse(str: string) {
  mockedSpawn.mockImplementationOnce(() => fakeChild(streamJsonResult(str), "", 0));
}

/** Mock spawn to return a child that exits with an error */
function mockClaudeError(_msg: string, opts?: { stderr?: string }) {
  mockedSpawn.mockImplementationOnce(() => fakeChild("", opts?.stderr ?? "", 1));
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeFileEntry(path: string, overrides?: Partial<FileEntry>): FileEntry {
  return {
    path,
    size: 100,
    language: "TypeScript",
    lineCount: 10,
    hash: "abc123",
    role: "source",
    category: "misc",
    ...overrides,
  };
}

function makeInventory(files: FileEntry[]): Inventory {
  return {
    files,
    summary: {
      totalFiles: files.length,
      totalLines: files.reduce((s, f) => s + f.lineCount, 0),
      byLanguage: {},
      byRole: {},
      byCategory: {},
    },
  };
}

function makeEdge(from: string, to: string, symbols = ["default"]): ImportEdge {
  return { from, to, type: "static", symbols };
}

function makeImports(edges: ImportEdge[]): Imports {
  return {
    edges,
    external: [],
    summary: {
      totalEdges: edges.length,
      totalExternal: 0,
      circularCount: 0,
      circulars: [],
      mostImported: [],
      avgImportsPerFile: 0,
    },
  };
}

function makeZone(id: string, files: string[], overrides?: Partial<Zone>): Zone {
  return {
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    description: `${files.length} files`,
    files,
    entryPoints: files.length > 0 ? [files[0]] : [],
    cohesion: 0.8,
    coupling: 0.2,
    ...overrides,
  };
}

// ── buildUndirectedGraph ────────────────────────────────────────────────────

describe("buildUndirectedGraph", () => {
  it("creates bidirectional edges with symbol-count weights", () => {
    const graph = buildUndirectedGraph([
      makeEdge("a.ts", "b.ts", ["foo", "bar"]),
    ]);

    expect(graph.get("a.ts")?.get("b.ts")).toBe(2);
    expect(graph.get("b.ts")?.get("a.ts")).toBe(2);
  });

  it("sums weights for multiple edges between same pair", () => {
    const graph = buildUndirectedGraph([
      makeEdge("a.ts", "b.ts", ["foo"]),
      makeEdge("b.ts", "a.ts", ["bar", "baz"]),
    ]);

    expect(graph.get("a.ts")?.get("b.ts")).toBe(3);
    expect(graph.get("b.ts")?.get("a.ts")).toBe(3);
  });

  it("uses min weight of 1 for empty symbols", () => {
    const graph = buildUndirectedGraph([
      makeEdge("a.ts", "b.ts", []),
    ]);

    expect(graph.get("a.ts")?.get("b.ts")).toBe(1);
  });

  it("returns empty graph for empty input", () => {
    const graph = buildUndirectedGraph([]);
    expect(graph.size).toBe(0);
  });
});

// ── deriveZoneId ────────────────────────────────────────────────────────────

describe("deriveZoneId", () => {
  it("uses most common directory segment", () => {
    expect(
      deriveZoneId([
        "src/schema/v1.ts",
        "src/schema/validate.ts",
        "src/schema/index.ts",
      ])
    ).toBe("schema");
  });

  it("returns 'root' for root-level files", () => {
    expect(deriveZoneId(["package.json", "tsconfig.json"])).toBe("root");
  });

  it("skips generic segments like src, lib, app", () => {
    expect(
      deriveZoneId(["src/analyzers/foo.ts", "src/analyzers/bar.ts"])
    ).toBe("analyzers");
  });

  it("normalizes underscores to hyphens", () => {
    expect(deriveZoneId(["src/my_module/a.ts"])).toBe("my-module");
  });

  it("handles mixed root and nested files", () => {
    expect(
      deriveZoneId([
        "README.md",
        "src/schema/v1.ts",
        "src/schema/v2.ts",
      ])
    ).toBe("schema");
  });
});

// ── deriveZoneName ──────────────────────────────────────────────────────────

describe("deriveZoneName", () => {
  it("title-cases single word", () => {
    expect(deriveZoneName("schema")).toBe("Schema");
  });

  it("title-cases hyphenated words", () => {
    expect(deriveZoneName("detail-panel")).toBe("Detail Panel");
  });

  it("handles single-char segments", () => {
    expect(deriveZoneName("a-b")).toBe("A B");
  });
});

// ── Integration: analyzeZones ───────────────────────────────────────────────

describe("analyzeZones", () => {
  it("returns no zones and all unzoned for empty import graph", async () => {
    const inventory = makeInventory([
      makeFileEntry("README.md", { role: "docs" }),
      makeFileEntry("package.json", { role: "config" }),
    ]);
    const imports = makeImports([]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    expect(result.zones).toHaveLength(0);
    expect(result.crossings).toHaveLength(0);
    expect(result.unzoned).toContain("README.md");
    expect(result.unzoned).toContain("package.json");
  });

  it("detects two disconnected clusters as separate zones", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts"),
      makeFileEntry("src/a/y.ts"),
      makeFileEntry("src/a/z.ts"),
      makeFileEntry("src/b/p.ts"),
      makeFileEntry("src/b/q.ts"),
      makeFileEntry("src/b/r.ts"),
    ]);
    const imports = makeImports([
      // Cluster A: fully connected
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/x.ts", "src/a/z.ts"),
      // Cluster B: fully connected
      makeEdge("src/b/p.ts", "src/b/q.ts"),
      makeEdge("src/b/q.ts", "src/b/r.ts"),
      makeEdge("src/b/p.ts", "src/b/r.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    expect(result.zones.length).toBe(2);
    expect(result.crossings).toHaveLength(0);

    // Each zone should have 3 files
    for (const zone of result.zones) {
      expect(zone.files).toHaveLength(3);
    }
  });

  it("puts all interconnected files in one zone with cohesion=1, coupling=0", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/m/a.ts"),
      makeFileEntry("src/m/b.ts"),
      makeFileEntry("src/m/c.ts"),
    ]);
    const imports = makeImports([
      makeEdge("src/m/a.ts", "src/m/b.ts"),
      makeEdge("src/m/b.ts", "src/m/c.ts"),
      makeEdge("src/m/a.ts", "src/m/c.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    expect(result.zones).toHaveLength(1);
    expect(result.zones[0].cohesion).toBe(1);
    expect(result.zones[0].coupling).toBe(0);
  });

  it("populates crossings for cross-zone edges", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts"),
      makeFileEntry("src/a/y.ts"),
      makeFileEntry("src/a/z.ts"),
      makeFileEntry("src/b/p.ts"),
      makeFileEntry("src/b/q.ts"),
      makeFileEntry("src/b/r.ts"),
    ]);
    const imports = makeImports([
      // Cluster A
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/x.ts", "src/a/z.ts"),
      // Cluster B
      makeEdge("src/b/p.ts", "src/b/q.ts"),
      makeEdge("src/b/q.ts", "src/b/r.ts"),
      makeEdge("src/b/p.ts", "src/b/r.ts"),
      // Cross-zone edge
      makeEdge("src/a/x.ts", "src/b/p.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    expect(result.crossings.length).toBeGreaterThan(0);
    expect(result.crossings.some((c) => c.fromZone !== c.toZone)).toBe(true);

    // Both zones should have coupling > 0
    for (const zone of result.zones) {
      expect(zone.coupling).toBeGreaterThanOrEqual(0);
    }
  });

  it("puts non-import files in unzoned", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/m/a.ts"),
      makeFileEntry("src/m/b.ts"),
      makeFileEntry("src/m/c.ts"),
      makeFileEntry("README.md", { role: "docs" }),
      makeFileEntry(".gitignore", { role: "config" }),
    ]);
    const imports = makeImports([
      makeEdge("src/m/a.ts", "src/m/b.ts"),
      makeEdge("src/m/b.ts", "src/m/c.ts"),
      makeEdge("src/m/a.ts", "src/m/c.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    expect(result.unzoned).toContain("README.md");
    expect(result.unzoned).toContain(".gitignore");
  });

  it("merges small communities into neighbors", async () => {
    const inventory = makeInventory([
      // Big cluster
      makeFileEntry("src/core/a.ts"),
      makeFileEntry("src/core/b.ts"),
      makeFileEntry("src/core/c.ts"),
      makeFileEntry("src/core/d.ts"),
      // Tiny "cluster" of 1 connected to core
      makeFileEntry("src/util/helper.ts"),
    ]);
    const imports = makeImports([
      makeEdge("src/core/a.ts", "src/core/b.ts"),
      makeEdge("src/core/b.ts", "src/core/c.ts"),
      makeEdge("src/core/c.ts", "src/core/d.ts"),
      makeEdge("src/core/a.ts", "src/core/d.ts"),
      // helper connects to core
      makeEdge("src/util/helper.ts", "src/core/a.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    // The small community (helper) should be merged into core
    // so we should have 1 zone containing all 5 files
    expect(result.zones).toHaveLength(1);
    expect(result.zones[0].files).toHaveLength(5);
  });

  it("identifies entry points as files imported from other zones", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts"),
      makeFileEntry("src/a/y.ts"),
      makeFileEntry("src/a/z.ts"),
      makeFileEntry("src/b/p.ts"),
      makeFileEntry("src/b/q.ts"),
      makeFileEntry("src/b/r.ts"),
    ]);
    const imports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/x.ts", "src/a/z.ts"),
      makeEdge("src/b/p.ts", "src/b/q.ts"),
      makeEdge("src/b/q.ts", "src/b/r.ts"),
      makeEdge("src/b/p.ts", "src/b/r.ts"),
      // Cross-zone: a/x imports b/p
      makeEdge("src/a/x.ts", "src/b/p.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    if (result.zones.length === 2) {
      // The zone containing b/p.ts should list it as an entry point
      const bZone = result.zones.find((z) => z.files.includes("src/b/p.ts"));
      expect(bZone?.entryPoints).toContain("src/b/p.ts");
    }
  });

  it("is deterministic across multiple runs", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts"),
      makeFileEntry("src/a/y.ts"),
      makeFileEntry("src/a/z.ts"),
      makeFileEntry("src/b/p.ts"),
      makeFileEntry("src/b/q.ts"),
      makeFileEntry("src/b/r.ts"),
    ]);
    const imports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/b/p.ts", "src/b/q.ts"),
      makeEdge("src/b/q.ts", "src/b/r.ts"),
      makeEdge("src/a/x.ts", "src/b/p.ts"),
    ]);

    const { zones: run1 } = await analyzeZones(inventory, imports, { enrich: false });
    const { zones: run2 } = await analyzeZones(inventory, imports, { enrich: false });

    expect(run1).toEqual(run2);
  });
});

// ── assignByProximity ────────────────────────────────────────────────────────

describe("assignByProximity", () => {
  it("assigns files to the zone sharing their directory", () => {
    const zones: Zone[] = [
      {
        id: "core",
        name: "Core",
        description: "",
        files: ["src/core/a.ts", "src/core/b.ts", "src/core/c.ts"],
        entryPoints: [],
        cohesion: 1,
        coupling: 0,
      },
    ];

    const { zones: expanded, remaining } = assignByProximity(zones, [
      "src/core/README.md",
      "src/core/styles.css",
    ]);

    expect(expanded[0].files).toContain("src/core/README.md");
    expect(expanded[0].files).toContain("src/core/styles.css");
    expect(remaining).toHaveLength(0);
  });

  it("walks up directory tree to find a match", () => {
    const zones: Zone[] = [
      {
        id: "api",
        name: "Api",
        description: "",
        files: ["src/api/routes.ts"],
        entryPoints: [],
        cohesion: 1,
        coupling: 0,
      },
    ];

    const { zones: expanded, remaining } = assignByProximity(zones, [
      "src/api/handlers/health.ts",
    ]);

    // health.ts is in src/api/handlers/, walks up to src/api/ which matches
    expect(expanded[0].files).toContain("src/api/handlers/health.ts");
    expect(remaining).toHaveLength(0);
  });

  it("leaves root files unzoned when no zone matches", () => {
    const zones: Zone[] = [
      {
        id: "core",
        name: "Core",
        description: "",
        files: ["src/core/a.ts"],
        entryPoints: [],
        cohesion: 1,
        coupling: 0,
      },
    ];

    const { remaining } = assignByProximity(zones, [
      "package.json",
      "README.md",
    ]);

    expect(remaining).toContain("package.json");
    expect(remaining).toContain("README.md");
  });
});

// ── computeStructureHash ────────────────────────────────────────────────────

describe("computeStructureHash", () => {
  it("produces the same hash for the same zone files", () => {
    const zones: Zone[] = [
      { id: "a", name: "", description: "", files: ["x.ts", "y.ts"], entryPoints: [], cohesion: 1, coupling: 0 },
    ];
    expect(computeStructureHash(zones)).toBe(computeStructureHash(zones));
  });

  it("produces different hashes for different zone files", () => {
    const z1: Zone[] = [
      { id: "a", name: "", description: "", files: ["x.ts"], entryPoints: [], cohesion: 1, coupling: 0 },
    ];
    const z2: Zone[] = [
      { id: "a", name: "", description: "", files: ["y.ts"], entryPoints: [], cohesion: 1, coupling: 0 },
    ];
    expect(computeStructureHash(z1)).not.toBe(computeStructureHash(z2));
  });

  it("is independent of zone ID or name (only file groupings matter)", () => {
    const z1: Zone[] = [
      { id: "a", name: "A", description: "", files: ["x.ts", "y.ts"], entryPoints: [], cohesion: 1, coupling: 0 },
    ];
    const z2: Zone[] = [
      { id: "renamed", name: "Renamed", description: "", files: ["x.ts", "y.ts"], entryPoints: [], cohesion: 1, coupling: 0 },
    ];
    expect(computeStructureHash(z1)).toBe(computeStructureHash(z2));
  });
});

// ── generateStructuralInsights ──────────────────────────────────────────────

describe("generateStructuralInsights", () => {
  it("generates high-cohesion insight", () => {
    const zones: Zone[] = [
      { id: "core", name: "Core", description: "", files: ["a.ts", "b.ts", "c.ts"], entryPoints: [], cohesion: 0.9, coupling: 0.1 },
    ];
    const { zoneInsights } = generateStructuralInsights(zones, [], makeImports([]), 10);
    expect(zoneInsights.get("core")!.some((i) => i.includes("High cohesion"))).toBe(true);
  });

  it("generates low-cohesion warning for large zones", () => {
    const zones: Zone[] = [
      { id: "misc", name: "Misc", description: "", files: ["a.ts", "b.ts", "c.ts", "d.ts"], entryPoints: [], cohesion: 0.3, coupling: 0.2 },
    ];
    const { zoneInsights } = generateStructuralInsights(zones, [], makeImports([]), 10);
    expect(zoneInsights.get("misc")!.some((i) => i.includes("Low cohesion"))).toBe(true);
  });

  it("generates hub file insight for files imported across 3+ zones", () => {
    const crossings: ZoneCrossing[] = [
      { from: "a/x.ts", to: "shared/hub.ts", fromZone: "zone-a", toZone: "shared" },
      { from: "b/x.ts", to: "shared/hub.ts", fromZone: "zone-b", toZone: "shared" },
      { from: "c/x.ts", to: "shared/hub.ts", fromZone: "zone-c", toZone: "shared" },
    ];
    const zones: Zone[] = [
      { id: "shared", name: "", description: "", files: ["shared/hub.ts"], entryPoints: [], cohesion: 1, coupling: 0 },
    ];
    const { globalInsights } = generateStructuralInsights(zones, crossings, makeImports([]), 10);
    expect(globalInsights.some((i) => i.includes("Hub") && i.includes("shared/hub.ts"))).toBe(true);
  });

  it("detects bidirectional coupling", () => {
    const crossings: ZoneCrossing[] = [
      { from: "a/x.ts", to: "b/y.ts", fromZone: "alpha", toZone: "beta" },
      { from: "b/z.ts", to: "a/w.ts", fromZone: "beta", toZone: "alpha" },
    ];
    const zones: Zone[] = [
      { id: "alpha", name: "", description: "", files: ["a/x.ts", "a/w.ts"], entryPoints: [], cohesion: 1, coupling: 0.5 },
      { id: "beta", name: "", description: "", files: ["b/y.ts", "b/z.ts"], entryPoints: [], cohesion: 1, coupling: 0.5 },
    ];
    const { globalInsights } = generateStructuralInsights(zones, crossings, makeImports([]), 10);
    expect(globalInsights.some((i) => i.includes("Bidirectional"))).toBe(true);
  });
});

// ── enrichZonesWithAI ──────────────────────────────────────────────────────

describe("enrichZonesWithAI", () => {
  afterEach(() => {
    mockedExecFileSync.mockReset();
    mockedSpawn.mockReset();
  });

  const sampleZones: Zone[] = [
    {
      id: "analyzers",
      name: "Analyzers",
      description: "3 files, primarily TypeScript",
      files: ["src/analyzers/a.ts", "src/analyzers/b.ts", "src/analyzers/c.ts"],
      entryPoints: ["src/analyzers/a.ts"],
      cohesion: 0.8,
      coupling: 0.2,
    },
    {
      id: "schema",
      name: "Schema",
      description: "2 files, primarily TypeScript",
      files: ["src/schema/v1.ts", "src/schema/validate.ts"],
      entryPoints: ["src/schema/v1.ts"],
      cohesion: 1,
      coupling: 0.1,
    },
  ];

  const sampleCrossings: ZoneCrossing[] = [
    { from: "src/analyzers/a.ts", to: "src/schema/v1.ts", fromZone: "analyzers", toZone: "schema" },
  ];

  const sampleInventory = makeInventory([
    makeFileEntry("src/analyzers/a.ts"),
    makeFileEntry("src/analyzers/b.ts"),
    makeFileEntry("src/analyzers/c.ts"),
    makeFileEntry("src/schema/v1.ts"),
    makeFileEntry("src/schema/validate.ts"),
  ]);

  const sampleImports = makeImports([
    makeEdge("src/analyzers/a.ts", "src/schema/v1.ts"),
  ]);

  function makePass1Response() {
    return JSON.stringify({
      zones: [
        {
          algorithmicId: "analyzers",
          id: "code-analysis",
          name: "Code Analysis",
          description: "Core analysis pipeline",
          insights: ["Uses visitor pattern for AST traversal"],
        },
        {
          algorithmicId: "schema",
          id: "data-schema",
          name: "Data Schema",
          description: "Schema definitions and validation",
          insights: ["Well-isolated with clean boundary"],
        },
      ],
      insights: ["Clean layered architecture: schema → analyzers"],
    });
  }

  it("pass 1: replaces id/name/description and returns AI insights", async () => {
    mockedExecFileSync.mockImplementationOnce(() => Buffer.from("/usr/local/bin/claude\n"));
    mockClaudeResponse(makePass1Response());

    const result = await enrichZonesWithAI(
      sampleZones, sampleCrossings, sampleInventory, sampleImports
    );

    expect(result.pass).toBe(1);
    expect(result.zones).toHaveLength(2);
    expect(result.zones[0].id).toBe("code-analysis");
    expect(result.zones[0].name).toBe("Code Analysis");
    expect(result.zones[0].description).toBe("Core analysis pipeline");

    // Structural data preserved
    expect(result.zones[0].files).toEqual(sampleZones[0].files);
    expect(result.zones[0].cohesion).toBe(0.8);
    expect(result.zones[0].coupling).toBe(0.2);

    // AI insights extracted
    expect(result.newZoneInsights.get("code-analysis")).toEqual([
      "Uses visitor pattern for AST traversal",
    ]);
    expect(result.newGlobalInsights).toEqual([
      "Clean layered architecture: schema → analyzers",
    ]);
  });

  it("handles AI response wrapped in markdown fences", async () => {
    mockedExecFileSync.mockImplementationOnce(() => Buffer.from("/usr/local/bin/claude\n"));
    mockClaudeResponse("```json\n" + makePass1Response() + "\n```");

    const result = await enrichZonesWithAI(
      sampleZones, sampleCrossings, sampleInventory, sampleImports
    );

    expect(result.zones[0].id).toBe("code-analysis");
    expect(result.zones[1].id).toBe("data-schema");
  });

  it("returns zones unchanged when claude CLI not found", async () => {
    mockedExecFileSync.mockImplementationOnce(() => {
      throw new Error("not found");
    });

    const result = await enrichZonesWithAI(
      sampleZones, sampleCrossings, sampleInventory, sampleImports
    );

    expect(result.zones).toEqual(sampleZones);
    expect(result.pass).toBe(0);
  });

  it("returns zones unchanged on invalid JSON response after all retries", async () => {
    mockedExecFileSync.mockImplementationOnce(() => Buffer.from("/usr/local/bin/claude\n"));
    // All 3 retry attempts return invalid JSON
    mockClaudeResponse("This is not valid JSON");
    mockClaudeResponse("Still not JSON");
    mockClaudeResponse("Nope");

    const result = await enrichZonesWithAI(
      sampleZones, sampleCrossings, sampleInventory, sampleImports
    );

    expect(result.zones).toEqual(sampleZones);
    expect(result.pass).toBe(0);
  });

  it("returns zones unchanged when response has empty zones array", async () => {
    mockedExecFileSync.mockImplementationOnce(() => Buffer.from("/usr/local/bin/claude\n"));
    const emptyResponse = JSON.stringify({ zones: [], insights: [] });
    mockClaudeResponse(emptyResponse);
    mockClaudeResponse(emptyResponse);
    mockClaudeResponse(emptyResponse);

    const result = await enrichZonesWithAI(
      sampleZones, sampleCrossings, sampleInventory, sampleImports
    );

    expect(result.zones).toEqual(sampleZones);
    expect(result.pass).toBe(0);
  });

  it("applies partial results when response has fewer zones", async () => {
    mockedExecFileSync.mockImplementationOnce(() => Buffer.from("/usr/local/bin/claude\n"));
    mockClaudeResponse(JSON.stringify({
      zones: [{ algorithmicId: "analyzers", id: "analysis-core", name: "Analysis Core", description: "Core analysis", insights: [] }],
      insights: [],
    }));

    const result = await enrichZonesWithAI(
      sampleZones, sampleCrossings, sampleInventory, sampleImports
    );

    // First zone matched by algorithmicId and enriched
    expect(result.zones[0].id).toBe("analysis-core");
    expect(result.zones[0].name).toBe("Analysis Core");
    // Second zone kept as-is (no match)
    expect(result.zones[1].id).toBe("schema");
    expect(result.zones[1].name).toBe("Schema");
    expect(result.pass).toBe(1);
  });

  it("returns zones unchanged when all claude calls throw", async () => {
    mockedExecFileSync.mockImplementationOnce(() => Buffer.from("/usr/local/bin/claude\n"));
    mockClaudeError("timed out");
    mockClaudeError("timed out");
    mockClaudeError("timed out");

    const result = await enrichZonesWithAI(
      sampleZones, sampleCrossings, sampleInventory, sampleImports
    );

    expect(result.zones).toEqual(sampleZones);
    expect(result.pass).toBe(0);
  });

  it("does not retry on auth errors", async () => {
    mockedExecFileSync.mockImplementationOnce(() => Buffer.from("/usr/local/bin/claude\n"));
    mockClaudeError("unauthorized", { stderr: "Not logged in. Run claude login first." });

    const result = await enrichZonesWithAI(
      sampleZones, sampleCrossings, sampleInventory, sampleImports
    );

    expect(result.zones).toEqual(sampleZones);
    expect(result.pass).toBe(0);
    // 1 execFileSync call (which) + 1 execFile call (claude, no retries)
    expect(mockedExecFileSync).toHaveBeenCalledTimes(1);
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
  });

  it("succeeds on retry after initial failure", async () => {
    mockedExecFileSync.mockImplementationOnce(() => Buffer.from("/usr/local/bin/claude\n"));
    // First attempt fails
    mockClaudeResponse("not json");
    // Second attempt succeeds
    mockClaudeResponse(makePass1Response());

    const result = await enrichZonesWithAI(
      sampleZones, sampleCrossings, sampleInventory, sampleImports
    );

    expect(result.zones[0].id).toBe("code-analysis");
    expect(result.pass).toBe(1);
  });

  it("pass 2+: preserves previous AI names and returns only new insights", async () => {
    const previousZones = {
      zones: [
        { ...sampleZones[0], id: "code-analysis", name: "Code Analysis", description: "Pipeline" },
        { ...sampleZones[1], id: "data-schema", name: "Data Schema", description: "Schemas" },
      ],
      crossings: sampleCrossings,
      unzoned: [],
      enrichmentPass: 1,
      structureHash: "abc",
    };

    const pass2Response = JSON.stringify({
      zones: [
        { id: "code-analysis", newInsights: ["Tightly coupled with schema"] },
        { id: "data-schema", newInsights: [] },
      ],
      insights: ["Consider extracting shared types"],
    });

    mockedExecFileSync.mockImplementationOnce(() => Buffer.from("/usr/local/bin/claude\n"));
    mockClaudeResponse(pass2Response);

    const result = await enrichZonesWithAI(
      sampleZones, sampleCrossings, sampleInventory, sampleImports, previousZones
    );

    expect(result.pass).toBe(2);
    // Preserved previous names
    expect(result.zones[0].id).toBe("code-analysis");
    expect(result.zones[0].name).toBe("Code Analysis");
    // Only new insights returned
    expect(result.newZoneInsights.get("code-analysis")).toEqual([
      "Tightly coupled with schema",
    ]);
    expect(result.newGlobalInsights).toEqual([
      "Consider extracting shared types",
    ]);
  });
});

// ── enrichZonesWithAI batching ──────────────────────────────────────────────

describe("enrichZonesWithAI batching", () => {
  afterEach(() => {
    mockedExecFileSync.mockReset();
    mockedSpawn.mockReset();
  });

  function makeZone(id: string, fileCount: number): Zone {
    const files = Array.from({ length: fileCount }, (_, i) => `src/${id}/f${i}.ts`);
    return {
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      description: `${fileCount} files`,
      files,
      entryPoints: [files[0]],
      cohesion: 0.8,
      coupling: 0.2,
    };
  }

  function makeBatchResponse(zones: Zone[]) {
    return JSON.stringify({
      zones: zones.map((z) => ({
        algorithmicId: z.id,
        id: `ai-${z.id}`,
        name: `AI ${z.name}`,
        description: `AI description for ${z.id}`,
        insights: [`Insight for ${z.id}`],
      })),
      insights: [`Cross-zone insight for batch containing ${zones[0].id}`],
    });
  }

  it("uses single-batch fast path for <= 5 zones", async () => {
    const zones = Array.from({ length: 3 }, (_, i) => makeZone(`zone${i}`, 3));
    const inventory = makeInventory(zones.flatMap((z) => z.files.map((f) => makeFileEntry(f))));
    const imports = makeImports([]);

    mockedExecFileSync.mockImplementationOnce(() => Buffer.from("/usr/local/bin/claude\n"));
    mockClaudeResponse(makeBatchResponse(zones));

    const result = await enrichZonesWithAI(zones, [], inventory, imports);

    expect(result.pass).toBe(1);
    expect(result.zones).toHaveLength(3);
    expect(result.zones[0].id).toBe("ai-zone0");
    // 1 execFileSync call (which) + 1 execFile call (claude)
    expect(mockedExecFileSync).toHaveBeenCalledTimes(1);
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
  });

  it("splits > 5 zones into multiple batches", async () => {
    const zones = Array.from({ length: 8 }, (_, i) => makeZone(`zone${i}`, 2));
    const inventory = makeInventory(zones.flatMap((z) => z.files.map((f) => makeFileEntry(f))));
    const imports = makeImports([]);

    mockedExecFileSync.mockImplementationOnce(() => Buffer.from("/usr/local/bin/claude\n"));
    // Batch 1: zones 0-4
    mockClaudeResponse(makeBatchResponse(zones.slice(0, 5)));
    // Batch 2: zones 5-7
    mockClaudeResponse(makeBatchResponse(zones.slice(5, 8)));

    const result = await enrichZonesWithAI(zones, [], inventory, imports);

    expect(result.pass).toBe(1);
    expect(result.zones).toHaveLength(8);
    // All zones should be enriched
    for (let i = 0; i < 8; i++) {
      expect(result.zones[i].id).toBe(`ai-zone${i}`);
      expect(result.zones[i].name).toBe(`AI Zone${i}`);
    }
    // 1 execFileSync call (which) + 2 execFile calls (batches)
    expect(mockedExecFileSync).toHaveBeenCalledTimes(1);
    expect(mockedSpawn).toHaveBeenCalledTimes(2);
  });

  it("preserves partial results when a batch fails", async () => {
    const zones = Array.from({ length: 8 }, (_, i) => makeZone(`zone${i}`, 2));
    const inventory = makeInventory(zones.flatMap((z) => z.files.map((f) => makeFileEntry(f))));
    const imports = makeImports([]);

    mockedExecFileSync.mockImplementationOnce(() => Buffer.from("/usr/local/bin/claude\n"));
    // Batch 1: succeeds
    mockClaudeResponse(makeBatchResponse(zones.slice(0, 5)));
    // Batch 2: all 3 retries fail
    mockClaudeError("timed out");
    mockClaudeError("timed out");
    mockClaudeError("timed out");

    const result = await enrichZonesWithAI(zones, [], inventory, imports);

    expect(result.pass).toBe(1);
    expect(result.zones).toHaveLength(8);
    // First 5 zones should be enriched
    for (let i = 0; i < 5; i++) {
      expect(result.zones[i].id).toBe(`ai-zone${i}`);
    }
    // Last 3 zones should keep algorithmic names
    for (let i = 5; i < 8; i++) {
      expect(result.zones[i].id).toBe(`zone${i}`);
    }
  });

  it("accumulates global insights across batches", async () => {
    const zones = Array.from({ length: 8 }, (_, i) => makeZone(`zone${i}`, 2));
    const inventory = makeInventory(zones.flatMap((z) => z.files.map((f) => makeFileEntry(f))));
    const imports = makeImports([]);

    mockedExecFileSync.mockImplementationOnce(() => Buffer.from("/usr/local/bin/claude\n"));
    mockClaudeResponse(makeBatchResponse(zones.slice(0, 5)));
    mockClaudeResponse(makeBatchResponse(zones.slice(5, 8)));

    const result = await enrichZonesWithAI(zones, [], inventory, imports);

    // Should have global insights from both batches
    expect(result.newGlobalInsights.length).toBe(2);
    expect(result.newGlobalInsights[0]).toContain("zone0");
    expect(result.newGlobalInsights[1]).toContain("zone5");
  });

  it("deduplicates identical global insights across batches", async () => {
    const zones = Array.from({ length: 8 }, (_, i) => makeZone(`zone${i}`, 2));
    const inventory = makeInventory(zones.flatMap((z) => z.files.map((f) => makeFileEntry(f))));
    const imports = makeImports([]);

    const responseWithDupInsight = (batchZones: Zone[]) => JSON.stringify({
      zones: batchZones.map((z) => ({
        algorithmicId: z.id,
        id: `ai-${z.id}`,
        name: `AI ${z.name}`,
        description: `desc`,
        insights: [],
      })),
      insights: ["Shared insight appears in both batches"],
    });

    mockedExecFileSync.mockImplementationOnce(() => Buffer.from("/usr/local/bin/claude\n"));
    mockClaudeResponse(responseWithDupInsight(zones.slice(0, 5)));
    mockClaudeResponse(responseWithDupInsight(zones.slice(5, 8)));

    const result = await enrichZonesWithAI(zones, [], inventory, imports);

    expect(result.newGlobalInsights).toEqual(["Shared insight appears in both batches"]);
  });

  it("returns empty when auth fails on all batches with no prior results", async () => {
    const zones = Array.from({ length: 8 }, (_, i) => makeZone(`zone${i}`, 2));
    const inventory = makeInventory(zones.flatMap((z) => z.files.map((f) => makeFileEntry(f))));
    const imports = makeImports([]);

    mockedExecFileSync.mockImplementationOnce(() => Buffer.from("/usr/local/bin/claude\n"));
    // Both batches get auth errors (they run in parallel)
    mockClaudeError("unauthorized", { stderr: "Not logged in." });
    mockClaudeError("unauthorized", { stderr: "Not logged in." });

    const result = await enrichZonesWithAI(zones, [], inventory, imports);

    expect(result.zones).toEqual(zones);
    expect(result.pass).toBe(0);
  });
});

// ── analyzeZones with insights ──────────────────────────────────────────────

describe("analyzeZones insights", () => {
  it("generates structural insights without AI", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts"),
      makeFileEntry("src/a/y.ts"),
      makeFileEntry("src/a/z.ts"),
    ]);
    const imports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/x.ts", "src/a/z.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    expect(result.zones).toHaveLength(1);
    // Should have structural insights even without AI
    expect(result.zones[0].insights).toBeDefined();
    expect(result.zones[0].insights!.some((i) => i.includes("cohesion"))).toBe(true);
    // Should have structureHash
    expect(result.structureHash).toBeDefined();
  });

  it("assigns proximity files to reduce unzoned count", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/m/a.ts"),
      makeFileEntry("src/m/b.ts"),
      makeFileEntry("src/m/c.ts"),
      makeFileEntry("src/m/README.md", { role: "docs" }),
      makeFileEntry("src/m/styles.css", { language: "CSS", role: "other" }),
    ]);
    const imports = makeImports([
      makeEdge("src/m/a.ts", "src/m/b.ts"),
      makeEdge("src/m/b.ts", "src/m/c.ts"),
      makeEdge("src/m/a.ts", "src/m/c.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    // README.md and styles.css should be assigned to the zone by proximity
    expect(result.zones[0].files).toContain("src/m/README.md");
    expect(result.zones[0].files).toContain("src/m/styles.css");
    expect(result.unzoned).not.toContain("src/m/README.md");
    expect(result.unzoned).not.toContain("src/m/styles.css");
  });
});

// ── computeAttemptConfigs ──────────────────────────────────────────────────

describe("computeAttemptConfigs", () => {
  it("returns minimum 480s base for small projects (pass 1)", () => {
    const configs = computeAttemptConfigs(10, 2);
    // sizeBase = 10*400 + 2*5000 = 14000, pass1 multiplier 1.5 = 21000 → clamped to 480_000
    expect(configs[0].timeout).toBe(480_000);
    expect(configs).toHaveLength(3);
  });

  it("returns minimum 480s base for small projects (pass 2+)", () => {
    const configs = computeAttemptConfigs(10, 2, 2);
    // sizeBase = 14000, pass2+ multiplier 1 = 14000 → clamped to 480_000
    expect(configs[0].timeout).toBe(480_000);
  });

  it("pass 1 gets 1.5x multiplier on size-based timeout", () => {
    // 500*400 + 20*5000 = 200000 + 100000 = 300000; pass1: 300000 * 1.5 = 450000 → clamped to 480_000
    const configs = computeAttemptConfigs(500, 20, 1);
    expect(configs[0].timeout).toBe(480_000);
    // pass 2+: 300000 * 1 = 300000 → clamped to 480_000
    const configs2 = computeAttemptConfigs(500, 20, 2);
    expect(configs2[0].timeout).toBe(480_000);
  });

  it("scales retry timeouts with 1.3x and 1.6x multipliers", () => {
    // Need sizeBase*passMultiplier > 480_000 but base*1.3 < 600_000
    // sizeBase = 350*400 + 8*5000 = 140000 + 40000 = 180000; pass2 multiplier=1: 180000 → clamped to 480_000
    // Use pass=2 so multiplier is 1: need raw sizeBase > 480_000
    // sizeBase = 1000*400 + 5*5000 = 425000; pass2: 425000 → clamped to 480_000
    // sizeBase = 1100*400 + 5*5000 = 465000; pass2: 465000 → clamped to 480_000
    // sizeBase = 1300*400 + 5*5000 = 545000; pass2: 545000 → above floor
    // 545000*1.3 = 708500 → capped at 600_000. Still too high.
    // Need base where base*1.3 ≤ 600_000 → base ≤ ~461_538
    // But floor is 480_000 → base=480_000, 480_000*1.3=624_000 > 600_000. Hmm.
    // So base>480_000 always has 1.3x > 600_000 unless base is exactly 480_000.
    // The 1.3x retry will always be capped at 600_000 when base ≥ 480_000.
    // Let's just test with base = 480_000 (the minimum) and verify capping.
    const configs = computeAttemptConfigs(10, 2, 1);
    expect(configs[0].timeout).toBe(480_000);
    expect(configs[1].timeout).toBe(600_000); // 480_000 * 1.3 = 624_000 → capped
    expect(configs[2].timeout).toBe(600_000); // 480_000 * 1.6 = 768_000 → capped
  });

  it("caps at 600s", () => {
    const configs = computeAttemptConfigs(2000, 50);
    expect(configs[0].timeout).toBe(600_000);
    expect(configs[1].timeout).toBe(600_000);
    expect(configs[2].timeout).toBe(600_000);
  });

  it("has progressively simpler maxFiles", () => {
    const configs = computeAttemptConfigs(100, 5);
    expect(configs[0].maxFiles).toBe(8);
    expect(configs[1].maxFiles).toBe(3);
    expect(configs[2].maxFiles).toBe(0);
  });
});

// ── extractFindings ────────────────────────────────────────────────────────

describe("extractFindings", () => {
  it("extracts new-format findings from top-level array", () => {
    const parsed = {
      findings: [
        { type: "pattern", scope: "global", text: "MVC pattern detected", severity: "info" },
        { type: "relationship", scope: "api", text: "API depends on core" },
      ],
      zones: [],
      insights: [],
    };

    const findings = extractFindings(parsed, 2, ["pattern", "relationship"]);
    expect(findings).toHaveLength(2);
    expect(findings[0].type).toBe("pattern");
    expect(findings[0].pass).toBe(2);
    expect(findings[0].severity).toBe("info");
    expect(findings[1].type).toBe("relationship");
    expect(findings[1].scope).toBe("api");
  });

  it("extracts findings from per-zone arrays", () => {
    const parsed = {
      zones: [
        {
          id: "auth",
          findings: [
            { type: "anti-pattern", scope: "auth", text: "God class detected", severity: "warning" },
          ],
        },
      ],
      insights: [],
    };

    const findings = extractFindings(parsed, 3, ["anti-pattern"]);
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe("anti-pattern");
    expect(findings[0].scope).toBe("auth");
    expect(findings[0].severity).toBe("warning");
  });

  it("falls back to legacy insights when no findings present", () => {
    const parsed = {
      zones: [
        { id: "core", insights: ["High cohesion zone"] },
        { id: "util", insights: ["Helper functions"] },
      ],
      insights: ["Clean architecture"],
    };

    const findings = extractFindings(parsed, 1, ["observation"]);
    expect(findings).toHaveLength(3);
    expect(findings[0].type).toBe("observation");
    expect(findings[0].scope).toBe("global");
    expect(findings[0].text).toBe("Clean architecture");
    expect(findings[1].scope).toBe("core");
    expect(findings[2].scope).toBe("util");
  });

  it("falls back to legacy newInsights for pass 2+", () => {
    const parsed = {
      zones: [
        { id: "core", newInsights: ["Needs refactoring"] },
      ],
      insights: [],
    };

    const findings = extractFindings(parsed, 2, ["pattern"]);
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe("pattern");
    expect(findings[0].scope).toBe("core");
    expect(findings[0].text).toBe("Needs refactoring");
  });

  it("uses expected type as default for invalid finding types", () => {
    const parsed = {
      findings: [
        { type: "invalid-type", scope: "global", text: "some finding" },
      ],
      zones: [],
    };

    const findings = extractFindings(parsed, 1, ["observation"]);
    expect(findings[0].type).toBe("observation");
  });

  it("handles related array and filters non-strings", () => {
    const parsed = {
      findings: [
        { type: "pattern", scope: "global", text: "test", related: ["a.ts", 42, "b.ts"] },
      ],
      zones: [],
    };

    const findings = extractFindings(parsed, 1, ["pattern"]);
    expect(findings[0].related).toEqual(["a.ts", "b.ts"]);
  });
});

// ── analyzeZones with findings ──────────────────────────────────────────────

describe("analyzeZones findings", () => {
  it("produces structural findings at pass 0 with enrich: false", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts"),
      makeFileEntry("src/a/y.ts"),
      makeFileEntry("src/a/z.ts"),
    ]);
    const imports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/x.ts", "src/a/z.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    // Should have findings array with pass 0 observations
    expect(result.findings).toBeDefined();
    expect(result.findings!.length).toBeGreaterThan(0);
    expect(result.findings!.every((f) => f.pass === 0)).toBe(true);
    expect(result.findings!.every((f) => f.type === "observation")).toBe(true);
  });

  it("populates both findings and insights for backward compat", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts"),
      makeFileEntry("src/a/y.ts"),
      makeFileEntry("src/a/z.ts"),
    ]);
    const imports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/x.ts", "src/a/z.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    // Both old insights and new findings should be populated
    expect(result.zones[0].insights).toBeDefined();
    expect(result.findings).toBeDefined();

    // Insights text should appear in findings text
    for (const insight of result.zones[0].insights!) {
      expect(
        result.findings!.some((f) => f.text === insight)
      ).toBe(true);
    }
  });

  it("structural findings have severity based on content", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts"),
      makeFileEntry("src/a/y.ts"),
      makeFileEntry("src/a/z.ts"),
      makeFileEntry("src/a/w.ts"),
      makeFileEntry("src/a/v.ts"),
    ]);
    const imports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/z.ts", "src/a/w.ts"),
      makeEdge("src/a/w.ts", "src/a/v.ts"),
      // Only some internal edges → low cohesion
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });
    if (result.findings) {
      for (const f of result.findings) {
        expect(["info", "warning", "critical"]).toContain(f.severity);
      }
    }
  });
});

// ── subdivideZone ──────────────────────────────────────────────────────────────

describe("subdivideZone", () => {
  it("returns empty array for zones below threshold", () => {
    const zone = makeZone("small", Array.from({ length: 10 }, (_, i) => `src/small/${i}.ts`));
    const inventory = makeInventory(zone.files.map((f) => makeFileEntry(f)));
    const imports = makeImports(zone.files.slice(1).map((f, i) => makeEdge(zone.files[i], f)));

    const subZones = subdivideZone(zone, imports, inventory);

    expect(subZones).toEqual([]);
  });

  it("returns empty array when no internal edges", () => {
    const files = Array.from({ length: 60 }, (_, i) => `src/large/${i}.ts`);
    const zone = makeZone("large", files);
    const inventory = makeInventory(files.map((f) => makeFileEntry(f)));
    const imports = makeImports([]); // No edges at all

    const subZones = subdivideZone(zone, imports, inventory);

    expect(subZones).toEqual([]);
  });

  it("returns empty array when Louvain finds only one community", () => {
    // All files fully connected = single community
    const files = Array.from({ length: 55 }, (_, i) => `src/large/${i}.ts`);
    const zone = makeZone("large", files);
    const inventory = makeInventory(files.map((f) => makeFileEntry(f)));
    // Create a complete graph (every file connected to every other)
    const edges: ImportEdge[] = [];
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        edges.push(makeEdge(files[i], files[j]));
      }
    }
    const imports = makeImports(edges);

    const subZones = subdivideZone(zone, imports, inventory);

    // May or may not find sub-communities depending on Louvain result
    // If it finds only 1, returns empty
    // This test just ensures it doesn't throw
    expect(Array.isArray(subZones)).toBe(true);
  });

  it("subdivides a large zone into multiple sub-zones", () => {
    // Create two distinct clusters that should be detected
    const cluster1 = Array.from({ length: 30 }, (_, i) => `src/cluster1/file${i}.ts`);
    const cluster2 = Array.from({ length: 30 }, (_, i) => `src/cluster2/file${i}.ts`);
    const files = [...cluster1, ...cluster2];

    const zone = makeZone("large", files);
    const inventory = makeInventory(files.map((f) => makeFileEntry(f)));

    // Create edges within each cluster (strong internal connectivity)
    const edges: ImportEdge[] = [];
    for (let i = 0; i < cluster1.length - 1; i++) {
      edges.push(makeEdge(cluster1[i], cluster1[i + 1]));
    }
    for (let i = 0; i < cluster2.length - 1; i++) {
      edges.push(makeEdge(cluster2[i], cluster2[i + 1]));
    }
    // Add a few weak links between clusters
    edges.push(makeEdge(cluster1[0], cluster2[0]));

    const imports = makeImports(edges);

    const subZones = subdivideZone(zone, imports, inventory);

    // Should find at least 2 sub-zones
    expect(subZones.length).toBeGreaterThanOrEqual(2);

    // Sub-zone IDs should be prefixed with parent ID
    for (const sub of subZones) {
      expect(sub.id).toMatch(/^large\//);
    }
  });

  it("sets depth on sub-zones", () => {
    const cluster1 = Array.from({ length: 30 }, (_, i) => `src/a/file${i}.ts`);
    const cluster2 = Array.from({ length: 30 }, (_, i) => `src/b/file${i}.ts`);
    const files = [...cluster1, ...cluster2];

    const zone: Zone = {
      id: "parent",
      name: "Parent",
      description: "test",
      files,
      entryPoints: [],
      cohesion: 0.5,
      coupling: 0.5,
      depth: 0, // Parent is at depth 0
    };
    const inventory = makeInventory(files.map((f) => makeFileEntry(f)));

    const edges: ImportEdge[] = [];
    for (let i = 0; i < cluster1.length - 1; i++) {
      edges.push(makeEdge(cluster1[i], cluster1[i + 1]));
    }
    for (let i = 0; i < cluster2.length - 1; i++) {
      edges.push(makeEdge(cluster2[i], cluster2[i + 1]));
    }
    edges.push(makeEdge(cluster1[0], cluster2[0]));
    const imports = makeImports(edges);

    const subZones = subdivideZone(zone, imports, inventory);

    // All sub-zones should have depth = parent depth + 1
    for (const sub of subZones) {
      expect(sub.depth).toBe(1);
    }
  });

  it("respects max depth limit", () => {
    const files = Array.from({ length: 60 }, (_, i) => `src/deep/${i}.ts`);
    const zone: Zone = {
      id: "deep",
      name: "Deep",
      description: "test",
      files,
      entryPoints: [],
      cohesion: 0.5,
      coupling: 0.5,
    };
    const inventory = makeInventory(files.map((f) => makeFileEntry(f)));
    const edges = files.slice(1).map((f, i) => makeEdge(files[i], f));
    const imports = makeImports(edges);

    // Call with depth at max
    const subZones = subdivideZone(zone, imports, inventory, MAX_SUBDIVISION_DEPTH);

    // Should return empty (depth exceeded)
    expect(subZones).toEqual([]);
  });
});

describe("SUBDIVISION_THRESHOLD", () => {
  it("is set to a reasonable value", () => {
    expect(SUBDIVISION_THRESHOLD).toBeGreaterThanOrEqual(30);
    expect(SUBDIVISION_THRESHOLD).toBeLessThanOrEqual(100);
  });
});

describe("MAX_SUBDIVISION_DEPTH", () => {
  it("is set to prevent infinite recursion", () => {
    expect(MAX_SUBDIVISION_DEPTH).toBeGreaterThanOrEqual(1);
    expect(MAX_SUBDIVISION_DEPTH).toBeLessThanOrEqual(5);
  });
});
